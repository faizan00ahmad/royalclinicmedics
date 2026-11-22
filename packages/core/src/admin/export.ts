import { schema } from "@rmc/db";
import { audit } from "../audit";
import type { Database } from "../db-types";
import { BookingError } from "../booking/errors";
import type { Actor } from "./appointments";
import { eq } from "drizzle-orm";

export type ExportType = "patients" | "appointments" | "payments" | "enquiries" | "consents";
export const EXPORT_TYPES: ExportType[] = ["patients", "appointments", "payments", "enquiries", "consents"];

/** CSV injection guard: a cell starting with = + - @ would run as a formula in Excel. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * AD-14, GDPR-04. Admin only (checked by the caller). Every export is recorded in the audit log and data_exports.
 * Questionnaire answers are deliberately NOT included in any export.
 */
export async function exportCsv(db: Database, type: ExportType, actor: Actor): Promise<{ filename: string; csv: string; rows: number }> {
  if (!EXPORT_TYPES.includes(type)) throw new BookingError("POLICY", "Unknown export.");
  let headers: string[]; let rows: unknown[][];

  if (type === "patients") {
    const r = await db.select().from(schema.patients);
    headers = ["id", "first_name", "last_name", "dob", "email", "phone", "address_line1", "address_line2", "city", "eircode", "medical_card", "guardian_name", "marketing_opt_in", "created_at"];
    rows = r.map((p) => [p.id, p.firstName, p.lastName, p.dob, p.email, p.phone, p.addressLine1, p.addressLine2, p.city, p.eircode, p.medicalCard, p.guardianName, p.marketingOptIn, p.createdAt]);
  } else if (type === "appointments") {
    const r = await db.select({ a: schema.appointments, s: schema.services.name, d: schema.doctors.displayName })
      .from(schema.appointments).innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId)).innerJoin(schema.doctors, eq(schema.doctors.id, schema.appointments.doctorId));
    headers = ["booking_ref", "patient_id", "service", "doctor", "start_at", "end_at", "status", "payment_status", "payment_choice", "total_cents", "source", "created_at", "cancelled_at"];
    rows = r.map(({ a, s, d }) => [a.bookingRef, a.patientId, s, d, a.startAt, a.endAt, a.status, a.paymentStatus, a.paymentChoice, a.totalCents, a.source, a.createdAt, a.cancelledAt]);
  } else if (type === "payments") {
    const r = await db.select().from(schema.payments);
    headers = ["id", "appointment_id", "provider", "stripe_payment_intent_id", "amount_cents", "status", "method", "receipt_number", "paid_at"];
    rows = r.map((p) => [p.id, p.appointmentId, p.provider, p.stripePaymentIntentId, p.amountCents, p.status, p.method, p.receiptNumber, p.paidAt]);
  } else if (type === "enquiries") {
    const r = await db.select().from(schema.enquiries);
    headers = ["id", "name", "email", "phone", "message", "status", "created_at"];
    rows = r.map((e) => [e.id, e.name, e.email, e.phone, e.message, e.status, e.createdAt]);
  } else {
    const r = await db.select().from(schema.consents);
    headers = ["id", "patient_id", "appointment_id", "type", "document_version", "accepted_at", "ip"];
    rows = r.map((c) => [c.id, c.patientId, c.appointmentId, c.type, c.documentVersion, c.acceptedAt, c.ip]);
  }

  await db.insert(schema.dataExports).values({ requestedBy: actor.id, type });
  await audit(db, { actorUserId: actor.id, actorRole: actor.role, action: `export.${type}`, entityType: "export", ip: actor.ip, changes: { rows: rows.length } });
  return { filename: `royal-medics-${type}-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(headers, rows), rows: rows.length };
}
