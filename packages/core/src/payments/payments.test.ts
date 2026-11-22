import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { cancelAppointment, confirmAppointment, createHold } from "../booking";
import { dublinToUtc } from "../time";
import { seed } from "../seed/seed";
import { FakeGateway, failedEvent, refundedEvent, succeededEvent } from "../test-utils/fake-gateway";
import { createTestDb } from "../test-utils/pglite";
import {
  cancelWithRefund, expireUnpaidAppointments, markPaidAtClinic, processStripeEvent,
  refundAppointment, startOnlineCheckout,
} from "./index";

const NOW = dublinToUtc("2026-11-20 08:00");
const at = (hhmm: string) => dublinToUtc(`2026-11-24 ${hhmm}`);
const PATIENT = { firstName: "Aoife", lastName: "Murphy", dob: "1990-04-12", email: "aoife@example.com", phone: "+353871234567" };

let ctx: { client: Awaited<ReturnType<typeof createTestDb>>["client"]; db: Awaited<ReturnType<typeof createTestDb>>["db"]; doctorId: string; serviceId: string; priceCents: number };
let gw: FakeGateway;

beforeEach(async () => {
  const { client, db } = await createTestDb();
  await seed(db);
  const [doctor] = await db.select().from(schema.doctors);
  const [svc] = await db.select().from(schema.services).where(eq(schema.services.slug, "gp-consultation"));
  ctx = { client, db, doctorId: doctor!.id, serviceId: svc!.id, priceCents: svc!.priceCents };
  gw = new FakeGateway();
});

const hold = (hhmm = "09:00", now = NOW) =>
  createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at(hhmm), now });
const checkout = async (hhmm = "09:00", now = NOW) => {
  const h = await hold(hhmm, now);
  return startOnlineCheckout(ctx.db, gw, { holdId: h.id, patient: PATIENT, questionnaire: { symptoms: "cough" }, now });
};
const appt = async (id: string) => (await ctx.db.select().from(schema.appointments).where(eq(schema.appointments.id, id)))[0]!;
const pay = async (appointmentId: string) => (await ctx.db.select().from(schema.payments).where(eq(schema.payments.appointmentId, appointmentId)))[0]!;

describe("startOnlineCheckout", () => {
  it("creates a PENDING_PAYMENT booking and a PaymentIntent for the database price", async () => {
    const co = await checkout();
    expect(co.amountCents).toBe(ctx.priceCents);
    expect(co.clientSecret).toMatch(/_secret$/);
    expect((await appt(co.appointmentId)).status).toBe("PENDING_PAYMENT");
    expect(gw.intents).toHaveLength(1);
    expect(gw.intents[0]!.amountCents).toBe(ctx.priceCents);
  });

  it("sends no health data to Stripe (PAY-02, SEC-07)", async () => {
    await checkout();
    const sent = JSON.stringify(gw.intents[0]);
    expect(sent).not.toContain("cough");
    expect(Object.keys(gw.intents[0]!).sort()).toEqual(["amountCents", "appointmentId", "bookingRef", "id", "receiptEmail"]);
  });

  it("keeps the slot locked while the patient pays", async () => {
    await checkout();
    await expect(hold("09:00")).rejects.toMatchObject({ code: "SLOT_TAKEN" });
  });

  it("refuses an expired hold and a second checkout on the same hold", async () => {
    const h = await hold();
    await startOnlineCheckout(ctx.db, gw, { holdId: h.id, patient: PATIENT, now: NOW });
    await expect(startOnlineCheckout(ctx.db, gw, { holdId: h.id, patient: PATIENT, now: NOW })).rejects.toMatchObject({ code: "HOLD_USED" });
    const h2 = await hold("10:00");
    const late = new Date(NOW.getTime() + 11 * 60_000);
    await expect(startOnlineCheckout(ctx.db, gw, { holdId: h2.id, patient: PATIENT, now: late })).rejects.toMatchObject({ code: "SLOT_TAKEN" });
  });

  it("if Stripe is down the slot is given back", async () => {
    gw.failCreate = true;
    const h = await hold();
    await expect(startOnlineCheckout(ctx.db, gw, { holdId: h.id, patient: PATIENT, now: NOW })).rejects.toThrow("stripe down");
    const [a] = await ctx.db.select().from(schema.appointments);
    expect(a!.status).toBe("CANCELLED_BY_CLINIC");
    await expect(hold("09:00")).resolves.toBeDefined();
  });
});

