import { cancelWithRefund, resolveAppointmentByToken } from "@rmc/core";
import { ApiError, json, manageToken, rateLimit, requireSameOrigin, route } from "@/lib/http";
import { sendEmailsSoon } from "@/lib/mail";
import { db, gateway } from "@/lib/server";

type Ctx = { params: Promise<{ ref: string }> };

/** POST /api/bookings/[ref]/cancel (BK-31). Free outside the cancellation window, refunded automatically. */
export const POST = route<Ctx>("cancel", async (req, { params }) => {
  requireSameOrigin(req);
  rateLimit(req, "manage-write", 10);
  const { ref } = await params;
  const appt = await resolveAppointmentByToken(db(), ref, manageToken(req));
  if (!appt) throw new ApiError(404, "NOT_FOUND", "Booking not found");
  const r = await cancelWithRefund(db(), gateway(), { appointmentId: appt.id, by: "PATIENT", reason: "Cancelled by patient" });
  sendEmailsSoon();
  return json({ status: r.appointment.status, refundedCents: r.refundedCents });
});
