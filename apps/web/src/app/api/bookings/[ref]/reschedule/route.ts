import { resolveAppointmentByToken, rescheduleAppointment } from "@rmc/core";
import { z } from "zod";
import { ApiError, json, manageToken, rateLimit, requireSameOrigin, readJson, route } from "@/lib/http";
import { sendEmailsSoon } from "@/lib/mail";
import { db } from "@/lib/server";

type Ctx = { params: Promise<{ ref: string }> };
const body = z.object({ newStartAt: z.string().datetime({ offset: true }).transform((s) => new Date(s)) });

/** POST /api/bookings/[ref]/reschedule (BK-31, BK-32). Same doctor and service, new time. */
export const POST = route<Ctx>("reschedule", async (req, { params }) => {
  requireSameOrigin(req);
  rateLimit(req, "manage-write", 10);
  const { ref } = await params;
  const input = await readJson(req, body);
  const appt = await resolveAppointmentByToken(db(), ref, manageToken(req));
  if (!appt) throw new ApiError(404, "NOT_FOUND", "Booking not found");
  const moved = await rescheduleAppointment(db(), { appointmentId: appt.id, newStartAt: input.newStartAt, by: "PATIENT" });
  sendEmailsSoon();
  return json({ startAt: moved.startAt.toISOString(), endAt: moved.endAt.toISOString(), rescheduleCount: moved.rescheduleCount });
});
