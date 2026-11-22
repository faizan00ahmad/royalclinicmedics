import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { manageTokenFor } from "../booking/tokens";
import { getClinicInfo, isTbd, type ClinicInfo } from "../content";
import type { Database } from "../db-types";
import { formatEuro } from "../money";
import { CLINIC_TZ } from "../time";
import type { Vars } from "./render";

export interface EmailEnv {
  /** Public address of the website, e.g. https://www.royalclinicmedics.ie (no trailing slash). */
  siteUrl: string;
  /** Used for clinic alerts while the clinic email setting is still a placeholder. */
  clinicNotifyFallback?: string;
}

const clean = (v: string) => v.replace(/\s*\[TBD\]\s*/g, " ").trim();
export const looksLikeEmail = (v: string | null | undefined): v is string => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function clinicRecipient(clinic: ClinicInfo, env: EmailEnv): string | null {
  if (!isTbd(clinic.email) && looksLikeEmail(clinic.email)) return clinic.email;
  return looksLikeEmail(env.clinicNotifyFallback) ? env.clinicNotifyFallback : null;
}

export interface AppointmentEmailData {
  appointment: typeof schema.appointments.$inferSelect;
  patientEmail: string | null;
  doctorEmail: string | null;
  clinic: ClinicInfo;
  clinicEmail: string | null;
  token: string;
  vars: Vars;
}

/**
 * Everything an appointment email may say. Deliberately has no access to the questionnaire or the reason for the
 * visit: those columns are never read here (SEC-07).
 */
export async function loadAppointmentEmailData(db: Database, appointmentId: string, env: EmailEnv): Promise<AppointmentEmailData | null> {
  const [appt] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId));
  if (!appt) return null;
  const [[patient], [service], [doctor], clinic] = await Promise.all([
    db.select().from(schema.patients).where(eq(schema.patients.id, appt.patientId)),
    db.select().from(schema.services).where(eq(schema.services.id, appt.serviceId)),
    db.select().from(schema.doctors).where(eq(schema.doctors.id, appt.doctorId)),
    getClinicInfo(db),
  ]);
  let doctorEmail: string | null = null;
  if (doctor?.userId) {
    const [u] = await db.select({ email: schema.users.email, isActive: schema.users.isActive }).from(schema.users).where(eq(schema.users.id, doctor.userId));
    if (u?.isActive && looksLikeEmail(u.email)) doctorEmail = u.email;
  }

  const token = manageTokenFor(appt.id);
  const site = env.siteUrl.replace(/\/$/, "");
  const price = formatEuro(appt.totalCents);
  const paymentNote =
    appt.paymentStatus === "PAID" && appt.totalCents > 0 ? `Payment received: ${price}. Thank you.`
    : appt.paymentChoice === "AT_CLINIC" && appt.paymentStatus === "UNPAID" ? `Please pay ${price} at the clinic.`
    : "";

  const vars: Vars = {
    firstName: patient?.firstName ?? "",
    patientName: patient ? `${patient.firstName} ${patient.lastName}` : "",
    service: service?.name ?? "",
    doctor: doctor?.displayName ?? "",
    date: formatInTimeZone(appt.startAt, CLINIC_TZ, "EEE d MMM yyyy"),
    time: formatInTimeZone(appt.startAt, CLINIC_TZ, "HH:mm"),
    ref: appt.bookingRef,
    manageLink: `${site}/booking/${appt.bookingRef}#token=${token}`,
    calendarLink: `${site}/api/bookings/${appt.bookingRef}/ics?token=${encodeURIComponent(token)}`,
    adminLink: `${site}/admin/appointments/${appt.id}`,
    clinicName: clinic.name,
    clinicPhone: clean(clinic.phone) || "the clinic",
    clinicAddress: clean(clinic.address),
    amount: price,
    paymentNote,
    cancellationHours: clinic.cancellationWindowHours,
    source: appt.source.replace("_", " ").toLowerCase(),
  };
  return {
    appointment: appt, patientEmail: looksLikeEmail(patient?.email) ? patient!.email : null, doctorEmail,
    clinic, clinicEmail: clinicRecipient(clinic, env), token, vars,
  };
}
