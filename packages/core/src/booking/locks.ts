import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import type { Database } from "../db-types";
import { SlotTakenError, isExclusionViolation } from "./errors";
import { releaseExpiredHolds } from "./hold";

export interface LockableAppointment {
  id: string;
  doctorId: string;
  startAt: Date;
  endAt: Date;
}

/**
 * Turns the appointment's hold lock into a permanent APPOINTMENT lock, in place.
 * If the hold already expired, re-locks the slot when it is still free.
 * Throws SlotTakenError when someone else got there first (callers then refund, BK-23).
 */
export async function lockSlotForAppointment(
  tx: Database,
  appt: LockableAppointment,
  holdId: string | null,
  bufferMin: number,
  now: Date,
): Promise<void> {
  const [lock] = holdId
    ? await tx.select().from(schema.slotLocks).where(eq(schema.slotLocks.holdId, holdId))
    : [];
  const stillValid = lock && lock.expiresAt && lock.expiresAt > now;
  try {
    if (stillValid) {
      await tx.update(schema.slotLocks)
        .set({ kind: "APPOINTMENT", holdId: null, appointmentId: appt.id, expiresAt: null })
        .where(eq(schema.slotLocks.id, lock.id));
    } else {
      await releaseExpiredHolds(tx, now);
      await tx.insert(schema.slotLocks).values({
        doctorId: appt.doctorId,
        startAt: appt.startAt,
        endAt: new Date(appt.endAt.getTime() + bufferMin * 60_000),
        kind: "APPOINTMENT",
        appointmentId: appt.id,
      });
    }
  } catch (err) {
    if (isExclusionViolation(err)) throw new SlotTakenError();
    throw err;
  }
  if (holdId) {
    await tx.update(schema.slotHolds).set({ status: "CONSUMED" }).where(eq(schema.slotHolds.id, holdId));
  }
}
