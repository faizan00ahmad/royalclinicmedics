import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmAppointment, createHold, SlotTakenError } from "../booking";
import { loadBookingSettings } from "../settings";
import { seed } from "../seed/seed";
import { createTestDb } from "../test-utils/pglite";
import { dublinToUtc } from "../time";
import {
  addHoliday, addOverride, createStaffBooking, csvCell, exportCsv, getAppointmentDetail, getDashboard, getSchedule,
  listAppointments, listAllServices, publishLegalPage, saveService, saveSettings, saveWeeklyHours, setAppointmentStatus, toCsv, type Actor,
} from "./index";

const NOW = dublinToUtc("2026-11-20 08:00"); // Friday
const at = (hhmm: string, date = "2026-11-24") => dublinToUtc(`${date} ${hhmm}`);
const actor: Actor = { id: "00000000-0000-4000-8000-000000000001", role: "ADMIN", ip: "9.9.9.9" };
const PATIENT = { firstName: "Aoife", lastName: "Murphy", dob: "1990-04-12", email: "aoife@example.com", phone: "+353871234567" };

let ctx: Awaited<ReturnType<typeof createTestDb>> & { doctorId: string; serviceId: string };
beforeEach(async () => {
  const t = await createTestDb();
  await seed(t.db);
  const [d] = await t.db.select().from(schema.doctors);
  const [s] = await t.db.select().from(schema.services).where(eq(schema.services.slug, "gp-consultation"));
  ctx = { ...t, doctorId: d!.id, serviceId: s!.id };
});

const online = async (hhmm = "09:00", patient = PATIENT) => {
  const h = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at(hhmm), now: NOW });
  return (await confirmAppointment(ctx.db, { holdId: h.id, patient, paymentChoice: "AT_CLINIC", questionnaire: { symptoms: "SECRET-SYMPTOM" }, reason: "r", now: NOW })).appointment;
};
const audits = async () => (await ctx.db.select().from(schema.auditLogs)).map((a) => a.action);

describe("appointment list and detail", () => {
  it("lists, filters and searches by name, phone, email and reference", async () => {
    const a = await online("09:00");
    await online("09:15", { ...PATIENT, firstName: "Sean", lastName: "Byrne", email: "sean@example.com", phone: "+353861111111", dob: "1980-01-01" });
    expect((await listAppointments(ctx.db)).total).toBe(2);
    expect((await listAppointments(ctx.db, { q: "murphy" })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await listAppointments(ctx.db, { q: "Aoife Murphy" })).total).toBe(1);
    expect((await listAppointments(ctx.db, { q: "861111" })).total).toBe(1);
    expect((await listAppointments(ctx.db, { q: "sean@" })).total).toBe(1);
    expect((await listAppointments(ctx.db, { q: a.bookingRef.toLowerCase() })).total).toBe(1);
    expect((await listAppointments(ctx.db, { status: "CANCELLED_BY_PATIENT" })).total).toBe(0);
    expect((await listAppointments(ctx.db, { fromUtc: at("00:00", "2026-11-25") })).total).toBe(0);
  });

  it("pages results", async () => {
    await online("09:00"); await online("09:15"); await online("09:30");
    const p = await listAppointments(ctx.db, { pageSize: 2, page: 2 });
    expect(p.rows).toHaveLength(1);
    expect(p.total).toBe(3);
  });

  it("hides the questionnaire unless asked, and asking is audited; never exposes the token hash", async () => {
    const a = await online();
    const without = await getAppointmentDetail(ctx.db, a.id, { includeQuestionnaire: false, actor });
    expect(without!.questionnaire).toBeUndefined();
    expect(JSON.stringify(without)).not.toContain("SECRET-SYMPTOM");
    expect(JSON.stringify(without)).not.toContain(a.manageTokenHash);
    expect(await audits()).not.toContain("appointment.view_questionnaire");

    const withQ = await getAppointmentDetail(ctx.db, a.id, { includeQuestionnaire: true, actor });
    expect(JSON.stringify(withQ!.questionnaire)).toContain("SECRET-SYMPTOM");
    expect(await audits()).toContain("appointment.view_questionnaire");
  });
});

