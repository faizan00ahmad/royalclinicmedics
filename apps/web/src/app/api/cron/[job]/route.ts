import { expireUnpaidAppointments, processOutbox, releaseExpiredHolds, runRetention, sendDueReminders } from "@rmc/core";
import { ApiError, json, requireCron, route } from "@/lib/http";
import { db, lazyGateway, mailDeps } from "@/lib/server";

type Ctx = { params: Promise<{ job: string }> };

/**
 * POST /api/cron/[job]. Called every 5 minutes by cron-job.org with `Authorization: Bearer $CRON_SECRET`.
 * Also sends queued emails (retries after a provider outage) and the 24 hour and 2 hour reminders.
 */
export const POST = route<Ctx>("cron", async (req, { params }) => {
  requireCron(req);
  const { job } = await params;
  if (job !== "maintenance") throw new ApiError(404, "UNKNOWN_JOB", "Unknown job");
  const now = new Date();
  await releaseExpiredHolds(db(), now);
  const expiredUnpaid = await expireUnpaidAppointments(db(), lazyGateway(), now);
  // Emails last, so the cancellations above are included in this run.
  const outbox = await processOutbox(db(), { ...mailDeps(), now });
  const reminders = await sendDueReminders(db(), { ...mailDeps(), now });
  const retention = await runRetention(db(), now); // cheap, so it simply runs every time
  return json({ ok: true, expiredUnpaid, retention, emails: outbox.sent, emailFailures: outbox.failed, reminders: reminders.sent });
});
