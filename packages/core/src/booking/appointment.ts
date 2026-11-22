import { randomUUID } from "node:crypto";
import { schema } from "@rmc/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db-types";
import { computeSlots, dublinDate } from "../slots";
import { loadBookingSettings } from "../settings";
import { loadAvailability } from "./availability";
import { BookingError, SlotTakenError, isExclusionViolation, isUniqueViolation } from "./errors";
import { emitEvent } from "./events";
import { findOrCreatePatient, patientInput } from "./patients";
import { generateBookingRef, generateManageToken } from "./tokens";
import { lockSlotForAppointment } from "./locks";
import { releaseExpiredHolds } from "./hold";

const confirmInput = z.object({
  holdId: z.string().uuid(),
  patient: patientInput,
  paymentChoice: z.enum(["ONLINE", "AT_CLINIC", "FREE"]),
  reason: z.string().trim().max(500).optional(),
  /** Stored with the appointment only. Never logged, emailed or put in events (SEC-07). */
  questionnaire: z.record(z.unknown()).optional(),
  source: z.enum(["ONLINE", "WALK_IN", "PHONE", "STAFF"]).default("ONLINE"),
});
export type ConfirmInput = z.input<typeof confirmInput> & { now?: Date };

/**
 * EXT-04, BK-23. Turns a hold into a CONFIRMED appointment in one transaction.
 * - The hold's lock row is converted in place, so the slot is never unprotected.
 * - If the hold expired while the patient paid, the slot is re-locked if still free,
 *   otherwise SlotTakenError is thrown and the caller refunds (BK-23).
 */
export async function confirmAppointment(db: Database, raw: ConfirmInput) {
  const { now: nowIn, ...rest } = raw;
  const input = confirmInput.parse(rest);
  const now = nowIn ?? new Date();

  // Retry only if the random booking ref collides (practically never).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [hold] = await tx.select().from(schema.slotHolds).where(eq(schema.slotHolds.id, input.holdId));
        if (!hold) throw new BookingError("NOT_FOUND", "Booking hold not found");
        if (hold.status === "CONSUMED") throw new BookingError("HOLD_USED", "This hold was already used");

        const [service] = await tx.select().from(schema.services).where(eq(schema.services.id, hold.serviceId));
        if (!service) throw new BookingError("NOT_FOUND", "Service not found");

        // Server-side rules for the payment choice (PAY-02, PAY-04)
        if (input.paymentChoice === "AT_CLINIC" && !service.payAtClinicAllowed) {
          throw new BookingError("POLICY", "This service cannot be paid for at the clinic");
        }
        if (input.paymentChoice === "ONLINE") {
          throw new BookingError("POLICY", "Online payments use startOnlineCheckout, which confirms after payment");
        }
        if (input.paymentChoice === "FREE" && input.source === "ONLINE" && service.priceCents > 0) {
          throw new BookingError("POLICY", "Free bookings are staff-only");
        }

        const patient = await findOrCreatePatient(tx, input.patient);
        const { token, hash } = generateManageToken();
        const appointmentId = randomUUID();
        const paid = input.paymentChoice === "FREE";

        await tx.insert(schema.appointments).values({
          id: appointmentId,
          bookingRef: generateBookingRef(),
          patientId: patient.id,
          doctorId: hold.doctorId,
          serviceId: hold.serviceId,
          mode: hold.mode,
          startAt: hold.startAt,
          endAt: hold.endAt,
          status: "CONFIRMED",
          paymentStatus: paid ? "PAID" : "UNPAID",
          paymentChoice: input.paymentChoice,
          priceCents: service.priceCents,
          discountCents: 0,
          totalCents: service.priceCents,
          reason: input.reason ?? null,
          questionnaire: input.questionnaire ?? null,
          source: input.source,
          manageTokenHash: hash,
        });

        await lockSlotForAppointment(
          tx, { id: appointmentId, doctorId: hold.doctorId, startAt: hold.startAt, endAt: hold.endAt },
          hold.id, service.bufferMin, now,
        );

        await emitEvent(tx, {
          type: "appointment.confirmed", aggregateType: "appointment", aggregateId: appointmentId,
          payload: { patientId: patient.id, doctorId: hold.doctorId, serviceId: hold.serviceId },
        });

        const [appointment] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId));
        return { appointment: appointment!, manageToken: token };
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue;
      throw err;
    }
  }
  throw new BookingError("INVALID_STATE", "Could not allocate a booking reference");
}

// ---------------------------------------------------------------- cancel

export interface CancelInput {
  appointmentId: string;
  by: "PATIENT" | "CLINIC";
  reason?: string;
  now?: Date;
}

const ACTIVE = ["PENDING_PAYMENT", "CONFIRMED"] as const;

