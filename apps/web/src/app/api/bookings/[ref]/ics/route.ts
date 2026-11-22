import { buildIcs, getBookingSummary, resolveAppointmentByToken } from "@rmc/core";
import { ApiError, manageToken, rateLimit, route } from "@/lib/http";
import { db } from "@/lib/server";

type Ctx = { params: Promise<{ ref: string }> };

/** GET /api/bookings/[ref]/ics. The token may be in the query so email links work (BK-09). */
export const GET = route<Ctx>("ics", async (req, { params }) => {
  rateLimit(req, "manage", 30);
  const { ref } = await params;
  const appt = await resolveAppointmentByToken(db(), ref, manageToken(req, true));
  if (!appt) throw new ApiError(404, "NOT_FOUND", "Booking not found");
  const s = await getBookingSummary(db(), appt);
  const ics = buildIcs({
    bookingRef: s.bookingRef, startAt: appt.startAt, endAt: appt.endAt, serviceName: s.service.name,
    clinicName: s.clinic.name, clinicAddress: s.clinic.address, clinicPhone: s.clinic.phone,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${s.bookingRef}.ics"`,
      "Cache-Control": "no-store",
    },
  });
});
