import { randomUUID } from "node:crypto";
import { schema } from "@rmc/db";
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { audit } from "../audit";
import { BookingError, SlotTakenError, isExclusionViolation, isUniqueViolation } from "../booking/errors";
import { emitEvent } from "../booking/events";
import { releaseExpiredHolds } from "../booking/hold";
import { findOrCreatePatient, staffPatientInput } from "../booking/patients";
import { generateBookingRef, generateManageToken } from "../booking/tokens";
import { loadAvailability } from "../booking/availability";
import type { Database } from "../db-types";
import { computeSlots, dublinDate } from "../slots";
import { z } from "zod";

export interface Actor { id: string; role: string; ip?: string | null }

type Status = (typeof schema.appointments.$inferSelect)["status"];
type PayStatus = (typeof schema.appointments.$inferSelect)["paymentStatus"];

export interface AppointmentFilter {
  fromUtc?: Date;
  toUtc?: Date;
  doctorId?: string;
  serviceId?: string;
  status?: Status;
  paymentStatus?: PayStatus;
  q?: string;
  page?: number;
  pageSize?: number;
  order?: "asc" | "desc";
}

/** AD-03. Search by name, email, phone or booking reference. Callers restrict `doctorId` for doctor logins. */
export async function listAppointments(db: Database, f: AppointmentFilter = {}) {
  const pageSize = Math.min(f.pageSize ?? 25, 100);
  const page = Math.max(f.page ?? 1, 1);
  const q = f.q?.trim();
  const where: (SQL | undefined)[] = [
    f.fromUtc ? gte(schema.appointments.startAt, f.fromUtc) : undefined,
    f.toUtc ? lt(schema.appointments.startAt, f.toUtc) : undefined,
    f.doctorId ? eq(schema.appointments.doctorId, f.doctorId) : undefined,
    f.serviceId ? eq(schema.appointments.serviceId, f.serviceId) : undefined,
    f.status ? eq(schema.appointments.status, f.status) : undefined,
    f.paymentStatus ? eq(schema.appointments.paymentStatus, f.paymentStatus) : undefined,
    q
      ? or(
          ilike(schema.appointments.bookingRef, `%${q}%`),
          ilike(schema.patients.firstName, `%${q}%`),
          ilike(schema.patients.lastName, `%${q}%`),
          ilike(sql`${schema.patients.firstName} || ' ' || ${schema.patients.lastName}`, `%${q}%`),
          ilike(schema.patients.email, `%${q}%`),
          ilike(schema.patients.phone, `%${q}%`),
        )
      : undefined,
  ];
  const base = db.select({
    id: schema.appointments.id, bookingRef: schema.appointments.bookingRef, startAt: schema.appointments.startAt,
    endAt: schema.appointments.endAt, status: schema.appointments.status, paymentStatus: schema.appointments.paymentStatus,
    paymentChoice: schema.appointments.paymentChoice, totalCents: schema.appointments.totalCents, source: schema.appointments.source,
    doctorId: schema.appointments.doctorId, patientId: schema.patients.id,
    patientName: sql<string>`${schema.patients.firstName} || ' ' || ${schema.patients.lastName}`,
    patientPhone: schema.patients.phone, serviceName: schema.services.name, doctorName: schema.doctors.displayName,
  })
    .from(schema.appointments)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.appointments.patientId))
    .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
    .innerJoin(schema.doctors, eq(schema.doctors.id, schema.appointments.doctorId))
    .where(and(...where));

  const [rows, [count]] = await Promise.all([
    base.orderBy(f.order === "desc" ? desc(schema.appointments.startAt) : asc(schema.appointments.startAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` })
      .from(schema.appointments)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.appointments.patientId))
      .where(and(...where)),
  ]);
  return { rows, total: count?.n ?? 0, page, pageSize };
}

/** AD-04. The questionnaire is only included on request, and that request is audited (SEC-07, SEC-09). */
export async function getAppointmentDetail(db: Database, id: string, opts: { includeQuestionnaire: boolean; actor: Actor }) {
  const [appt] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, id));
  if (!appt) return null;
  const [[patient], [service], [doctor], payments, consents, events] = await Promise.all([
    db.select().from(schema.patients).where(eq(schema.patients.id, appt.patientId)),
    db.select().from(schema.services).where(eq(schema.services.id, appt.serviceId)),
    db.select().from(schema.doctors).where(eq(schema.doctors.id, appt.doctorId)),
    db.select().from(schema.payments).where(eq(schema.payments.appointmentId, id)),
    db.select().from(schema.consents).where(eq(schema.consents.appointmentId, id)),
    db.select().from(schema.domainEvents).where(eq(schema.domainEvents.aggregateId, id)).orderBy(asc(schema.domainEvents.occurredAt)),
  ]);
  const refunds = payments.length
    ? await db.select().from(schema.refunds).where(inArray(schema.refunds.paymentId, payments.map((p) => p.id)))
    : [];

  if (opts.includeQuestionnaire) {
    await audit(db, { actorUserId: opts.actor.id, actorRole: opts.actor.role, action: "appointment.view_questionnaire", entityType: "appointment", entityId: id, ip: opts.actor.ip });
  }
  const { questionnaire, manageTokenHash: _hash, ...safe } = appt;
  return {
    appointment: safe,
    questionnaire: opts.includeQuestionnaire ? questionnaire : undefined,
    patient: patient!, service: service!, doctor: doctor!, payments, refunds, consents, events,
  };
}

const TRANSITIONS: Record<string, Status[]> = {
  CHECKED_IN: ["CONFIRMED"],
  COMPLETED: ["CONFIRMED", "CHECKED_IN"],
  NO_SHOW: ["CONFIRMED"],
};

export async function setAppointmentStatus(db: Database, input: { id: string; to: "CHECKED_IN" | "COMPLETED" | "NO_SHOW"; actor: Actor; now?: Date }) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [appt] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, input.id)).for("update");
    if (!appt) throw new BookingError("NOT_FOUND", "Appointment not found");
    if (!TRANSITIONS[input.to]!.includes(appt.status)) throw new BookingError("INVALID_STATE", `Cannot change from ${appt.status} to ${input.to}`);
    await tx.update(schema.appointments).set({
      status: input.to, updatedAt: now,
      ...(input.to === "CHECKED_IN" ? { checkedInAt: now } : {}),
      ...(input.to === "COMPLETED" ? { completedAt: now } : {}),
    }).where(eq(schema.appointments.id, input.id));
    // No-show and completed free the lock only if the time is still in the future; past slots are history.
    if (input.to === "NO_SHOW" && appt.startAt > now) await tx.delete(schema.slotLocks).where(eq(schema.slotLocks.appointmentId, appt.id));
    if (input.to === "CHECKED_IN") {
      await emitEvent(tx, { type: "appointment.checked_in", aggregateType: "appointment", aggregateId: appt.id, payload: { by: input.actor.role } });
    }
    await audit(tx, { actorUserId: input.actor.id, actorRole: input.actor.role, action: `appointment.${input.to.toLowerCase()}`, entityType: "appointment", entityId: appt.id, ip: input.actor.ip, changes: { from: appt.status, to: input.to } });
  });
}

export async function setStaffNote(db: Database, input: { id: string; note: string; actor: Actor }) {
  await db.update(schema.appointments).set({ staffNote: input.note.slice(0, 1000), updatedAt: new Date() }).where(eq(schema.appointments.id, input.id));
  await audit(db, { actorUserId: input.actor.id, actorRole: input.actor.role, action: "appointment.note", entityType: "appointment", entityId: input.id, ip: input.actor.ip });
}

// ------------------------------------------------------------ walk-ins

const staffBooking = z.object({
  serviceId: z.string().uuid(),
  doctorId: z.string().uuid(),
  startAt: z.date(),
  patient: staffPatientInput,
  source: z.enum(["WALK_IN", "PHONE", "STAFF"]).default("WALK_IN"),
  paymentChoice: z.enum(["AT_CLINIC", "FREE"]),
  checkIn: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});
export type StaffBookingInput = z.input<typeof staffBooking> & { actor: Actor; now?: Date };

/**
 * AD-05. Books any slot through the SAME double-booking guard as online bookings.
 * It may fall outside normal hours (returned as `outsideNormalHours` so the screen can warn),
 * but it can never overlap another booking, hold or blocked time.
 */
export async function createStaffBooking(db: Database, raw: StaffBookingInput) {
  const { actor, now: nowIn, ...rest } = raw;
  const input = staffBooking.parse(rest);
  const now = nowIn ?? new Date();

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await releaseExpiredHolds(tx, now);
        const [service] = await tx.select().from(schema.services).where(eq(schema.services.id, input.serviceId));
        const [doctor] = await tx.select().from(schema.doctors).where(eq(schema.doctors.id, input.doctorId));
        if (!service || !doctor) throw new BookingError("NOT_FOUND", "Service or doctor not found");

        // Is this inside the doctor's normal hours? Ignore notice, window and existing bookings for this check.
        const day = dublinDate(input.startAt);
        const { input: avail } = await loadAvailability(tx, { serviceId: service.id, doctorId: doctor.id, fromDate: day, toDate: day, now });
        const inHours = computeSlots({
          ...avail, busy: [], blocks: [],
          settings: { ...avail.settings, minNoticeMinutes: 0, bookingWindowDays: 3650 },
          service: { ...avail.service, minNoticeOverrideMin: 0 },
          now: new Date(input.startAt.getTime() - 86_400_000), // a day earlier, so the booking window and notice never apply
        }).some((s) => s.startAt.getTime() === input.startAt.getTime());

        const endAt = new Date(input.startAt.getTime() + service.durationMin * 60_000);
        const lockEnd = new Date(endAt.getTime() + service.bufferMin * 60_000);
        const patient = await findOrCreatePatient(tx, input.patient);
        const { token, hash } = generateManageToken();
        const id = randomUUID();

        await tx.insert(schema.appointments).values({
          id, bookingRef: generateBookingRef(), patientId: patient.id, doctorId: doctor.id, serviceId: service.id,
          mode: "IN_CLINIC", startAt: input.startAt, endAt,
          status: input.checkIn ? "CHECKED_IN" : "CONFIRMED", checkedInAt: input.checkIn ? now : null,
          paymentStatus: input.paymentChoice === "FREE" ? "PAID" : "UNPAID", paymentChoice: input.paymentChoice,
          priceCents: service.priceCents, discountCents: 0, totalCents: input.paymentChoice === "FREE" ? 0 : service.priceCents,
          reason: input.reason ?? null, source: input.source, manageTokenHash: hash,
        });
        try {
          await tx.insert(schema.slotLocks).values({ doctorId: doctor.id, startAt: input.startAt, endAt: lockEnd, kind: "APPOINTMENT", appointmentId: id });
        } catch (err) {
          if (isExclusionViolation(err)) throw new SlotTakenError();
          throw err;
        }
        await emitEvent(tx, { type: "appointment.confirmed", aggregateType: "appointment", aggregateId: id, payload: { patientId: patient.id, doctorId: doctor.id, serviceId: service.id, source: input.source } });
        await audit(tx, { actorUserId: actor.id, actorRole: actor.role, action: "appointment.staff_create", entityType: "appointment", entityId: id, ip: actor.ip, changes: { source: input.source, outsideNormalHours: !inHours } });

        const [appointment] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, id));
        return { appointment: appointment!, manageToken: token, outsideNormalHours: !inHours };
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue;
      throw err;
    }
  }
  throw new BookingError("INVALID_STATE", "Could not allocate a booking reference");
}
