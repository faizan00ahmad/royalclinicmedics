import { randomInt, randomUUID } from "node:crypto";
import { schema } from "@rmc/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { BookingError, SlotTakenError } from "../booking/errors";
import { emitEvent } from "../booking/events";
import { releaseHold } from "../booking/hold";
import { lockSlotForAppointment } from "../booking/locks";
import { cancelAppointment, type CancelInput } from "../booking/appointment";
import { findOrCreatePatient, patientInput } from "../booking/patients";
import { generateBookingRef, generateManageToken } from "../booking/tokens";
import type { Database } from "../db-types";
import type { GatewayEvent, PaymentGateway } from "./gateway";

const RECEIPT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateReceiptNumber(now: Date = new Date()): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += RECEIPT_ALPHABET[randomInt(RECEIPT_ALPHABET.length)];
  return `RC-${now.getUTCFullYear()}-${out}`;
}

// ------------------------------------------------------------- checkout

const checkoutInput = z.object({
  holdId: z.string().uuid(),
  patient: patientInput,
  reason: z.string().trim().max(500).optional(),
  /** Stored with the appointment only. Never sent to Stripe, email, logs or events (SEC-07). */
  questionnaire: z.record(z.unknown()).optional(),
});
export type CheckoutInput = z.input<typeof checkoutInput> & { now?: Date };

/**
 * BK-08, PAY-01, PAY-02. Creates the appointment as PENDING_PAYMENT (the hold keeps the slot locked),
 * then asks Stripe for a PaymentIntent for the amount taken from the database, never from the browser.
 * The appointment is confirmed later by the webhook.
 */
export async function startOnlineCheckout(db: Database, gateway: PaymentGateway, raw: CheckoutInput) {
  const { now: nowIn, ...rest } = raw;
  const input = checkoutInput.parse(rest);
  const now = nowIn ?? new Date();

  const created = await db.transaction(async (tx) => {
    const [hold] = await tx.select().from(schema.slotHolds).where(eq(schema.slotHolds.id, input.holdId));
    if (!hold) throw new BookingError("NOT_FOUND", "Booking hold not found");
    if (hold.status !== "ACTIVE") throw new BookingError("HOLD_USED", "This hold is no longer active");
    if (hold.expiresAt <= now) throw new SlotTakenError(); // expired: pick a time again

    const [taken] = await tx.select({ id: schema.appointments.id }).from(schema.appointments)
      .where(eq(schema.appointments.holdId, hold.id));
    if (taken) throw new BookingError("HOLD_USED", "Checkout already started for this hold");

    const [service] = await tx.select().from(schema.services).where(eq(schema.services.id, hold.serviceId));
    if (!service) throw new BookingError("NOT_FOUND", "Service not found");
    if (service.priceCents <= 0) throw new BookingError("POLICY", "This service has no online payment");

    const patient = await findOrCreatePatient(tx, input.patient);
    const { token, hash } = generateManageToken();
    const appointmentId = randomUUID();
    const bookingRef = generateBookingRef();

    await tx.insert(schema.appointments).values({
      id: appointmentId, bookingRef, patientId: patient.id, doctorId: hold.doctorId, serviceId: hold.serviceId,
      mode: hold.mode, startAt: hold.startAt, endAt: hold.endAt,
      status: "PENDING_PAYMENT", paymentStatus: "UNPAID", paymentChoice: "ONLINE",
      priceCents: service.priceCents, discountCents: 0, totalCents: service.priceCents,
      reason: input.reason ?? null, questionnaire: input.questionnaire ?? null, source: "ONLINE",
      manageTokenHash: hash, holdId: hold.id,
    });
    const [payment] = await tx.insert(schema.payments).values({
      appointmentId, provider: "STRIPE", amountCents: service.priceCents, status: "UNPAID",
    }).returning({ id: schema.payments.id });

    return { appointmentId, bookingRef, paymentId: payment!.id, amountCents: service.priceCents, email: input.patient.email, token, holdId: hold.id };
  });

  try {
    const pi = await gateway.createPaymentIntent({
      amountCents: created.amountCents, appointmentId: created.appointmentId, bookingRef: created.bookingRef,
      receiptEmail: created.email,
    });
    await db.update(schema.payments).set({ stripePaymentIntentId: pi.id, updatedAt: now })
      .where(eq(schema.payments.id, created.paymentId));
    return {
      appointmentId: created.appointmentId, bookingRef: created.bookingRef, manageToken: created.token,
      clientSecret: pi.clientSecret, paymentIntentId: pi.id, amountCents: created.amountCents,
    };
  } catch (err) {
    // Stripe unavailable: give the slot back so the patient can try again.
    await db.update(schema.appointments).set({
      status: "CANCELLED_BY_CLINIC", cancelledAt: now, cancelReason: "Payment could not be started", cancelledBy: "SYSTEM",
    }).where(eq(schema.appointments.id, created.appointmentId));
    await db.update(schema.payments).set({ status: "FAILED" }).where(eq(schema.payments.id, created.paymentId));
    await releaseHold(db, created.holdId);
    throw err;
  }
}

