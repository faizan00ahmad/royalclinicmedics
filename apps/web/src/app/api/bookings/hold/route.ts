import { SlotTakenError, createHold, dublinDate, getAvailability } from "@rmc/core";
import { z } from "zod";
import { json, rateLimit, readJson, route } from "@/lib/http";
import { db } from "@/lib/server";

const body = z.object({
  serviceId: z.string().uuid(),
  /** Omit for "first available doctor" (BK-02). */
  doctorId: z.string().uuid().optional(),
  startAt: z.string().datetime({ offset: true }).transform((s) => new Date(s)),
});

/** POST /api/bookings/hold. Reserves a slot for 10 minutes (BK-04). */
export const POST = route("hold", async (req) => {
  rateLimit(req, "hold", 10);
  const input = await readJson(req, body);
  const now = new Date();

  let doctorId = input.doctorId;
  if (!doctorId) {
    const day = dublinDate(input.startAt);
    const slots = await getAvailability(db(), { serviceId: input.serviceId, fromDate: day, toDate: day, now });
    doctorId = slots.find((s) => s.startAt.getTime() === input.startAt.getTime())?.doctorId;
    if (!doctorId) throw new SlotTakenError();
  }

  const hold = await createHold(db(), { serviceId: input.serviceId, doctorId, startAt: input.startAt, now });
  return json({
    holdId: hold.id,
    doctorId: hold.doctorId,
    startAt: hold.startAt.toISOString(),
    endAt: hold.endAt.toISOString(),
    expiresAt: hold.expiresAt.toISOString(),
  }, 201);
});
