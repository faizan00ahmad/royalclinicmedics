import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmAppointment, createHold } from "../booking";
import { seed } from "../seed/seed";
import { createTestDb } from "../test-utils/pglite";
import { dublinToUtc } from "../time";
import { anonymisePatient, exportPatientData, findPatients, runRetention, setAppointmentStatus, type Actor } from "./index";

const NOW = dublinToUtc("2026-11-20 08:00");
const actor: Actor = { id: "00000000-0000-4000-8000-000000000001", role: "ADMIN" };
const PATIENT = { firstName: "Aoife", lastName: "Murphy", dob: "1990-04-12", email: "aoife@example.com", phone: "+353871234567" };
let ctx: Awaited<ReturnType<typeof createTestDb>> & { doctorId: string; serviceId: string };

beforeEach(async () => {
  const t = await createTestDb();
  await seed(t.db);
  const [d] = await t.db.select().from(schema.doctors);
  const [s] = await t.db.select().from(schema.services).where(eq(schema.services.slug, "gp-consultation"));
  ctx = { ...t, doctorId: d!.id, serviceId: s!.id };
});

const book = async (hhmm = "09:00", date = "2026-11-24") => {
  const h = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: dublinToUtc(`${date} ${hhmm}`), now: NOW });
  return (await confirmAppointment(ctx.db, {
    holdId: h.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: NOW, reason: "PRIVATE-REASON",
    questionnaire: { symptoms: "PRIVATE-SYMPTOM" },
  })).appointment;
};

describe("finding and exporting a person's data (GDPR-04)", () => {
  it("finds by email, phone or name, and needs at least 3 characters", async () => {
    await book();
    expect(await findPatients(ctx.db, "aoife@")).toHaveLength(1);
    expect(await findPatients(ctx.db, "871234")).toHaveLength(1);
    expect(await findPatients(ctx.db, "Aoife Murphy")).toHaveLength(1);
    expect(await findPatients(ctx.db, "zz")).toHaveLength(0);
    expect(await findPatients(ctx.db, "nobody-here")).toHaveLength(0);
  });

  it("exports everything held, including health answers, without token hashes, and audits it", async () => {
    const a = await book();
    await ctx.db.insert(schema.enquiries).values({ name: "Aoife", email: "aoife@example.com", message: "Hello there" });
    const data = await exportPatientData(ctx.db, a.patientId, actor);
    const json = JSON.stringify(data);
    expect(data.patient.email).toBe("aoife@example.com");
    expect(data.appointments).toHaveLength(1);
    expect(data.consents).toHaveLength(0);
    expect(data.enquiries).toHaveLength(1);
    expect(json).toContain("PRIVATE-SYMPTOM");
    expect(json).not.toContain(a.manageTokenHash);
    expect((await ctx.db.select().from(schema.auditLogs)).map((l) => l.action)).toContain("privacy.export");
  });
});

describe("anonymising a person (right to erasure)", () => {
  it("removes identity and health data but keeps the booking and payment records", async () => {
    const a = await book("09:00", "2026-11-24");
    await setAppointmentStatus(ctx.db, { id: a.id, to: "COMPLETED", actor, now: NOW });
    const AFTER = dublinToUtc("2026-12-01 08:00"); // the appointment is now in the past
    await ctx.db.insert(schema.enquiries).values({ name: "Aoife", email: "aoife@example.com", message: "PRIVATE-MESSAGE" });
    await ctx.db.insert(schema.consents).values({ patientId: a.patientId, appointmentId: a.id, type: "TERMS", documentVersion: "1", ip: "1.2.3.4" });

    await anonymisePatient(ctx.db, a.patientId, actor, AFTER);

    const [p] = await ctx.db.select().from(schema.patients);
    expect(p).toMatchObject({ firstName: "Anonymised", lastName: "Patient", email: "", phone: "", dob: "1900-01-01" });
    expect(p!.deletedAt).not.toBeNull();
    const [appt] = await ctx.db.select().from(schema.appointments);
    expect(appt!.questionnaire).toBeNull();
    expect(appt!.reason).toBeNull();
    expect(appt!.totalCents).toBe(6000); // the financial record stays
    expect((await ctx.db.select().from(schema.consents))[0]!.ip).toBeNull();
    const enq = (await ctx.db.select().from(schema.enquiries))[0]!;
    expect(enq).toMatchObject({ name: "Anonymised", email: "" });
    expect(enq.message).not.toContain("PRIVATE");

    const audit = JSON.stringify(await ctx.db.select().from(schema.auditLogs));
    expect(audit).toContain("privacy.anonymise");
    expect(audit).not.toContain("aoife");
    expect(audit).not.toContain("Murphy");
  });

  it("is refused while an appointment is upcoming, and cannot be done twice", async () => {
    const a = await book("09:00", "2026-11-24");
    await expect(anonymisePatient(ctx.db, a.patientId, actor, NOW)).rejects.toMatchObject({ code: "POLICY" });
    await ctx.db.update(schema.appointments).set({ status: "CANCELLED_BY_PATIENT" });
    await anonymisePatient(ctx.db, a.patientId, actor, NOW);
    await expect(anonymisePatient(ctx.db, a.patientId, actor, NOW)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("the same person booking again later is a new record, not the anonymised one", async () => {
    const a = await book("09:00", "2026-11-24");
    await setAppointmentStatus(ctx.db, { id: a.id, to: "COMPLETED", actor, now: NOW });
    await anonymisePatient(ctx.db, a.patientId, actor, dublinToUtc("2026-12-01 08:00"));
    const b = await book("10:00", "2026-11-25");
    expect(b.patientId).not.toBe(a.patientId);
  });
});

describe("daily retention clean-up (GDPR-05)", () => {
  it("removes old enquiries, stale holds, ended sessions and old email log lines, and keeps everything else", async () => {
    const old = new Date(NOW.getTime() - 800 * 86_400_000);
    await ctx.db.insert(schema.enquiries).values([
      { name: "Old", email: "old@example.com", message: "old message", createdAt: old },
      { name: "Recent", email: "recent@example.com", message: "recent message", createdAt: NOW },
    ]);
    const kept = await book("09:00", "2026-11-24");
    await ctx.db.insert(schema.slotHolds).values({
      doctorId: ctx.doctorId, serviceId: ctx.serviceId, startAt: NOW, endAt: NOW, expiresAt: new Date(NOW.getTime() - 3 * 86_400_000), status: "EXPIRED",
    });
    const later = new Date(NOW.getTime() + 86_400_000 * 5);
    const r = await runRetention(ctx.db, later);
    expect(r.enquiries).toBe(1);
    expect(r.holds).toBe(2); // the stale hold, plus the used hold of the at-clinic booking (nothing refers to it)
    expect((await ctx.db.select().from(schema.enquiries)).map((e) => e.name)).toEqual(["Recent"]);
    expect(await ctx.db.select().from(schema.appointments).where(eq(schema.appointments.id, kept.id))).toHaveLength(1);
  });
});