// -------------------------------------------------------------- refunds

async function refundedTotal(tx: Database, paymentId: string): Promise<number> {
  const [r] = await tx.select({ total: sql<number>`coalesce(sum(${schema.refunds.amountCents}), 0)::int` })
    .from(schema.refunds).where(eq(schema.refunds.paymentId, paymentId));
  return r?.total ?? 0;
}

export interface RefundInput {
  appointmentId: string;
  /** Omit for the full remaining amount. */
  amountCents?: number;
  reason: string;
  createdBy?: string;
}

/**
 * PAY-05, BK-31, BK-33. Safe to call twice: the idempotency key depends on what was already refunded,
 * and a fully refunded payment is a no-op.
 */
export async function refundAppointment(db: Database, gateway: PaymentGateway, input: RefundInput) {
  const [payment] = await db.select().from(schema.payments)
    .where(and(eq(schema.payments.appointmentId, input.appointmentId), inArray(schema.payments.status, ["PAID", "PARTIALLY_REFUNDED"])));
  if (!payment) return { refundedCents: 0 };

  const already = await refundedTotal(db, payment.id);
  const remaining = payment.amountCents - already;
  if (remaining <= 0) return { refundedCents: 0 };
  const amount = Math.min(input.amountCents ?? remaining, remaining);
  if (amount <= 0) throw new RangeError("Refund amount must be positive");

  let stripeRefundId: string | null = null;
  if (payment.provider === "STRIPE") {
    if (!payment.stripePaymentIntentId) throw new BookingError("INVALID_STATE", "Payment has no Stripe reference");
    const r = await gateway.refund({
      paymentIntentId: payment.stripePaymentIntentId, amountCents: amount,
      idempotencyKey: `refund_${payment.id}_${already}`,
    });
    stripeRefundId = r.id;
  }

  return db.transaction(async (tx) => {
    await tx.insert(schema.refunds).values({
      paymentId: payment.id, stripeRefundId, amountCents: amount, reason: input.reason, createdBy: input.createdBy ?? null,
    });
    const full = already + amount >= payment.amountCents;
    const status = full ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await tx.update(schema.payments).set({ status, updatedAt: new Date() }).where(eq(schema.payments.id, payment.id));
    await tx.update(schema.appointments).set({ paymentStatus: status, updatedAt: new Date() })
      .where(eq(schema.appointments.id, input.appointmentId));
    await emitEvent(tx, {
      type: "payment.refunded", aggregateType: "payment", aggregateId: payment.id,
      payload: { appointmentId: input.appointmentId, amountCents: amount },
    });
    return { refundedCents: amount };
  });
}

/** Cancel, then refund automatically when the policy says so (BK-31, BK-33). */
export async function cancelWithRefund(db: Database, gateway: PaymentGateway, input: CancelInput) {
  const result = await cancelAppointment(db, input);
  let refundedCents = 0;
  if (result.refundDue) {
    ({ refundedCents } = await refundAppointment(db, gateway, {
      appointmentId: input.appointmentId,
      reason: input.by === "CLINIC" ? "Cancelled by clinic" : "Cancelled by patient",
    }));
  }
  return { ...result, refundedCents };
}

// ------------------------------------------------------ pay at clinic

export async function markPaidAtClinic(
  db: Database,
  input: { appointmentId: string; method: "CASH" | "TERMINAL" | "OTHER"; userId?: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [appt] = await tx.select().from(schema.appointments)
      .where(eq(schema.appointments.id, input.appointmentId)).for("update");
    if (!appt) throw new BookingError("NOT_FOUND", "Appointment not found");
    if (appt.paymentChoice !== "AT_CLINIC") throw new BookingError("INVALID_STATE", "Not a pay-at-clinic booking");
    if (appt.paymentStatus !== "UNPAID") throw new BookingError("INVALID_STATE", "Already marked as paid");
    if (!["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(appt.status)) {
      throw new BookingError("INVALID_STATE", "Appointment is not active");
    }
    const [pay] = await tx.insert(schema.payments).values({
      appointmentId: appt.id, provider: "CLINIC", amountCents: appt.totalCents, status: "PAID",
      method: input.method, receiptNumber: generateReceiptNumber(now), paidAt: now,
    }).returning();
    await tx.update(schema.appointments).set({ paymentStatus: "PAID", updatedAt: now }).where(eq(schema.appointments.id, appt.id));
    await emitEvent(tx, { type: "payment.succeeded", aggregateType: "payment", aggregateId: pay!.id, payload: { appointmentId: appt.id } });
    return pay!;
  });
}

