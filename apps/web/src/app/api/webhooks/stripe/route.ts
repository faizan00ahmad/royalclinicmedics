import { processStripeEvent, type GatewayEvent } from "@rmc/core";
import { ApiError, json, route } from "@/lib/http";
import { db, gateway } from "@/lib/server";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/stripe (PAY-03). Needs the raw body for the signature, so no JSON parsing here.
 * A bad signature is 400. A failure while handling is 500 so Stripe retries.
 */
export const POST = route("stripe-webhook", async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) throw new ApiError(400, "NO_SIGNATURE", "Missing signature");
  const raw = await req.text();

  let event: GatewayEvent;
  try {
    event = gateway().constructEvent(raw, signature);
  } catch (err) {
    if (err instanceof Error && /is not set$/.test(err.message)) throw err; // configuration problem, not a bad caller
    throw new ApiError(400, "BAD_SIGNATURE", "Invalid signature");
  }

  const { outcome } = await processStripeEvent(db(), gateway(), event);
  return json({ received: true, outcome });
});
