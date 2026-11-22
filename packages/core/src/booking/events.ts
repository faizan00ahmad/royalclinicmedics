import { schema } from "@rmc/db";
import type { Database } from "../db-types";

export type DomainEventType =
  | "appointment.confirmed"
  | "appointment.rescheduled"
  | "appointment.cancelled"
  | "appointment.checked_in"
  | "patient.updated"
  | "payment.succeeded"
  | "payment.refunded"
  | "enquiry.created";

/**
 * EXT-03 outbox. Always call with the SAME transaction as the change itself.
 * Payload holds ids only. Never put health data or questionnaire answers here.
 */
export async function emitEvent(
  tx: Database,
  e: { type: DomainEventType; aggregateType: "appointment" | "patient" | "payment" | "enquiry"; aggregateId: string; payload?: Record<string, unknown> },
) {
  await tx.insert(schema.domainEvents).values({
    type: e.type,
    aggregateType: e.aggregateType,
    aggregateId: e.aggregateId,
    payload: e.payload ?? {},
  });
}