describe("status changes", () => {
  it("check in then complete, with events and audit", async () => {
    const a = await online();
    await setAppointmentStatus(ctx.db, { id: a.id, to: "CHECKED_IN", actor, now: NOW });
    await setAppointmentStatus(ctx.db, { id: a.id, to: "COMPLETED", actor, now: NOW });
    const [row] = await ctx.db.select().from(schema.appointments);
    expect(row!.status).toBe("COMPLETED");
    expect(row!.checkedInAt).not.toBeNull();
    expect((await ctx.db.select().from(schema.domainEvents)).map((e) => e.type)).toContain("appointment.checked_in");
    expect(await audits()).toEqual(expect.arrayContaining(["appointment.checked_in", "appointment.completed"]));
  });

  it("rejects invalid transitions", async () => {
    const a = await online();
    await setAppointmentStatus(ctx.db, { id: a.id, to: "COMPLETED", actor, now: NOW });
    await expect(setAppointmentStatus(ctx.db, { id: a.id, to: "CHECKED_IN", actor, now: NOW })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(setAppointmentStatus(ctx.db, { id: a.id, to: "NO_SHOW", actor, now: NOW })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("a future no-show frees the slot", async () => {
    const a = await online();
    await setAppointmentStatus(ctx.db, { id: a.id, to: "NO_SHOW", actor, now: NOW });
    await expect(createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("09:00"), now: NOW })).resolves.toBeDefined();
  });
});

describe("walk-in and phone bookings", () => {
  const walk = (startAt: Date, extra: object = {}) =>
    createStaffBooking(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt, patient: { ...PATIENT, email: "" }, paymentChoice: "AT_CLINIC", actor, now: NOW, ...extra });

  it("books a normal slot with no warning and blocks it for everyone else", async () => {
    const r = await walk(at("10:00"));
    expect(r.outsideNormalHours).toBe(false);
    expect(r.appointment.source).toBe("WALK_IN");
    await expect(createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("10:00"), now: NOW })).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("allows an outside-hours slot but flags it", async () => {
    const r = await walk(at("19:00"));
    expect(r.outsideNormalHours).toBe(true);
    expect(r.appointment.status).toBe("CONFIRMED");
  });

  it("ignores minimum notice (a patient walking in right now)", async () => {
    const now = dublinToUtc("2026-11-24 09:00");
    const r = await createStaffBooking(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: now, patient: { ...PATIENT, email: "" }, paymentChoice: "AT_CLINIC", checkIn: true, actor, now });
    expect(r.appointment.status).toBe("CHECKED_IN");
  });

  it("can never double-book: same guard as online bookings", async () => {
    await online("09:00");
    await expect(walk(at("09:00"))).rejects.toBeInstanceOf(SlotTakenError);
    await expect(walk(at("09:10"))).rejects.toBeInstanceOf(SlotTakenError); // overlaps the 09:00-09:15 appointment
    expect(await ctx.db.select().from(schema.appointments)).toHaveLength(1);
  });

  it("free bookings cost nothing and count as paid", async () => {
    const r = await walk(at("10:00"), { paymentChoice: "FREE", source: "PHONE" });
    expect(r.appointment.totalCents).toBe(0);
    expect(r.appointment.paymentStatus).toBe("PAID");
    expect(r.appointment.source).toBe("PHONE");
  });

  it("accepts a patient without an email, and audits the booking", async () => {
    const r = await walk(at("10:00"));
    const [p] = await ctx.db.select().from(schema.patients).where(eq(schema.patients.id, r.appointment.patientId));
    expect(p!.email).toBe("");
    expect(await audits()).toContain("appointment.staff_create");
  });
});

