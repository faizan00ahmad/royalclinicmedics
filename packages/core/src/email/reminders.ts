import { schema } from "@rmc/db";
import { and, asc, eq, gt, lte } from "drizzle-orm";
import type { Database } from "../db-types";
import { loadSettingsMap } from "../settings";
import { loadAppointmentEmailData } from "./context";
import { deliver, type OutboxDeps } from "./outbox";

const HOUR = 3_600_000;

/** N-03 / N-04. Hours before the appointment, editable in settings (`notifications.reminderHours`). */
export async function reminderHours(db: Database): Promise<number[]> {
  const v = (await loadSettingsMap(db))["notifications.reminderHours"];
  const hours = Array.isArray(v) ? v.filter((h): h is number => typeof h === "number" && h > 0 && h <= 168) : [24, 2];
  return [...new Set(hours)].sort((a, b) => b - a);
}

const lead = (h: number) => (h >= 24 ? (h === 24 ? "tomorrow" : `in ${Math.round(h / 24)} days`) : h === 1 ? "in about an hour" : `in about ${h} hours`);

/**
 * Each reminder is sent once per booking (unique notification row). A reminder is skipped when the booking was
 * made inside that window (for example booked 3 hours ahead: no "24 hours" reminder straight after the confirmation).
 */
export async function sendDueReminders(db: Database, deps: OutboxDeps): Promise<{ sent: number; failed: number }> {
  const now = deps.now ?? new Date();
  let sent = 0, failed = 0;

  for (const h of await reminderHours(db)) {
    const due = await db.select({ id: schema.appointments.id, startAt: schema.appointments.startAt, createdAt: schema.appointments.createdAt })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.status, "CONFIRMED"), gt(schema.appointments.startAt, now), lte(schema.appointments.startAt, new Date(now.getTime() + h * HOUR))))
      .orderBy(asc(schema.appointments.startAt)).limit(200);

    for (const a of due) {
      if (a.createdAt.getTime() > a.startAt.getTime() - h * HOUR) continue; // booked inside the window
      try {
        const ok = await db.transaction(async (tx) => {
          const data = await loadAppointmentEmailData(tx, a.id, deps);
          if (!data) return false;
          return deliver({ tx, deps: { ...deps, now }, type: `reminder_${h}h`, to: data.patientEmail, template: "reminder", appointmentId: a.id, vars: { ...data.vars, reminderLead: lead(h) } });
        });
        if (ok) sent++;
      } catch {
        failed++; // the claim rolled back with the transaction, so the next run tries again
      }
    }
  }
  return { sent, failed };
}
