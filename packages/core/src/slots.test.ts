import { describe, expect, it } from "vitest";
import { dublinToUtc } from "./time";
import {
  availableDays, computeSlots, dayPart, nextAvailable,
  type ComputeSlotsInput, type DoctorAvailability,
} from "./slots";

const monToFri = (id = "d1"): DoctorAvailability => ({
  id,
  rules: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startTime: "09:00:00", endTime: "13:00:00" },
    { weekday, startTime: "14:00", endTime: "17:30" },
  ]),
  overrides: [],
});

const base = (over: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput => ({
  now: dublinToUtc("2026-11-20 08:00"), // Friday
  fromDate: "2026-11-24", // Tuesday
  toDate: "2026-11-24",
  service: { durationMin: 15, bufferMin: 0 },
  settings: { slotIntervalMinutes: 15, minNoticeMinutes: 60, bookingWindowDays: 30 },
  doctors: [monToFri()],
  holidays: [],
  blocks: [],
  busy: [],
  ...over,
});

const times = (slots: ReturnType<typeof computeSlots>) =>
  slots.map((s) => s.startAt.toISOString().slice(11, 16));

describe("computeSlots basics", () => {
  it("generates 15 minute slots inside both sessions", () => {
    const slots = computeSlots(base());
    // 09:00-13:00 = 16 slots, 14:00-17:30 = 14 slots (winter: Dublin = UTC)
    expect(slots).toHaveLength(30);
    expect(times(slots)[0]).toBe("09:00");
    expect(times(slots)).not.toContain("13:00");
    expect(times(slots)).toContain("14:00");
    expect(times(slots).at(-1)).toBe("17:15");
  });

  it("returns nothing on a day without rules (Sunday)", () => {
    expect(computeSlots(base({ fromDate: "2026-11-22", toDate: "2026-11-22" }))).toHaveLength(0);
  });

  it("drops a slot that would run past the end of the range", () => {
    const slots = computeSlots(base({ service: { durationMin: 30, bufferMin: 0 } }));
    expect(times(slots)).toContain("12:30");
    expect(times(slots)).not.toContain("12:45");
  });

  it("sets endAt and lockEndAt (buffer included)", () => {
    const [s] = computeSlots(base({ service: { durationMin: 30, bufferMin: 10 } }));
    expect(s!.endAt.toISOString()).toBe("2026-11-24T09:30:00.000Z");
    expect(s!.lockEndAt.toISOString()).toBe("2026-11-24T09:40:00.000Z");
  });

  it("rejects bad input", () => {
    expect(() => computeSlots(base({ service: { durationMin: 0, bufferMin: 0 } }))).toThrow();
  });
});

describe("holidays, overrides, validity", () => {
  it("clinic holiday removes regular hours", () => {
    expect(computeSlots(base({ holidays: ["2026-11-24"] }))).toHaveLength(0);
  });

  it("closed override removes the day for that doctor only", () => {
    const d1: DoctorAvailability = { ...monToFri("d1"), overrides: [{ date: "2026-11-24", isClosed: true }] };
    const slots = computeSlots(base({ doctors: [d1, monToFri("d2")] }));
    expect(new Set(slots.map((s) => s.doctorId))).toEqual(new Set(["d2"]));
  });

  it("extra-hours override adds a range, even on a holiday", () => {
    const d: DoctorAvailability = {
      id: "d1", rules: monToFri().rules,
      overrides: [{ date: "2026-11-24", isClosed: false, startTime: "10:00", endTime: "11:00" }],
    };
    const slots = computeSlots(base({ doctors: [d], holidays: ["2026-11-24"] }));
    expect(times(slots)).toEqual(["10:00", "10:15", "10:30", "10:45"]);
  });

  it("respects validFrom and validTo on rules", () => {
    const d: DoctorAvailability = {
      id: "d1", overrides: [],
      rules: [{ weekday: 2, startTime: "09:00", endTime: "10:00", validFrom: "2026-12-01" }],
    };
    expect(computeSlots(base({ doctors: [d] }))).toHaveLength(0);
    const d2: DoctorAvailability = { ...d, rules: [{ ...d.rules[0]!, validFrom: null, validTo: "2026-11-23" }] };
    expect(computeSlots(base({ doctors: [d2] }))).toHaveLength(0);
  });
});

describe("busy time, blocks and buffers", () => {
  const busy = (start: string, end: string, doctorId = "d1") => ({
    doctorId, startAt: dublinToUtc(`2026-11-24 ${start}`), endAt: dublinToUtc(`2026-11-24 ${end}`),
  });

  it("removes slots that overlap an existing appointment", () => {
    const slots = computeSlots(base({ busy: [busy("09:00", "09:30")] }));
    expect(times(slots).slice(0, 2)).toEqual(["09:30", "09:45"]);
  });

  it("allows back-to-back (end is exclusive)", () => {
    const slots = computeSlots(base({ busy: [busy("09:15", "09:30")] }));
    expect(times(slots).slice(0, 3)).toEqual(["09:00", "09:30", "09:45"]);
  });

  it("a slot's own buffer must not run into the next appointment", () => {
    const slots = computeSlots(base({
      service: { durationMin: 15, bufferMin: 10 },
      busy: [busy("09:20", "09:35")],
      settings: { slotIntervalMinutes: 5, minNoticeMinutes: 60, bookingWindowDays: 30 },
    }));
    // 09:00 slot locks 09:00-09:25 which overlaps 09:20. 08:xx does not exist. Earliest free is 09:35.
    expect(times(slots)[0]).toBe("09:35");
  });

  it("ignores another doctor's busy time", () => {
    expect(computeSlots(base({ busy: [busy("09:00", "13:00", "other")] }))).toHaveLength(30);
  });

  it("blocked time removes slots", () => {
    const slots = computeSlots(base({ blocks: [busy("14:00", "17:30")] }));
    expect(slots).toHaveLength(16);
  });
});

describe("notice and booking window", () => {
  it("applies minimum notice", () => {
    const now = dublinToUtc("2026-11-24 08:30");
    const slots = computeSlots(base({ now }));
    expect(times(slots)[0]).toBe("09:30"); // now + 60 min
  });

  it("service notice override beats the global setting (same-day appointments)", () => {
    const now = dublinToUtc("2026-11-24 08:30");
    const slots = computeSlots(base({ now, service: { durationMin: 15, bufferMin: 0, minNoticeOverrideMin: 15 } }));
    expect(times(slots)[0]).toBe("09:00");
  });

  it("does not offer dates beyond the booking window", () => {
    const slots = computeSlots(base({ fromDate: "2026-11-20", toDate: "2027-02-01" }));
    expect(slots.at(-1)!.startAt.getTime()).toBeLessThanOrEqual(dublinToUtc("2026-12-20 23:59").getTime());
  });
});

describe("daylight saving (BK-14)", () => {
  it("spring forward day keeps the same wall-clock slots, shifted to UTC+1", () => {
    // Sunday 29 Mar 2026: clocks go forward at 01:00. Give the doctor Sunday hours.
    const d: DoctorAvailability = { id: "d1", overrides: [], rules: [{ weekday: 0, startTime: "09:00", endTime: "10:00" }] };
    const slots = computeSlots(base({
      now: dublinToUtc("2026-03-20 08:00"), doctors: [d], fromDate: "2026-03-29", toDate: "2026-03-29",
    }));
    expect(times(slots)).toEqual(["08:00", "08:15", "08:30", "08:45"]); // 09:00 Dublin = 08:00Z
  });

  it("day before and day after have the same slot count as the change day", () => {
    const d: DoctorAvailability = {
      id: "d1", overrides: [],
      rules: [0, 1, 6].map((weekday) => ({ weekday, startTime: "00:00", endTime: "23:00" })),
    };
    const count = (date: string) => computeSlots(base({
      now: dublinToUtc("2026-03-20 08:00"), doctors: [d], fromDate: date, toDate: date,
    })).length;
    // 29 Mar has 23 real hours between 00:00 and 23:00 wall clock (clocks skip one hour).
    expect(count("2026-03-28")).toBe(23 * 4);
    expect(count("2026-03-29")).toBe(22 * 4);
  });

  it("autumn back day: the extra hour is a real hour", () => {
    const d: DoctorAvailability = { id: "d1", overrides: [], rules: [{ weekday: 0, startTime: "00:00", endTime: "23:00" }] };
    const slots = computeSlots(base({
      now: dublinToUtc("2026-10-20 08:00"), doctors: [d], fromDate: "2026-10-25", toDate: "2026-10-25",
    }));
    expect(slots).toHaveLength(24 * 4); // 24 real hours from 00:00 BST to 23:00 GMT
  });
});

describe("helpers", () => {
  const slots = computeSlots(base({ doctors: [monToFri("d1"), monToFri("d2")], fromDate: "2026-11-24", toDate: "2026-11-25" }));

  it("lists days with free slots", () => {
    expect(availableDays(slots)).toEqual(["2026-11-24", "2026-11-25"]);
  });
  it("groups by part of day", () => {
    expect(dayPart(dublinToUtc("2026-07-01 11:59"))).toBe("MORNING");
    expect(dayPart(dublinToUtc("2026-07-01 12:00"))).toBe("AFTERNOON");
    expect(dayPart(dublinToUtc("2026-07-01 17:00"))).toBe("EVENING");
  });
  it("finds the next available slot, optionally per doctor", () => {
    expect(nextAvailable(slots)?.doctorId).toBe("d1");
    expect(nextAvailable(slots, "d2")?.doctorId).toBe("d2");
    expect(nextAvailable([], "d2")).toBeUndefined();
  });
});
