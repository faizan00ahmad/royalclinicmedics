import type { GatewayEvent, PaymentGateway } from "../payments/gateway";

/** In-memory stand-in for Stripe. Records every call so tests can assert on them. */
export class FakeGateway implements PaymentGateway {
  intents: { id: string; amountCents: number; appointmentId: string; bookingRef: string; receiptEmail?: string }[] = [];
  refunds: { paymentIntentId: string; amountCents: number; idempotencyKey: string }[] = [];
  cancelled: string[] = [];
  failCreate = false;
  private n = 0;

  async createPaymentIntent(p: { amountCents: number; appointmentId: string; bookingRef: string; receiptEmail?: string }) {
    if (this.failCreate) throw new Error("stripe down");
    const id = `pi_fake_${++this.n}`;
    this.intents.push({ id, ...p });
    return { id, clientSecret: `${id}_secret` };
  }
  async cancelPaymentIntent(id: string) { this.cancelled.push(id); }
  async refund(p: { paymentIntentId: string; amountCents: number; idempotencyKey: string }) {
    this.refunds.push(p);
    return { id: `re_fake_${this.refunds.length}` };
  }
  constructEvent(rawBody: string, signature: string): GatewayEvent {
    if (signature !== "valid") throw new Error("bad signature");
    return JSON.parse(rawBody) as GatewayEvent;
  }
}

export const succeededEvent = (eventId: string, piId: string, amount: number): GatewayEvent => ({
  id: eventId, type: "payment_intent.succeeded", data: { object: { id: piId, amount, amount_received: amount } },
});
export const failedEvent = (eventId: string, piId: string): GatewayEvent => ({
  id: eventId, type: "payment_intent.payment_failed", data: { object: { id: piId } },
});
export const refundedEvent = (eventId: string, piId: string, amountRefunded: number): GatewayEvent => ({
  id: eventId, type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: piId, amount_refunded: amountRefunded } },
});
