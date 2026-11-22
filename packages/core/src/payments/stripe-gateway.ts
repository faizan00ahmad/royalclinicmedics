import Stripe from "stripe";
import type { GatewayEvent, PaymentGateway } from "./gateway";

/** Fails clearly when keys are missing. No silent mocks in production (CLAUDE.md section 4). */
export function createStripeGatewayFromEnv(env: Record<string, string | undefined> = process.env): PaymentGateway {
  const key = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return createStripeGateway(key, webhookSecret);
}

export function createStripeGateway(secretKey: string, webhookSecret: string): PaymentGateway {
  const stripe = new Stripe(secretKey);
  return {
    async createPaymentIntent(p) {
      const pi = await stripe.paymentIntents.create(
        {
          amount: p.amountCents,
          currency: "eur",
          // Payment Element: cards, Apple Pay, Google Pay and Link are shown when enabled in the Stripe dashboard.
          automatic_payment_methods: { enabled: true },
          receipt_email: p.receiptEmail,
          metadata: { appointmentId: p.appointmentId, bookingRef: p.bookingRef },
        },
        { idempotencyKey: `pi_create_${p.appointmentId}` },
      );
      if (!pi.client_secret) throw new Error("Stripe returned no client secret");
      return { id: pi.id, clientSecret: pi.client_secret };
    },
    async cancelPaymentIntent(id) {
      await stripe.paymentIntents.cancel(id);
    },
    async refund(p) {
      const r = await stripe.refunds.create(
        { payment_intent: p.paymentIntentId, amount: p.amountCents },
        { idempotencyKey: p.idempotencyKey },
      );
      return { id: r.id };
    },
    constructEvent(rawBody, signature) {
      const e = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      return e as unknown as GatewayEvent;
    },
  };
}