/**
 * BK-31, BK-33. Patients are blocked inside the cancellation window (they must call the clinic).
 * The clinic can always cancel. `refundDue` tells the payment layer what to do.
 */
export async function cancelAppointment(db: Database, input: CancelInput) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [appt] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, input.appointmentId));
    if (!appt) throw new BookingError("NOT_FOUND", "Appointment not found");
    if (!ACTIVE.includes(appt.status as (typeof ACTIVE)[number])) {
      throw new BookingError("INVALID_STATE", "This appointment can no longer be cancelled");
    }

    const settings = await loadBookingSettings(tx);
    const hoursBefore = (appt.startAt.getTime() - now.getTime()) / 3_600_000;
    const insideWindow = hoursBefore < settings.cancellationWindowHours;
    if (input.by === "PATIENT" && insideWindow) {
      throw new BookingError("POLICY", "Inside the cancellation window. Please call the clinic.");
    }

    await tx.delete(schema.slotLocks).where(eq(schema.slotLocks.appointmentId, appt.id));
    if (appt.holdId) {
      // Still awaiting payment: its hold lock must go too, or the slot stays blocked until expiry.
      await tx.delete(schema.slotLocks).where(eq(schema.slotLocks.holdId, appt.holdId));
      await tx.update(schema.slotHolds).set({ status: "EXPIRED" })
        .where(and(eq(schema.slotHolds.id, appt.holdId), eq(schema.slotHolds.status, "ACTIVE")));
    }
    const [updated] = await tx.update(schema.appointments).set({
      status: input.by === "PATIENT" ? "CANCELLED_BY_PATIENT" : "CANCELLED_BY_CLINIC",
      cancelledAt: now, cancelReason: input.reason ?? null, cancelledBy: input.by, updatedAt: now,
    }).where(eq(schema.appointments.id, appt.id)).returning();

    // Clinic cancellation always refunds in full (BK-33); a patient inside the window never gets here.
    const refundDue = appt.paymentStatus === "PAID" && appt.totalCents > 0;
    await emitEvent(tx, {
      type: "appointment.cancelled", aggregateType: "appointment", aggregateId: appt.id,
      payload: { by: input.by, refundDue },
    });
    return { appointment: updated!, refundDue };
  });
}

// ------------------------------------------------------------ reschedule

export interface RescheduleInput {
  appointmentId: string;
  newStartAt: Date;
  by: "PATIENT" | "CLINIC";
  now?: Date;
}

/** BK-31, BK-32. Moves the appointment and its lock together; same doctor and service. */
export async function rescheduleAppointment(db: Database, input: RescheduleInput) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [appt] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, input.appointmentId));
    if (!appt) throw new BookingError("NOT_FOUND", "Appointment not found");
    if (appt.status !== "CONFIRMED") throw new BookingError("INVALID_STATE", "Only confirmed appointments can be moved");

    const settings = await loadBookingSettings(tx);
    if (input.by === "PATIENT") {
      const hoursBefore = (appt.startAt.getTime() - now.getTime()) / 3_600_000;
      if (hoursBefore < settings.cancellationWindowHours) {
        throw new BookingError("POLICY", "Inside the cancellation window. Please call the clinic.");
      }
      if (appt.rescheduleCount >= settings.maxReschedules) {
        throw new BookingError("POLICY", "This booking has reached its reschedule limit. Please call the clinic.");
      }
    }

    await releaseExpiredHolds(tx, now);
    const date = dublinDate(input.newStartAt);
    const { input: avail } = await loadAvailability(tx, {
      serviceId: appt.serviceId, doctorId: appt.doctorId, fromDate: date, toDate: date, now,
      excludeAppointmentId: appt.id,
    });
    const slot = computeSlots(avail).find((s) => s.startAt.getTime() === input.newStartAt.getTime());
    if (!slot) throw new SlotTakenError();

    try {
      await tx.update(schema.slotLocks)
        .set({ startAt: slot.startAt, endAt: slot.lockEndAt })
        .where(and(eq(schema.slotLocks.appointmentId, appt.id)));
    } catch (err) {
      if (isExclusionViolation(err)) throw new SlotTakenError();
      throw err;
    }

    const [updated] = await tx.update(schema.appointments).set({
      startAt: slot.startAt, endAt: slot.endAt,
      rescheduleCount: input.by === "PATIENT" ? appt.rescheduleCount + 1 : appt.rescheduleCount,
      updatedAt: now,
    }).where(eq(schema.appointments.id, appt.id)).returning();

    await emitEvent(tx, {
      type: "appointment.rescheduled", aggregateType: "appointment", aggregateId: appt.id,
      payload: { by: input.by, from: appt.startAt.toISOString(), to: slot.startAt.toISOString() },
    });
    return updated!;
  });
}
