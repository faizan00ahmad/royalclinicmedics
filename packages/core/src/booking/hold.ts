import { schema } from "@rmc/db";
import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db-types";
import { computeSlots, dublinDate } from "../slots";
import { loadAvailability } from "./availability";
import { BookingError, SlotTakenError, isExclusionViolation } from "./errors";

const holdInput = z.object({
  serviceId: z.string().uuid(),
  doctorId: z.string().uuid(),
  startAt: z.date(),
  mode: z.enum(["IN_CLINIC", "VIDEO", "PHONE"]).default("IN_CLINIC"),
});
export type CreateHoldInput = z.input<typeof holdInput> & { now?: Date };

/** Frees expired holds. Cheap, and run before every hold so a stale hold can never block a slot. */
export async function releaseExpiredHolds(tx: Database, now: Date): Promise<void> {
  await tx.delete(schema.slotLocks).where(and(eq(schema.slotLocks.kind, "HOLD"), lte(schema.slotLocks.expiresAt, now)));
  await tx.update(schema.slotHolds).set({ status: "EXPIRED" })
    .where(and(eq(schema.slotHolds.status, "ACTIVE"), lte(schema.slotHolds.expiresAt, now)));
}

/**
 * EXT-04, BK-04, BK-20, BK-21.
 * Re-validates the slot on the server, then inserts the hold and its lock in one transaction.
 * The exclusion constraint on slot_locks is the final word: if two patients race, one gets SlotTakenError.
 */
export async function createHold(db: Database, raw: CreateHoldInput) {
  const { now: nowIn, ...rest } = raw;
  const input = holdInput.parse(rest);
  const now = nowIn ?? new Date();

  return db.transaction(async (tx) => {
    await releaseExpiredHolds(tx, now);

    const date = dublinDate(input.startAt);
    const { service, settings, input: avail } = await loadAvailability(tx, {
      serviceId: input.serviceId, doctorId: input.doctorId, fromDate: date, toDate: date, now,
    });

    if (input.mode !== "IN_CLINIC") {
      if (!settings.onlineConsultations || !service.modes.includes(input.mode)) {
        throw new BookingError("POLICY", "Online consultations are not available yet");
      }
    }

    const slot = computeSlots(avail).find(
      (s) => s.doctorId === input.doctorId && s.startAt.getTime() === input.startAt.getTime(),
    );
    if (!slot) throw new SlotTakenError();

    const expiresAt = new Date(now.getTime() + settings.holdMinutes * 60_000);
    try {
      const [hold] = await tx.insert(schema.slotHolds).values({
        doctorId: slot.doctorId, serviceId: service.id, mode: input.mode,
        startAt: slot.startAt, endAt: slot.endAt, expiresAt,
      }).returning();
      await tx.insert(schema.slotLocks).values({
        doctorId: slot.doctorId, startAt: slot.startAt, endAt: slot.lockEndAt,
        kind: "HOLD", holdId: hold!.id, expiresAt,
      });
      return hold!;
    } catch (err) {
      if (isExclusionViolation(err)) throw new SlotTakenError();
      throw err;
    }
  });
}

/** Patient abandons checkout: free the slot immediately. */
export async function releaseHold(db: Database, holdId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.slotLocks).where(eq(schema.slotLocks.holdId, holdId));
    await tx.update(schema.slotHolds).set({ status: "EXPIRED" })
      .where(and(eq(schema.slotHolds.id, holdId), eq(schema.slotHolds.status, "ACTIVE")));
  });
}
