import { availableDays, getAvailability } from "@rmc/core";
import { z } from "zod";
import { json, rateLimit, route } from "@/lib/http";
import { db } from "@/lib/server";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  serviceId: z.string().uuid(),
  doctorId: z.string().uuid().optional(),
  from: date,
  to: date,
}).refine((q) => q.from <= q.to, { message: "from must not be after to", path: ["to"] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 62, { message: "Range is limited to 62 days", path: ["to"] });

/** GET /api/slots. Public. Returns only free times (BK-03, BK-10). */
export const GET = route("slots", async (req) => {
  rateLimit(req, "slots", 60);
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const slots = await getAvailability(db(), {
    serviceId: q.serviceId, doctorId: q.doctorId, fromDate: q.from, toDate: q.to, now: new Date(),
  });
  return json({
    days: availableDays(slots),
    slots: slots.map((s) => ({ doctorId: s.doctorId, startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString() })),
  });
});
