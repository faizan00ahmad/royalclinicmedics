import { schema } from "@rmc/db";
import { and, eq, gt, inArray, lt, or } from "drizzle-orm";
import type { Database } from "../db-types";
import { loadBookingSettings, type BookingSettings } from "../settings";
import { computeSlots, addDays, type ComputeSlotsInput, type Slot } from "../slots";
import { dublinToUtc } from "../time";
import { BookingError } from "./errors";

type ServiceRow = typeof schema.services.$inferSelect;

export interface AvailabilityQuery {
  serviceId: string;
  doctorId?: string;
  fromDate: string; // YYYY-MM-DD Dublin
  toDate: string;
  now: Date;
  /** Reschedule: ignore this appointment's own lock so it can move within its old time. */
  excludeAppointmentId?: string;
}

export interface LoadedAvailability {
  service: ServiceRow;
  settings: BookingSettings;
  input: ComputeSlotsInput;
}

/** Loads everything the pure slot engine needs. */
export async function loadAvailability(db: Database, q: AvailabilityQuery): Promise<LoadedAvailability> {
  const [service] = await db.select().from(schema.services)
    .where(and(eq(schema.services.id, q.serviceId), eq(schema.services.active, true)));
  if (!service) throw new BookingError("NOT_FOUND", "Service not found");

  const settings = await loadBookingSettings(db);

  const links = await db
    .select({ doctor: schema.doctors })
    .from(schema.serviceDoctors)
    .innerJoin(schema.doctors, eq(schema.doctors.id, schema.serviceDoctors.doctorId))
    .where(and(
      eq(schema.serviceDoctors.serviceId, service.id),
      eq(schema.doctors.isActive, true),
      q.doctorId ? eq(schema.doctors.id, q.doctorId) : undefined,
    ));
  const doctorIds = links.map((l) => l.doctor.id);

  const rangeStart = dublinToUtc(`${q.fromDate} 00:00`);
  const rangeEnd = new Date(dublinToUtc(`${addDays(q.toDate, 1)} 00:00`).getTime() + 24 * 3_600_000);

  const empty = doctorIds.length === 0;
  const [rules, overrides, holidays, blocks, locks] = empty
    ? [[], [], [], [], []] as const
    : await Promise.all([
        db.select().from(schema.availabilityRules).where(inArray(schema.availabilityRules.doctorId, doctorIds)),
        db.select().from(schema.availabilityOverrides).where(inArray(schema.availabilityOverrides.doctorId, doctorIds)),
        db.select().from(schema.clinicHolidays),
        db.select().from(schema.timeBlocks).where(and(
          inArray(schema.timeBlocks.doctorId, doctorIds),
          gt(schema.timeBlocks.endAt, rangeStart),
          lt(schema.timeBlocks.startAt, rangeEnd),
        )),
        db.select().from(schema.slotLocks).where(and(
          inArray(schema.slotLocks.doctorId, doctorIds),
          gt(schema.slotLocks.endAt, rangeStart),
          lt(schema.slotLocks.startAt, rangeEnd),
          // Active appointments always count. Holds count only until they expire.
          or(eq(schema.slotLocks.kind, "APPOINTMENT"), gt(schema.slotLocks.expiresAt, q.now)),
        )),
      ]);

  const input: ComputeSlotsInput = {
    now: q.now,
    fromDate: q.fromDate,
    toDate: q.toDate,
    service: {
      durationMin: service.durationMin,
      bufferMin: service.bufferMin,
      minNoticeOverrideMin: service.minNoticeOverrideMin,
    },
    settings,
    doctors: links.map((l) => ({
      id: l.doctor.id,
      rules: rules.filter((r) => r.doctorId === l.doctor.id),
      overrides: overrides.filter((o) => o.doctorId === l.doctor.id),
    })),
    holidays: holidays.map((h) => h.date),
    blocks: blocks.map((b) => ({ doctorId: b.doctorId, startAt: b.startAt, endAt: b.endAt })),
    busy: locks
      .filter((l) => !q.excludeAppointmentId || l.appointmentId !== q.excludeAppointmentId)
      .map((l) => ({ doctorId: l.doctorId, startAt: l.startAt, endAt: l.endAt })),
  };
  return { service, settings, input };
}

/** EXT-04: free slots for a service, optionally for one doctor. */
export async function getAvailability(db: Database, q: AvailabilityQuery): Promise<Slot[]> {
  const { input } = await loadAvailability(db, q);
  return computeSlots(input);
}
