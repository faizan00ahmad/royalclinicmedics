/**
 * The only thing the booking code knows about Stripe (PAY-01, PAY-08).
 * Tests use a fake. Production uses createStripeGateway.
 * No card data ever reaches our servers: the browser talks to Stripe with the client secret.
 */
export interface GatewayEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface PaymentGateway {
  /** Metadata is booking reference and appointment id only. Never health data (PAY-02). */
  createPaymentIntent(p: {
    amountCents: number;
    appointmentId: string;
    bookingRef: string;
    receiptEmail?: string;
  }): Promise<{ id: string; clientSecret: string }>;
  cancelPaymentIntent(paymentIntentId: string): Promise<void>;
  refund(p: { paymentIntentId: string; amountCents: number; idempotencyKey: string }): Promise<{ id: string }>;
  /** Verifies the Stripe signature. Throws on a bad signature. */
  constructEvent(rawBody: string, signature: string): GatewayEvent;
}
