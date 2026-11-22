import { schema } from "@rmc/db";
import type { Database } from "./db-types";

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string; // e.g. "appointment.cancel", "export.patients", "auth.login"
  entityType: string;
  entityId?: string | null;
  /** Field names and ids only. NEVER health data, questionnaire answers or free text from patients (SEC-09). */
  changes?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** SEC-09. Call with the same transaction as the change where one exists. */
export async function audit(db: Database, e: AuditEntry): Promise<void> {
  await db.insert(schema.auditLogs).values({
    actorUserId: e.actorUserId ?? null,
    actorRole: e.actorRole ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    changes: e.changes ?? null,
    ip: e.ip ?? null,
    userAgent: e.userAgent?.slice(0, 300) ?? null,
  });
}