describe("webhook payment_intent.succeeded", () => {
  it("confirms the booking, marks paid, converts the lock, writes events", async () => {
    const co = await checkout();
    const r = await processStripeEvent(ctx.db, gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), NOW);
    expect(r.outcome).toBe("CONFIRMED");
    const a = await appt(co.appointmentId);
    expect(a.status).toBe("CONFIRMED");
    expect(a.paymentStatus).toBe("PAID");
    const p = await pay(co.appointmentId);
    expect(p.status).toBe("PAID");
    expect(p.receiptNumber).toMatch(/^RC-2026-[A-Z2-9]{6}$/);
    const [lock] = await ctx.db.select().from(schema.slotLocks);
    expect(lock!.kind).toBe("APPOINTMENT");
    const types = (await ctx.db.select().from(schema.domainEvents)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["appointment.confirmed", "payment.succeeded"]));
  });

  it("is idempotent for a repeated event id and for a new event about the same payment", async () => {
    const co = await checkout();
    await processStripeEvent(ctx.db, gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), NOW);
    expect((await processStripeEvent(ctx.db, gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), NOW)).outcome).toBe("DUPLICATE_EVENT");
    expect((await processStripeEvent(ctx.db, gw, succeededEvent("evt_2", co.paymentIntentId, co.amountCents), NOW)).outcome).toBe("ALREADY_PROCESSED");
    const confirmed = (await ctx.db.select().from(schema.domainEvents)).filter((e) => e.type === "appointment.confirmed");
    expect(confirmed).toHaveLength(1);
    expect(gw.refunds).toHaveLength(0);
  });

  it("two identical deliveries at once still confirm exactly once", async () => {
    const co = await checkout();
    const e = succeededEvent("evt_1", co.paymentIntentId, co.amountCents);
    await Promise.all([processStripeEvent(ctx.db, gw, e, NOW), processStripeEvent(ctx.db, gw, e, NOW)]);
    const confirmed = (await ctx.db.select().from(schema.domainEvents)).filter((e2) => e2.type === "appointment.confirmed");
    expect(confirmed).toHaveLength(1);
    expect(gw.refunds).toHaveLength(0);
  });

  it("hold expired but slot still free: still confirms (BK-23)", async () => {
    const co = await checkout();
    const later = new Date(NOW.getTime() + 15 * 60_000);
    const r = await processStripeEvent(ctx.db, gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), later);
    expect(r.outcome).toBe("CONFIRMED");
  });

  it("hold expired and slot taken meanwhile: booking cancelled and money refunded in full (BK-23)", async () => {
    const co = await checkout();
    const later = new Date(NOW.getTime() + 15 * 60_000);
    const other = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("09:00"), now: later });
    await confirmAppointment(ctx.db, {
      holdId: other.id, patient: { ...PATIENT, firstName: "Sean", dob: "1980-01-01" }, paymentChoice: "AT_CLINIC", now: later,
    });

    const r = await processStripeEvent(ctx.db, gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), later);
    expect(r.outcome).toBe("REFUNDED_SLOT_LOST");
    expect((await appt(co.appointmentId)).status).toBe("CANCELLED_BY_CLINIC");
    expect(gw.refunds).toEqual([expect.objectContaining({ paymentIntentId: co.paymentIntentId, amountCents: co.amountCents })]);
    expect((await pay(co.appointmentId)).status).toBe("REFUNDED");
    // the other patient's booking is untouched
    const confirmed = (await ctx.db.select().from(schema.appointments)).filter((a) => a.status === "CONFIRMED");
    expect(confirmed).toHaveLength(1);
  });

  it("refuses to confirm when the paid amount differs from the database price", async () => {
    const co = await checkout();
    const r = await processStripeEvent(ctx.db, gw, succeededEvent("evt_1", co.paymentIntentId, 100), NOW);
    expect(r.outcome).toBe("AMOUNT_MISMATCH");
    expect((await appt(co.appointmentId)).status).toBe("PENDING_PAYMENT");
    const logs = await ctx.db.select().from(schema.auditLogs);
    expect(logs.map((l) => l.action)).toContain("payment.amount_mismatch");
  });

  it("ignores payments we do not know", async () => {
    expect((await processStripeEvent(ctx.db, gw, succeededEvent("evt_x", "pi_unknown", 5000), NOW)).outcome).toBe("IGNORED");
  });
});

