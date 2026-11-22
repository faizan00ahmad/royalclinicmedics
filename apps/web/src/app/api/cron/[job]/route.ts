import { expireUnpaidAppointments, releaseExpiredHolds } from "@rmc/core";
import { ApiError, json, requireCron, route } from "@/lib/http";
import { db, gateway } from "@/lib/server";

type Ctx = { params: Promise<{ job: string }> };

/**
 * POST /api/cron/[job]. Called every 5 minutes by cron-job.org with `Authorization: Bearer $CRON_SECRET`.
 * Reminder emails will be added here when email sending is built.
 */
export const POST = route<Ctx>("cron", async (req, { params }) => {
  requireCron(req);
  const { job } = await params;
  if (job !== "maintenance") throw new ApiError(404, "UNKNOWN_JOB", "Unknown job");
  const now = new Date();
  await releaseExpiredHolds(db(), now);
  const expiredUnpaid = await expireUnpaidAppointments(db(), gateway(), now);
  return json({ ok: true, expiredUnpaid });
});
