import { getBookingSummary, resolveAppointmentByToken } from "@rmc/core";
import { ApiError, json, manageToken, rateLimit, route } from "@/lib/http";
import { db } from "@/lib/server";

type Ctx = { params: Promise<{ ref: string }> };

/** GET /api/bookings/[ref]. Needs the manage token (SEC-04). Unknown ref and wrong token look identical. */
export const GET = route<Ctx>("booking", async (req, { params }) => {
  rateLimit(req, "manage", 30);
  const { ref } = await params;
  const appt = await resolveAppointmentByToken(db(), ref, manageToken(req));
  if (!appt) throw new ApiError(404, "NOT_FOUND", "Booking not found");
  return json(await getBookingSummary(db(), appt));
});
