import { createStripeGatewayFromEnv, type Database, type PaymentGateway } from "@rmc/core";
import { getDb } from "@rmc/db";

/**
 * One place that supplies the database and Stripe to every route.
 * Tests replace them with an in-memory Postgres and a fake gateway.
 */
interface Overrides {
  db?: () => Database;
  gateway?: () => PaymentGateway;
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
