import { emitEvent } from "@rmc/core";
import { schema } from "@rmc/db";
import { z } from "zod";
import { clientIp, json, rateLimit, readJson, requireSameOrigin, route } from "@/lib/http";
import { sendEmailsSoon } from "@/lib/mail";
import { db } from "@/lib/server";
import { verifyTurnstile } from "@/lib/turnstile";

const body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(30).optional(),
  message: z.string().trim().min(5).max(2000),
  consent: z.literal(true),
  /** Honeypot: real people never see or fill this field. */
  website: z.string().max(200).optional(),
  turnstileToken: z.string().max(2048).optional(),
});

/**
 * POST /api/contact (WEB-08). Saved for staff to answer in admin.
 * Do not put medical details in this form (the page says so). Cloudflare Turnstile is still to add.
 */
export const POST = route("contact", async (req) => {
  requireSameOrigin(req);
  rateLimit(req, "contact", 5);
  const input = await readJson(req, body);
  if (input.website) return json({ ok: true }, 201); // bot: pretend it worked, store nothing
  await verifyTurnstile(input.turnstileToken, clientIp(req));
  await db().transaction(async (tx) => {
    const [enq] = await tx.insert(schema.enquiries).values({
      name: input.name, email: input.email, phone: input.phone ?? null, message: input.message,
    }).returning({ id: schema.enquiries.id });
    await emitEvent(tx, { type: "enquiry.created", aggregateType: "enquiry", aggregateId: enq!.id });
  });
  sendEmailsSoon(); // alert to the clinic and automatic reply to the sender
  return json({ ok: true }, 201);
});