describe("other webhook events", () => {
  it("payment_failed marks the payment FAILED and keeps the booking pending", async () => {
    const co = await checkout();
    await processStripeEvent(ctx.db, gw, failedEvent("evt_f", co.paymentIntentId), NOW);
    expect((await pay(co.appointmentId)).status).toBe("FAILED");
    expect((await appt(co.appointmentId)).status).toBe("PENDING_PAYMENT");
  });

  it("a retry after a failed attempt can still succeed", async () => {
    const co = await checkout();
    await processStripeEvent(ctx.db, gw, failedEvent("evt_f", co.paymentIntentId), NOW);
    const r = await processStripeEvent(ctx.db, gw, succeededEvent("evt_s", co.paymentIntentId, co.amountCents), NOW);
    expect(r.outcome).toBe("CONFIRMED");
  });

  it("charge.refunded from the Stripe dashboard is recorded once", async () => {
    const co = await checkout();
    await processStripeEvent(ctx.db, gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), NOW);
    await processStripeEvent(ctx.db, gw, refundedEvent("evt_r", co.paymentIntentId, 2000), NOW);
    expect((await pay(co.appointmentId)).status).toBe("PARTIALLY_REFUNDED");
    await processStripeEvent(ctx.db, gw, refundedEvent("evt_r2", co.paymentIntentId, 2000), NOW); // same total
    expect(await ctx.db.select().from(schema.refunds)).toHaveLength(1);
    await processStripeEvent(ctx.db, gw, refundedEvent("evt_r3", co.paymentIntentId, co.amountCents), NOW);
    expect((await pay(co.appointmentId)).status).toBe("REFUNDED");
    expect((await ctx.db.select().from(schema.refunds)).reduce((s, r) => s + r.amountCents, 0)).toBe(co.amountCents);
  });
});

describe("refunds and cancellation", () => {
  const paid = async () => {
    const co = await checkout();
    await processStripeEvent(ctx.db, gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), NOW);
    return co;
  };

  it("cancelWithRefund: cancels, frees the slot and refunds in full", async () => {
    const co = await paid();
    const r = await cancelWithRefund(ctx.db, gw, { appointmentId: co.appointmentId, by: "PATIENT", now: NOW });
    expect(r.refundedCents).toBe(co.amountCents);
    expect((await appt(co.appointmentId)).paymentStatus).toBe("REFUNDED");
    await expect(hold("09:00")).resolves.toBeDefined();
  });

  it("a patient inside the window is blocked and nothing is refunded", async () => {
    const co = await paid();
    const close = dublinToUtc("2026-11-23 15:00");
    await expect(cancelWithRefund(ctx.db, gw, { appointmentId: co.appointmentId, by: "PATIENT", now: close })).rejects.toMatchObject({ code: "POLICY" });
    expect(gw.refunds).toHaveLength(0);
  });

  it("the clinic can cancel inside the window and the patient is refunded in full (BK-33)", async () => {
    const co = await paid();
    const close = dublinToUtc("2026-11-23 15:00");
    const r = await cancelWithRefund(ctx.db, gw, { appointmentId: co.appointmentId, by: "CLINIC", now: close });
    expect(r.refundedCents).toBe(co.amountCents);
  });

  it("refunding twice only refunds once", async () => {
    const co = await paid();
    await refundAppointment(ctx.db, gw, { appointmentId: co.appointmentId, reason: "test" });
    const again = await refundAppointment(ctx.db, gw, { appointmentId: co.appointmentId, reason: "test" });
    expect(again.refundedCents).toBe(0);
    expect(gw.refunds).toHaveLength(1);
  });

  it("partial refunds use different idempotency keys and cap at the remaining amount", async () => {
    const co = await paid();
    await refundAppointment(ctx.db, gw, { appointmentId: co.appointmentId, amountCents: 1000, reason: "goodwill" });
    await refundAppointment(ctx.db, gw, { appointmentId: co.appointmentId, amountCents: 999_999, reason: "rest" });
    expect(gw.refunds.map((r) => r.amountCents)).toEqual([1000, co.amountCents - 1000]);
    expect(new Set(gw.refunds.map((r) => r.idempotencyKey)).size).toBe(2);
    expect((await pay(co.appointmentId)).status).toBe("REFUNDED");
  });

  it("unpaid pay-at-clinic bookings cancel without any refund", async () => {
    const h = await hold("11:00");
    const { appointment } = await confirmAppointment(ctx.db, { holdId: h.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: NOW });
    const r = await cancelWithRefund(ctx.db, gw, { appointmentId: appointment.id, by: "PATIENT", now: NOW });
    expect(r.refundedCents).toBe(0);
    expect(gw.refunds).toHaveLength(0);
  });
});

