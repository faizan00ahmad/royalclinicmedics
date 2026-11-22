import { boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const ops = pgSchema("ops");

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// EXT-05: PATIENT role reserved for Phase 2 and unused in Phase 1.
export const roleEnum = ops.enum("role", ["ADMIN", "RECEPTIONIST", "DOCTOR"]);

export const users = ops.table("users", {
  id: id(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecretEnc: text("totp_secret_enc"),
  failedLogins: integer("failed_logins").notNull().default(0),
  totpConfirmedAt: timestamp("totp_confirmed_at", { withTimezone: true }), // null = 2FA not set up yet
  totpLastStep: integer("totp_last_step"), // replay protection: a code is accepted once
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: created(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const settings = ops.table("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consents = ops.table("consents", {
  id: id(),
  patientId: uuid("patient_id").notNull(),
  appointmentId: uuid("appointment_id"),
  type: text("type").notNull(), // TERMS | PRIVACY | CANCELLATION | MARKETING
  documentVersion: text("document_version").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
});

export const enquiries = ops.table("enquiries", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  message: text("message").notNull(),
  status: text("status").notNull().default("NEW"), // NEW | REPLIED | CLOSED
  notes: text("notes"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  createdAt: created(),
});

export const notificationsSent = ops.table("notifications_sent", {
  id: id(),
  appointmentId: uuid("appointment_id"),
  type: text("type").notNull(),
  channel: text("channel").notNull().default("EMAIL"),
  recipient: text("recipient").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  providerId: text("provider_id"),
  status: text("status").notNull().default("SENT"),
}, (t) => [uniqueIndex("notifications_once_uq").on(t.appointmentId, t.type, t.channel, t.recipient)]);

export const stripeEvents = ops.table("stripe_events", {
  id: text("id").primaryKey(), // Stripe event id => idempotency (PAY-03)
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

// EXT-03: outbox, written in the same transaction as the change.
export const domainEvents = ops.table("domain_events", {
  id: id(),
  type: text("type").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  payload: jsonb("payload").notNull().default({}), // ids only, no health data
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [index("domain_events_unprocessed_idx").on(t.processedAt, t.occurredAt)]);

export const auditLogs = ops.table("audit_logs", {
  id: id(),
  actorUserId: uuid("actor_user_id"),
  actorRole: text("actor_role"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  changes: jsonb("changes"), // no health data
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: created(),
}, (t) => [index("audit_logs_created_idx").on(t.createdAt)]);

export const dataExports = ops.table("data_exports", {
  id: id(),
  requestedBy: uuid("requested_by").notNull(),
  type: text("type").notNull(),
  createdAt: created(),
});

/** Server-side sessions (SEC-02). Only a hash of the cookie token is stored. */
export const sessions = ops.table("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  mfaVerified: boolean("mfa_verified").notNull().default(false),
  createdAt: created(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
}, (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);