// ---------------------------------------------------------- webhook

export type WebhookOutcome =
  | "CONFIRMED" | "ALREADY_PROCESSED" | "REFUNDED_SLOT_LOST" | "PAYMENT_FAILED"
  | "AMOUNT_MISMATCH" | "REFUND_SYNCED" | "IGNORED" | "DUPLICATE_EVENT";

/**
 * PAY-03. Idempotent three ways: processed event ids, row locks, and state checks.
 * The event id is stored only after handling succeeds, so a failed attempt is retried by Stripe.
 */
export async function processStripeEvent(
  db: Database, gateway: PaymentGateway, event: GatewayEvent, now: Date = new Date(),
): Promise<{ outcome: WebhookOutcome }> {
  const [seen] = await db.select().from(schema.stripeEvents).where(eq(schema.stripeEvents.id, event.id));
  if (seen) return { outcome: "DUPLICATE_EVENT" };

  const obj = event.data.object;
  const piId = typeof obj.id === "string" && event.type.startsWith("payment_intent.")
    ? obj.id
    : typeof obj.payment_intent === "string" ? obj.payment_intent : undefined;

  let outcome: WebhookOutcome = "IGNORED";
  let refundAppointmentId: string | null = null;

  if (piId) {
    const result = await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.stripePaymentIntentId, piId));
      if (!payment) return { outcome: "IGNORED" as WebhookOutcome, refund: null as string | null };
      const [appt] = await tx.select().from(schema.appointments)
        .where(eq(schema.appointments.id, payment.appointmentId)).for("update");
      if (!appt) return { outcome: "IGNORED" as WebhookOutcome, refund: null };

      if (event.type === "payment_intent.succeeded") {
        return handleSucceeded(tx, event, payment, appt, now);
      }
      if (event.type === "payment_intent.payment_failed") {
        if (payment.status === "UNPAID") {
          await tx.update(schema.payments).set({ status: "FAILED", updatedAt: now }).where(eq(schema.payments.id, payment.id));
        }
        return { outcome: "PAYMENT_FAILED" as WebhookOutcome, refund: null };
      }
      if (event.type === "charge.refunded") {
        await syncStripeRefund(tx, payment, Number(obj.amount_refunded ?? 0), appt.id, now);
        return { outcome: "REFUND_SYNCED" as WebhookOutcome, refund: null };
      }
      return { outcome: "IGNORED" as WebhookOutcome, refund: null };
    });
    outcome = result.outcome;
    refundAppointmentId = result.refund;
  }

  // Money goes back outside the database transaction. If this throws, the event id is NOT stored, so Stripe retries.
  if (refundAppointmentId) {
    await refundAppointment(db, gateway, { appointmentId: refundAppointmentId, reason: "Time no longer available after payment" });
  }

  await db.insert(schema.stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing();
  return { outcome };
}

type Tx = Database;
type PaymentRow = typeof schema.payments.$inferSelect;
type AppointmentRow = typeof schema.appointments.$inferSelect;