describe("pay at clinic", () => {
  it("staff mark a booking paid once, with a receipt", async () => {
    const h = await hold("11:00");
    const { appointment } = await confirmAppointment(ctx.db, { holdId: h.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: NOW });
    const p = await markPaidAtClinic(ctx.db, { appointmentId: appointment.id, method: "TERMINAL", now: NOW });
    expect(p.provider).toBe("CLINIC");
    expect(p.receiptNumber).toMatch(/^RC-/);
    expect((await appt(appointment.id)).paymentStatus).toBe("PAID");
    await expect(markPaidAtClinic(ctx.db, { appointmentId: appointment.id, method: "CASH", now: NOW })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("is refused for online bookings", async () => {
    const co = await checkout();
    await expect(markPaidAtClinic(ctx.db, { appointmentId: co.appointmentId, method: "CASH", now: NOW })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("refund of a clinic payment is recorded without calling Stripe", async () => {
    const h = await hold("11:00");
    const { appointment } = await confirmAppointment(ctx.db, { holdId: h.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: NOW });
    await markPaidAtClinic(ctx.db, { appointmentId: appointment.id, method: "CASH", now: NOW });
    const r = await refundAppointment(ctx.db, gw, { appointmentId: appointment.id, reason: "test" });
    expect(r.refundedCents).toBe(ctx.priceCents);
    expect(gw.refunds).toHaveLength(0);
  });
});

describe("expireUnpaidAppointments", () => {
  it("cancels abandoned checkouts after the grace period and cancels the PaymentIntent", async () => {
    const co = await checkout();
    const soon = new Date(NOW.getTime() + 20 * 60_000); // hold expired at +10, grace to +40
    expect(await expireUnpaidAppointments(ctx.db, gw, soon)).toBe(0);
    const later = new Date(NOW.getTime() + 45 * 60_000);
    expect(await expireUnpaidAppointments(ctx.db, gw, later)).toBe(1);
    expect((await appt(co.appointmentId)).status).toBe("CANCELLED_BY_CLINIC");
    expect((await pay(co.appointmentId)).status).toBe("FAILED");
    expect(gw.cancelled).toEqual([co.paymentIntentId]);
  });

  it("a late payment after cleanup is taken then refunded", async () => {
    const co = await checkout();
    const later = new Date(NOW.getTime() + 45 * 60_000);
    await expireUnpaidAppointments(ctx.db, gw, later);
    const r = await processStripeEvent(ctx.db, gw, succeededEvent("evt_late", co.paymentIntentId, co.amountCents), later);
    expect(r.outcome).toBe("REFUNDED_SLOT_LOST");
    expect(gw.refunds).toHaveLength(1);
  });

  it("does not touch paid bookings", async () => {
    const co = await checkout();
    await processStripeEvent(ctx.db, gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), NOW);
    const later = new Date(NOW.getTime() + 120 * 60_000);
    expect(await expireUnpaidAppointments(ctx.db, gw, later)).toBe(0);
    expect((await appt(co.appointmentId)).status).toBe("CONFIRMED");
  });
});

describe("cancelAppointment on a pending booking", () => {
  it("is allowed and frees the slot", async () => {
    const co = await checkout();
    // pending bookings still hold only a HOLD lock; the patient abandons and the clinic cancels
    await cancelAppointment(ctx.db, { appointmentId: co.appointmentId, by: "CLINIC", now: NOW });
    expect((await appt(co.appointmentId)).status).toBe("CANCELLED_BY_CLINIC");
    await expect(hold("09:00")).resolves.toBeDefined(); // slot is free again immediately
  });
});
