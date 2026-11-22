import {
  confirmAppointment, parseQuestionnaire, patientInput, recordConsents, startOnlineCheckout,
} from "@rmc/core";
import { z } from "zod";
import { clientIp, json, rateLimit, readJson, route } from "@/lib/http";
import { db, gateway } from "@/lib/server";

const body = z.object({
  holdId: z.string().uuid(),
  patient: patientInput,
  paymentChoice: z.enum(["ONLINE", "AT_CLINIC"]),
  reason: z.string().trim().max(500).optional(),
  questionnaire: z.unknown(),
  // BK-07: all three must be exactly true. Marketing is optional.
  consents: z.object({
    terms: z.literal(true),
    privacy: z.literal(true),
    cancellation: z.literal(true),
    marketing: z.boolean().optional(),
  }),
});

/**
 * POST /api/bookings/checkout (BK-05..BK-09, PAY-01, PAY-04).
 * ONLINE: creates a pending booking and a Stripe PaymentIntent; the webhook confirms it.
 * AT_CLINIC: confirms straight away if the service allows it.
 * The response never repeats the patient's details or questionnaire.
 */
export const POST = route("checkout", async (req) => {
  rateLimit(req, "checkout", 10);
  const input = await readJson(req, body);
  const questionnaire = parseQuestionnaire(input.questionnaire);
  const now = new Date();

  const common = { holdId: input.holdId, patient: input.patient, reason: input.reason, questionnaire, now };
  const consent = (appointmentId: string) =>
    recordConsents(db(), { appointmentId, ip: clientIp(req), ...input.consents });

  if (input.paymentChoice === "ONLINE") {
    const co = await startOnlineCheckout(db(), gateway(), common);
    await consent(co.appointmentId);
    return json({
      bookingRef: co.bookingRef, manageToken: co.manageToken, status: "PENDING_PAYMENT",
      clientSecret: co.clientSecret, amountCents: co.amountCents,
    }, 201);
  }

  const { appointment, manageToken } = await confirmAppointment(db(), { ...common, paymentChoice: "AT_CLINIC" });
  await consent(appointment.id);
  return json({
    bookingRef: appointment.bookingRef, manageToken, status: appointment.status, amountCents: appointment.totalCents,
  }, 201);
});