describe("dashboard", () => {
  it("counts today, this week, new bookings, unpaid at clinic and takings", async () => {
    await online("09:00");
    await online("09:15");
    const mid = dublinToUtc("2026-11-24 12:00"); // Tuesday, same week as the bookings
    const d = await getDashboard(ctx.db, { now: mid });
    expect(d.today).toBe("2026-11-24");
    expect(d.counts.today).toBe(2);
    expect(d.counts.week).toBe(2);
    expect(d.counts.unpaidAtClinic).toBe(2);
    expect(d.timeline).toHaveLength(2);
    expect(d.timeline[0]!.startAt < d.timeline[1]!.startAt).toBe(true);
    const other = await getDashboard(ctx.db, { now: dublinToUtc("2026-11-25 12:00") });
    expect(other.counts.today).toBe(0);
    expect(other.counts.week).toBe(2);
  });

  it("restricts to one doctor", async () => {
    await online("09:00");
    const [other] = await ctx.db.insert(schema.doctors).values({ displayName: "Dr Other" }).returning();
    const d = await getDashboard(ctx.db, { now: dublinToUtc("2026-11-24 12:00"), doctorId: other!.id });
    expect(d.counts.today).toBe(0);
    expect(d.timeline).toHaveLength(0);
  });
});

describe("services and prices (AD-07)", () => {
  it("creates a service, makes a slug, links doctors, and the price change is audited", async () => {
    const id = await saveService(ctx.db, { name: "Travel Health Advice", priceCents: 8000, durationMin: 20, doctorIds: [ctx.doctorId] }, actor);
    const all = await listAllServices(ctx.db);
    const svc = all.find((s) => s.id === id)!;
    expect(svc.slug).toBe("travel-health-advice");
    expect(svc.doctorIds).toEqual([ctx.doctorId]);
    await saveService(ctx.db, { id, name: "Travel Health Advice", priceCents: 9000, durationMin: 20, doctorIds: [ctx.doctorId] }, actor);
    const log = (await ctx.db.select().from(schema.auditLogs)).find((a) => a.action === "service.update");
    expect(log!.changes).toMatchObject({ priceFrom: 8000, priceTo: 9000 });
  });

  it("rejects a duplicate web address and bad numbers", async () => {
    await expect(saveService(ctx.db, { name: "Another", slug: "gp-consultation", priceCents: 100, durationMin: 15 }, actor)).rejects.toMatchObject({ code: "POLICY" });
    await expect(saveService(ctx.db, { name: "Bad", priceCents: -5, durationMin: 15 }, actor)).rejects.toThrow();
    await expect(saveService(ctx.db, { name: "Bad", priceCents: 100, durationMin: 0 }, actor)).rejects.toThrow();
  });

  it("a hidden service disappears from bookable services", async () => {
    await saveService(ctx.db, { id: ctx.serviceId, name: "GP consultation", slug: "gp-consultation", priceCents: 6000, durationMin: 15, active: false }, actor);
    const [row] = await ctx.db.select().from(schema.services).where(eq(schema.services.id, ctx.serviceId));
    expect(row!.active).toBe(false);
  });
});

