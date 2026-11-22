import { createStripeGatewayFromEnv, createTransportFromEnv, type Database, type EmailTransport, type OutboxDeps, type PaymentGateway } from "@rmc/core";
import { getDb } from "@rmc/db";

/**
 * One place that supplies the database and Stripe to every route.
 * Tests replace them with an in-memory Postgres and a fake gateway.
 */
interface Overrides {
  db?: () => Database;
  gateway?: () => PaymentGateway;
  email?: () => EmailTransport;
}
let overrides: Overrides = {};

export function __setServices(o: Overrides): void {
  overrides = o;
}

export function db(): Database {
  return overrides.db ? overrides.db() : (getDb() as unknown as Database);
}

let stripeGateway: PaymentGateway | undefined;
export function gateway(): PaymentGateway {
  if (overrides.gateway) return overrides.gateway();
  stripeGateway ??= createStripeGatewayFromEnv();
  return stripeGateway;
}

/** Resolves Stripe only when a call actually needs it, so cancelling a pay-at-clinic booking works without Stripe keys. */
export function lazyGateway(): PaymentGateway {
  return {
    createPaymentIntent: (p) => gateway().createPaymentIntent(p),
    cancelPaymentIntent: (id) => gateway().cancelPaymentIntent(id),
    refund: (p) => gateway().refund(p),
    constructEvent: (raw, sig) => gateway().constructEvent(raw, sig),
  };
}

let transport: EmailTransport | undefined;
export function emailTransport(): EmailTransport {
  if (overrides.email) return overrides.email();
  transport ??= createTransportFromEnv();
  return transport;
}

export const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** Everything the email dispatcher needs. Resolves the provider only when it is actually used. */
export function mailDeps(): OutboxDeps {
  return {
    siteUrl: siteUrl(),
    clinicNotifyFallback: process.env.CLINIC_NOTIFY_EMAIL,
    transport: { send: (m) => emailTransport().send(m) },
  };
}
