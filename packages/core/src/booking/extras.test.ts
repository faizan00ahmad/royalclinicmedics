import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { seed } from "../seed/seed";
import { createTestDb } from "../test-utils/pglite";
import { dublinToUtc } from "../time";
import {
  buildIcs, confirmAppointment, createHold, getBookingSummary, parseQuestionnaire, recordConsents,
  resolveAppointmentByToken,
} from "./index";

const NOW = dublinToUtc("2026-11-20 08:00");
const PATIENT = { firstName: "Aoife", lastName: "Murphy", dob: "1990-04-12", email: "aoife@example.com", phone: "+353871234567" };
let ctx: Awaited<ReturnType<typeof createTestDb>> & { doctorId: string; serviceId: string };

beforeEach(async () => {
  const t = await createTestDb();
  await seed(t.db);
  const [d] = await t.db.select().from(schema.doctors);
  const [s] = await t.db.select().from(schema.services).where(eq(schema.services.slug, "gp-consultation"));
  ctx = { ...t, doctorId: d!.id, serviceId: s!.id };
});

const book = async (hhmm = "09:00") => {
  const hold = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: dublinToUtc(`2026-11-24 ${hhmm}`), now: NOW });
  return confirmAppointment(ctx.db, { holdId: hold.id, patient: PATIENT, paymentChoice: "AT_CLINIC", reason: "private reason", now: NOW });
};

describe("questionnaire", () => {
  it("accepts valid answers and adds a version", () => {
    const q = parseQuestionnaire({ allergies: { has: false }, smoker: false });
    expect(q.version).toBe(1);
    expect(q.conditions).toEqual([]);
  });
  it("rejects unknown fields and bad conditions", () => {
    expect(() => parseQuestionnaire({ allergies: { has: false }, smoker: false, extra: 1 })).toThrow();
    expect(() => parseQuestionnaire({ allergies: { has: false }, smoker: false, conditions: ["NOPE"] })).toThrow();
  });
});

describe("manage lookup", () => {
  it("needs the right token; wrong ref or token look identical", async () => {
    const { appointment, manageToken } = await book();
    expect((await resolveAppointmentByToken(ctx.db, appointment.bookingRef, manageToken))?.id).toBe(appointment.id);
    expect((await resolveAppointmentByToken(ctx.db, appointment.bookingRef.toLowerCase(), manageToken))?.id).toBe(appointment.id);
    expect(await resolveAppointmentByToken(ctx.db, appointment.bookingRef, "x".repeat(43))).toBeNull();
    expect(await resolveAppointmentByToken(ctx.db, "RMC-NOPE22", manageToken)).toBeNull();
    expect(await resolveAppointmentByToken(ctx.db, appointment.bookingRef, "")).toBeNull();
  });

  it("summary excludes health and contact details", async () => {
    const { appointment } = await book();
    const s = await getBookingSummary(ctx.db, appointment, NOW);
    const json = JSON.stringify(s);
    expect(json).not.toContain("private reason");
    expect(json).not.toContain("aoife@example.com");
    expect(json).not.toContain("+353871234567");
    expect(s.canCancelFree).toBe(true);
    expect(s.canReschedule).toBe(true);
    expect(s.reschedulesLeft).toBe(2);
    expect(s.patientFirstName).toBe("Aoife");
  });

  it("summary flags the cancellation window", async () => {
    const { appointment } = await book();
    const s = await getBookingSummary(ctx.db, appointment, dublinToUtc("2026-11-23 15:00"));
    expect(s.canCancelFree).toBe(false);
    expect(s.canReschedule).toBe(false);
  });
});

describe("consents", () => {
  it("stores the document versions, ip and marketing choice", async () => {
    const { appointment } = await book();
    await recordConsents(ctx.db, { appointmentId: appointment.id, ip: "203.0.113.5", terms: true, privacy: true, cancellation: true, marketing: true });
    const rows = await ctx.db.select().from(schema.consents);
    expect(rows.map((r) => r.type).sort()).toEqual(["CANCELLATION", "MARKETING", "PRIVACY", "TERMS"]);
    expect(rows.every((r) => r.ip === "203.0.113.5")).toBe(true);
    expect(rows.find((r) => r.type === "TERMS")!.documentVersion).toBe("1");
    const [p] = await ctx.db.select().from(schema.patients);
    expect(p!.marketingOptIn).toBe(true);
  });
  it("refuses when a mandatory consent is missing and stores nothing", async () => {
    const { appointment } = await book();
    await expect(recordConsents(ctx.db, { appointmentId: appointment.id, terms: true, privacy: false, cancellation: true }))
      .rejects.toMatchObject({ code: "POLICY" });
    expect(await ctx.db.select().from(schema.consents)).toHaveLength(0);
  });
});

describe("ics", () => {
  const base = {
    bookingRef: "RMC-ABC234", startAt: new Date("2026-11-24T09:00:00Z"), endAt: new Date("2026-11-24T09:15:00Z"),
    serviceName: "GP consultation", clinicName: "Royal Medics Clinic", clinicAddress: "1 Main St, Dublin; D01", clinicPhone: "+353 1 000 0000",
    now: new Date("2026-11-20T08:00:00Z"),
  };
  it("builds a valid calendar with CRLF and escaping", () => {
    const ics = buildIcs(base);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261124T090000Z");
    expect(ics).toContain("DTEND:20261124T091500Z");
    expect(ics).toContain("UID:RMC-ABC234@royalclinicmedics.ie");
    expect(ics).toContain(String.raw`LOCATION:1 Main St\, Dublin\; D01`);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("folds long lines at 75 octets", () => {
    const ics = buildIcs({ ...base, clinicAddress: "A".repeat(200) });
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});