describe("schedules, holidays, overrides (AD-09)", () => {
  it("replaces weekly hours and rejects overlapping ranges", async () => {
    await saveWeeklyHours(ctx.db, ctx.doctorId, [{ weekday: 1, startTime: "08:00", endTime: "12:00" }], actor);
    expect((await getSchedule(ctx.db, ctx.doctorId)).rules).toHaveLength(1);
    await expect(saveWeeklyHours(ctx.db, ctx.doctorId, [
      { weekday: 1, startTime: "08:00", endTime: "12:00" }, { weekday: 1, startTime: "11:00", endTime: "13:00" },
    ], actor)).rejects.toMatchObject({ code: "POLICY" });
    await expect(saveWeeklyHours(ctx.db, ctx.doctorId, [{ weekday: 1, startTime: "12:00", endTime: "08:00" }], actor)).rejects.toThrow();
    expect((await getSchedule(ctx.db, ctx.doctorId)).rules).toHaveLength(1); // failed saves changed nothing
  });

  it("changes show up in availability immediately", async () => {
    const { getAvailability } = await import("../booking");
    await saveWeeklyHours(ctx.db, ctx.doctorId, [{ weekday: 2, startTime: "10:00", endTime: "11:00" }], actor);
    const slots = await getAvailability(ctx.db, { serviceId: ctx.serviceId, fromDate: "2026-11-24", toDate: "2026-11-24", now: NOW });
    expect(slots).toHaveLength(4);
    await addHoliday(ctx.db, { date: "2026-11-24", name: "Clinic closed" }, actor);
    expect(await getAvailability(ctx.db, { serviceId: ctx.serviceId, fromDate: "2026-11-24", toDate: "2026-11-24", now: NOW })).toHaveLength(0);
    await addOverride(ctx.db, { doctorId: ctx.doctorId, date: "2026-11-24", isClosed: false, startTime: "14:00", endTime: "15:00" }, actor);
    expect(await getAvailability(ctx.db, { serviceId: ctx.serviceId, fromDate: "2026-11-24", toDate: "2026-11-24", now: NOW })).toHaveLength(4);
  });
});

describe("settings (AD-12)", () => {
  it("saves valid values and the booking engine uses them", async () => {
    await saveSettings(ctx.db, { "booking.holdMinutes": 5, "booking.cancellationWindowHours": 48, "clinic.phone": "+353 1 234 5678" }, actor);
    const s = await loadBookingSettings(ctx.db);
    expect(s.holdMinutes).toBe(5);
    expect(s.cancellationWindowHours).toBe(48);
  });
  it("rejects unknown keys and out-of-range numbers, saving nothing", async () => {
    await expect(saveSettings(ctx.db, { "booking.holdMinutes": 5, "evil.key": "x" }, actor)).rejects.toMatchObject({ code: "POLICY" });
    await expect(saveSettings(ctx.db, { "booking.holdMinutes": 9999 }, actor)).rejects.toMatchObject({ code: "POLICY" });
    expect((await loadBookingSettings(ctx.db)).holdMinutes).toBe(10);
  });
  it("cannot switch on online consultations from here (Phase 2 flag)", async () => {
    await expect(saveSettings(ctx.db, { "features.onlineConsultations": true }, actor)).rejects.toMatchObject({ code: "POLICY" });
  });
});

describe("legal pages are versioned", () => {
  it("each publish adds a version and the old one is kept", async () => {
    const v = await publishLegalPage(ctx.db, { key: "privacy", text: "New text" }, actor);
    expect(v).toBe(2);
    expect((await ctx.db.select().from(schema.pages).where(eq(schema.pages.key, "privacy")))).toHaveLength(2);
    await expect(publishLegalPage(ctx.db, { key: "other", text: "x" }, actor)).rejects.toMatchObject({ code: "POLICY" });
  });
});

describe("exports (AD-14)", () => {
  it("escapes CSV and defuses spreadsheet formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toMatch(/^"?'=/);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
  });

  it("exports patients, is audited, and never includes questionnaire answers", async () => {
    await online();
    const p = await exportCsv(ctx.db, "patients", actor);
    expect(p.rows).toBe(1);
    expect(p.csv).toContain("Aoife");
    const a = await exportCsv(ctx.db, "appointments", actor);
    expect(a.csv).not.toContain("SECRET-SYMPTOM");
    expect(a.csv.split("\r\n")[0]).not.toContain("questionnaire");
    expect(await audits()).toEqual(expect.arrayContaining(["export.patients", "export.appointments"]));
    expect(await ctx.db.select().from(schema.dataExports)).toHaveLength(2);
  });

  it("refuses unknown export types", async () => {
    await expect(exportCsv(ctx.db, "passwords" as never, actor)).rejects.toMatchObject({ code: "POLICY" });
  });
});
