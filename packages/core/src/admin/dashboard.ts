import { schema } from "@rmc/db";
import { and, asc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db-types";
import { addDays, dublinDate } from "../slots";
import { dublinToUtc } from "../time";

const startOfDay = (date: string) => dublinToUtc(`${date} 00:00`);

/** AD-01. `doctorId` restricts everything to one doctor (doctor logins). */
export async function getDashboard(db: Database, opts: { now?: Date; doctorId?: string } = {}) {
  const now = opts.now ?? new Date();
  const today = dublinDate(now);
  const dayStart = startOfDay(today);
  const dayEnd = startOfDay(addDays(today, 1));
  // Week = Monday to Sunday in Dublin
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const weekStart = startOfDay(addDays(today, -weekday));
  const weekEnd = startOfDay(addDays(today, 7 - weekday));
  const monthStart = startOfDay(`${today.slice(0, 7)}-01`);
  const last24h = new Date(now.getTime() - 24 * 3_600_000);
  const live = ["CONFIRMED", "CHECKED_IN", "COMPLETED"] as const;

  const forDoctor = (col: typeof schema.appointments.doctorId): SQL | undefined => (opts.doctorId ? eq(col, opts.doctorId) : undefined);
  const count = async (...w: (SQL | undefined)[]) => {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.appointments).where(and(forDoctor(schema.appointments.doctorId), ...w));
    return r?.n ?? 0;
  };
  const paidSince = async (from: Date) => {
    const [r] = await db.select({ total: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)::int` })
      .from(schema.payments)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.payments.appointmentId))
      .where(and(inArray(schema.payments.status, ["PAID", "PARTIALLY_REFUNDED"]), gte(schema.payments.paidAt, from), forDoctor(schema.appointments.doctorId)));
    return r?.total ?? 0;
  };

  const timeline = await db.select({
    id: schema.appointments.id, bookingRef: schema.appointments.bookingRef, startAt: schema.appointments.startAt, status: schema.appointments.status,
    paymentStatus: schema.appointments.paymentStatus, patientName: sql<string>`${schema.patients.firstName} || ' ' || ${schema.patients.lastName}`,
    serviceName: schema.services.name, doctorName: schema.doctors.displayName,
  })
    .from(schema.appointments)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.appointments.patientId))
    .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
    .innerJoin(schema.doctors, eq(schema.doctors.id, schema.appointments.doctorId))
    .where(and(gte(schema.appointments.startAt, dayStart), lt(schema.appointments.startAt, dayEnd), inArray(schema.appointments.status, [...live, "PENDING_PAYMENT"]), forDoctor(schema.appointments.doctorId)))
    .orderBy(asc(schema.appointments.startAt));

  const [today_, week, new24h, unpaidAtClinic, paidToday, paidMonth, newEnquiries] = await Promise.all([
    count(gte(schema.appointments.startAt, dayStart), lt(schema.appointments.startAt, dayEnd), inArray(schema.appointments.status, [...live])),
    count(gte(schema.appointments.startAt, weekStart), lt(schema.appointments.startAt, weekEnd), inArray(schema.appointments.status, [...live])),
    count(gte(schema.appointments.createdAt, last24h), inArray(schema.appointments.status, [...live])),
    count(eq(schema.appointments.paymentChoice, "AT_CLINIC"), eq(schema.appointments.paymentStatus, "UNPAID"), inArray(schema.appointments.status, ["CONFIRMED", "CHECKED_IN", "COMPLETED"])),
    paidSince(dayStart),
    paidSince(monthStart),
    opts.doctorId ? Promise.resolve(0) : db.select({ n: sql<number>`count(*)::int` }).from(schema.enquiries).where(eq(schema.enquiries.status, "NEW")).then((r) => r[0]?.n ?? 0),
  ]);

  return { today, counts: { today: today_, week, new24h, unpaidAtClinic, newEnquiries }, paidTodayCents: paidToday, paidMonthCents: paidMonth, timeline };
}