async function handleSucceeded(tx: Tx, event: GatewayEvent, payment: PaymentRow, appt: AppointmentRow, now: Date) {
  const received = Number(event.data.object.amount_received ?? event.data.object.amount ?? NaN);
  if (received !== payment.amountCents) {
    await tx.insert(schema.auditLogs).values({
      actorRole: "SYSTEM", action: "payment.amount_mismatch", entityType: "payment", entityId: payment.id,
      changes: { expected: payment.amountCents, received },
    });
    return { outcome: "AMOUNT_MISMATCH" as WebhookOutcome, refund: null as string | null };
  }
  if (payment.status === "PAID" || payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED") {
    return { outcome: "ALREADY_PROCESSED" as WebhookOutcome, refund: null };
  }

  const markPaid = async () => {
    await tx.update(schema.payments).set({
      status: "PAID", method: "CARD", paidAt: now, receiptNumber: generateReceiptNumber(now), updatedAt: now,
    }).where(eq(schema.payments.id, payment.id));
    await emitEvent(tx, { type: "payment.succeeded", aggregateType: "payment", aggregateId: payment.id, payload: { appointmentId: appt.id } });
  };

  if (appt.status === "PENDING_PAYMENT") {
    const [service] = await tx.select().from(schema.services).where(eq(schema.services.id, appt.serviceId));
    try {
      // Savepoint: a lost race must not poison the surrounding transaction.
      await tx.transaction(async (sp) => {
        await lockSlotForAppointment(sp, appt, appt.holdId, service?.bufferMin ?? 0, now);
      });
    } catch (err) {
      if (!(err instanceof SlotTakenError)) throw err;
      await markPaid();
      await tx.update(schema.appointments).set({
        status: "CANCELLED_BY_CLINIC", cancelledAt: now, cancelledBy: "SYSTEM",
        cancelReason: "Time no longer available after payment", updatedAt: now,
      }).where(eq(schema.appointments.id, appt.id));
      await emitEvent(tx, { type: "appointment.cancelled", aggregateType: "appointment", aggregateId: appt.id, payload: { by: "SYSTEM", refundDue: true } });
      return { outcome: "REFUNDED_SLOT_LOST" as WebhookOutcome, refund: appt.id };
    }
    await markPaid();
    await tx.update(schema.appointments).set({ status: "CONFIRMED", paymentStatus: "PAID", updatedAt: now })
      .where(eq(schema.appointments.id, appt.id));
    await emitEvent(tx, {
      type: "appointment.confirmed", aggregateType: "appointment", aggregateId: appt.id,
      payload: { patientId: appt.patientId, doctorId: appt.doctorId, serviceId: appt.serviceId },
    });
    return { outcome: "CONFIRMED" as WebhookOutcome, refund: null };
  }

  // Already cancelled (for example a late payment after the unpaid-booking cleanup): take the money, give it back.
  await markPaid();
  return { outcome: "REFUNDED_SLOT_LOST" as WebhookOutcome, refund: appt.id };
}

/** Records a refund made directly in the Stripe dashboard so our records match. */
async function syncStripeRefund(tx: Tx, payment: PaymentRow, amountRefunded: number, appointmentId: string, now: Date) {
  const already = await refundedTotal(tx, payment.id);
  if (amountRefunded <= already) return;
  await tx.insert(schema.refunds).values({
    paymentId: payment.id, amountCents: amountRefunded - already, reason: "Refunded in Stripe dashboard",
  });
  const status = amountRefunded >= payment.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
  await tx.update(schema.payments).set({ status, updatedAt: now }).where(eq(schema.payments.id, payment.id));
  await tx.update(schema.appointments).set({ paymentStatus: status, updatedAt: now }).where(eq(schema.appointments.id, appointmentId));
  await emitEvent(tx, {
    type: "payment.refunded", aggregateType: "payment", aggregateId: payment.id,
    payload: { appointmentId, amountCents: amountRefunded - already },
  });
}

// ----------------------------------------------------------- cleanup

/**
 * Cron job. Cancels online bookings still unpaid well after their hold expired,
 * and cancels the Stripe PaymentIntent. `graceMinutes` leaves time for a slow payment webhook.
 */
export async function expireUnpaidAppointments(
  db: Database, gateway: PaymentGateway, now: Date = new Date(), graceMinutes = 30,
): Promise<number> {
  const cutoff = new Date(now.getTime() - graceMinutes * 60_000);
  const stale = await db
    .select({ id: schema.appointments.id, holdId: schema.appointments.holdId })
    .from(schema.appointments)
    .innerJoin(schema.slotHolds, eq(schema.slotHolds.id, schema.appointments.holdId))
    .where(and(eq(schema.appointments.status, "PENDING_PAYMENT"), lt(schema.slotHolds.expiresAt, cutoff)));

  for (const a of stale) {
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.appointmentId, a.id));
    await db.update(schema.appointments).set({
      status: "CANCELLED_BY_CLINIC", cancelledAt: now, cancelledBy: "SYSTEM", cancelReason: "Payment not completed", updatedAt: now,
    }).where(and(eq(schema.appointments.id, a.id), eq(schema.appointments.status, "PENDING_PAYMENT")));
    if (payment?.status === "UNPAID") {
      await db.update(schema.payments).set({ status: "FAILED", updatedAt: now }).where(eq(schema.payments.id, payment.id));
      if (payment.stripePaymentIntentId) {
        try { await gateway.cancelPaymentIntent(payment.stripePaymentIntentId); } catch { /* already finished at Stripe */ }
      }
    }
  }
  return stale.length;
}
