import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import type { Database } from "../db-types";
import { loadBookingSettings, loadSettingsMap } from "../settings";
import { verifyManageToken } from "./tokens";

export type AppointmentRow = typeof schema.appointments.$inferSelect;

/**
 * SEC-04. The booking reference alone reveals nothing. Returns null for an unknown reference
 * AND for a wrong token, so the two cannot be told apart.
 */
export async function resolveAppointmentByToken(db: Database, ref: string, token: string): Promise<AppointmentRow | null> {
  if (!token || token.length < 20) return null;
  const [appt] = await db.select().from(schema.appointments).where(eq(schema.appointments.bookingRef, ref.toUpperCase()));
  if (!appt || !verifyManageToken(token, appt.manageTokenHash)) return null;
  return appt;
}

export interface BookingSummary {
  bookingRef: string;
  status: AppointmentRow["status"];
  paymentStatus: AppointmentRow["paymentStatus"];
  paymentChoice: AppointmentRow["paymentChoice"];
  startAt: string;
  endAt: string;
  totalCents: number;
  service: { name: string; slug: string };
  doctor: { displayName: string };
  patientFirstName: string;
  canCancelFree: boolean;
  canReschedule: boolean;
  reschedulesLeft: number;
  cancellationWindowHours: number;
  clinic: { name: string; phone: string; address: string };
}

/** Everything the manage page needs. Deliberately excludes questionnaire answers, reason and contact details. */
export async function getBookingSummary(db: Database, appt: AppointmentRow, now: Date = new Date()): Promise<BookingSummary> {
  const [[service], [doctor], [patient], settings, map] = await Promise.all([
    db.select().from(schema.services).where(eq(schema.services.id, appt.serviceId)),
    db.select().from(schema.doctors).where(eq(schema.doctors.id, appt.doctorId)),
    db.select().from(schema.patients).where(eq(schema.patients.id, appt.patientId)),
    loadBookingSettings(db),
    loadSettingsMap(db),
  ]);
  const hoursBefore = (appt.startAt.getTime() - now.getTime()) / 3_600_000;
  const outsideWindow = hoursBefore >= settings.cancellationWindowHours;
  const active = appt.status === "CONFIRMED";
  const left = Math.max(0, settings.maxReschedules - appt.rescheduleCount);
  return {
    bookingRef: appt.bookingRef,
    status: appt.status,
    paymentStatus: appt.paymentStatus,
    paymentChoice: appt.paymentChoice,
    startAt: appt.startAt.toISOString(),
    endAt: appt.endAt.toISOString(),
    totalCents: appt.totalCents,
    service: { name: service?.name ?? "", slug: service?.slug ?? "" },
    doctor: { displayName: doctor?.displayName ?? "" },
    patientFirstName: patient?.firstName ?? "",
    canCancelFree: (active || appt.status === "PENDING_PAYMENT") && outsideWindow,
    canReschedule: active && outsideWindow && left > 0,
    reschedulesLeft: left,
    cancellationWindowHours: settings.cancellationWindowHours,
    clinic: {
      name: String(map["clinic.name"] ?? ""),
      phone: String(map["clinic.phone"] ?? ""),
      address: String(map["clinic.address"] ?? ""),
    },
  };
}
