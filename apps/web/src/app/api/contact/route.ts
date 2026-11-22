import { schema } from "@rmc/db";
import { z } from "zod";
import { json, rateLimit, readJson, route } from "@/lib/http";
import { db } from "@/lib/server";

const body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(30).optional(),
  message: z.string().trim().min(5).max(2000),
  consent: z.literal(true),
  /** Honeypot: real people never see or fill this field. */
  website: z.string().max(200).optional(),
});

/**
 * POST /api/contact (WEB-08). Saved for staff to answer in admin.
 * Notes: do not put medical details in this form (the page says so). Turnstile and the clinic email are added with email sending.
 */
export const POST = route("contact", async (req) => {
  rateLimit(req, "contact", 5);
  const input = await readJson(req, body);
  if (input.website) return json({ ok: true }, 201); // bot: pretend it worked, store nothing
  await db().insert(schema.enquiries).values({
    name: input.name, email: input.email, phone: input.phone ?? null, message: input.message,
  });
  return json({ ok: true }, 201);
});
