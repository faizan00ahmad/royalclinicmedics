import { schema } from "@rmc/db";
import { and, eq, gt, ilike, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { audit } from "../audit";
import { BookingError } from "../booking/errors";
import type { Database } from "../db-types";
import type { Actor } from "./appointments";

/**
 * GDPR-04. Find a person by name, email or phone. Staff only: callers check the `privacy:manage` permission.
 */
export async function findPatients(db: Database, q: string) {
  const term = q.trim();
  if (term.length < 3) return [];
  return db.select({
    id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, email: schema.patients.email,
    phone: schema.patients.phone, dob: schema.patients.dob, deletedAt: schema.patients.deletedAt,
    appointments: sql<number>`(select count(*)::int from core.appointments a where a.patient_id = ${schema.patients.id})`,
  }).from(schema.patients).where(or(
    ilike(schema.patients.email, `%${term}%`), ilike(schema.patients.phone, `%${term}%`),
    ilike(sql`${schema.patients.firstName} || ' ' || ${schema.patients.lastName}`, `%${term}%`),
  )).limit(25);
}

/**
 * The right of access: everything held about one person, as one JSON document. Includes the health questionnaire,
 * so it is audited. Contains no password hashes or tokens.
 */
export async function exportPatientData(db: Database, patientId: string, actor: Actor) {
  const [patient] = await db.select().from(schema.patients).where(eq(schema.patients.id, patientId));
  if (!patient) throw new BookingError("NOT_FOUND", "Patient not found");

  const appointments = await db.select().from(schema.appointments).where(eq(schema.appointments.patientId, patientId));
  const ids = appointments.map((a) => a.id);
  const [payments, consents, enquiries] = await Promise.all([
    ids.length ? db.select().from(schema.payments).where(inArray(schema.payments.appointmentId, ids)) : [],
    db.select().from(schema.consents).where(eq(schema.consents.patientId, patientId)),
    patient.email ? db.select().from(schema.enquiries).where(eq(schema.enquiries.email, patient.email)) : [],
  ]);
  const refunds = payments.length ? await db.select().from(schema.refunds).where(inArray(schema.refunds.paymentId, payments.map((p) => p.id))) : [];

  await audit(db, { actorUserId: actor.id, actorRole: actor.role, action: "privacy.export", entityType: "patient", entityId: patientId, ip: actor.ip });
  return {
    exportedAt: new Date().toISOString(),
    patient,
    appointments: appointments.map(({ manageTokenHash: _h, ...a }) => a),
    payments, refunds, consents, enquiries,
  };
}

/**
 * The right to erasure, in the form a clinic can lawfully give it: personal details and health answers are removed,
 * while the booking and payment records stay (financial record keeping), no longer linked to an identifiable person.
 * Refused while the person still has an upcoming appointment: cancel it first.
 */
export async function anonymisePatient(db: Database, patientId: string, actor: Actor, now: Date = new Date()) {
  return db.transaction(async (tx) => {
    const [patient] = await tx.select().from(schema.patients).where(eq(schema.patients.id, patientId)).for("update");
    if (!patient) throw new BookingError("NOT_FOUND", "Patient not found");
    if (patient.deletedAt) throw new BookingError("INVALID_STATE", "This person has already been anonymised.");

    const [upcoming] = await tx.select({ id: schema.appointments.id }).from(schema.appointments).where(and(
      eq(schema.appointments.patientId, patientId), gt(schema.appointments.startAt, now),
      inArray(schema.appointments.status, ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN"]),
    )).limit(1);
    if (upcoming) throw new BookingError("POLICY", "This person has an upcoming appointment. Cancel it first, then anonymise.");

    const email = patient.email;
    await tx.update(schema.patients).set({
      firstName: "Anonymised", lastName: "Patient", dob: "1900-01-01", email: "", phone: "", addressLine1: null, addressLine2: null, city: null,
      eircode: null, guardianName: null, medicalCard: false, marketingOptIn: false, deletedAt: now, updatedAt: now,
    }).where(eq(schema.patients.id, patientId));
    await tx.update(schema.appointments).set({ questionnaire: null, reason: null, staffNote: null, updatedAt: now }).where(eq(schema.appointments.patientId, patientId));
    await tx.update(schema.consents).set({ ip: null }).where(eq(schema.consents.patientId, patientId));
    if (email) {
      await tx.update(schema.enquiries).set({ name: "Anonymised", email: "", phone: null, message: "[removed at the person's request]", notes: null }).where(eq(schema.enquiries.email, email));
    }
    // Never write the person's details here, only that it happened.
    await audit(tx, { actorUserId: actor.id, actorRole: actor.role, action: "privacy.anonymise", entityType: "patient", entityId: patientId, ip: actor.ip });
  });
}

/**
 * GDPR-05. Daily clean-up. Appointment and payment retention is a clinic decision (see docs/TBD.md) and is NOT
 * touched here. Removes: enquiries older than 2 years, expired hold records older than 24 hours that nothing refers to,
 * ended sessions, and email log lines older than 1 year.
 */
export async function runRetention(db: Database, now: Date = new Date()) {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const DAY = 86_400_000;

  const enquiries = await db.delete(schema.enquiries).where(lt(schema.enquiries.createdAt, ago(730 * DAY))).returning({ id: schema.enquiries.id });
  const referenced = db.select({ id: schema.appointments.holdId }).from(schema.appointments).where(sql`${schema.appointments.holdId} is not null`);
  const holds = await db.delete(schema.slotHolds).where(and(
    inArray(schema.slotHolds.status, ["EXPIRED", "CONSUMED"]), lt(schema.slotHolds.expiresAt, ago(DAY)),
    notInArray(schema.slotHolds.id, referenced),
  )).returning({ id: schema.slotHolds.id });
  const sessions = await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).returning({ id: schema.sessions.id });
  const emails = await db.delete(schema.notificationsSent).where(lt(schema.notificationsSent.sentAt, ago(365 * DAY))).returning({ id: schema.notificationsSent.id });
  return { enquiries: enquiries.length, holds: holds.length, sessions: sessions.length, emailLog: emails.length };
}
