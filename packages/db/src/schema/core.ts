import { sql } from "drizzle-orm";
import {
  boolean, check, date, index, integer, jsonb, pgSchema, text, time, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export const core = pgSchema("core");

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// EXT-01: all modes exist now, only IN_CLINIC is enabled by feature flag.
export const modeEnum = core.enum("mode", ["IN_CLINIC", "VIDEO", "PHONE"]);
export const appointmentStatusEnum = core.enum("appointment_status", [
  "PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "COMPLETED",
  "CANCELLED_BY_PATIENT", "CANCELLED_BY_CLINIC", "NO_SHOW",
]);
export const paymentStatusEnum = core.enum("payment_status", [
  "UNPAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED",
]);
export const paymentChoiceEnum = core.enum("payment_choice", ["ONLINE", "AT_CLINIC", "FREE"]);
export const sourceEnum = core.enum("booking_source", ["ONLINE", "WALK_IN", "PHONE", "STAFF"]);
export const lockKindEnum = core.enum("lock_kind", ["HOLD", "APPOINTMENT"]);
export const paymentMethodEnum = core.enum("payment_method", [
  "CARD", "APPLE_PAY", "GOOGLE_PAY", "CASH", "TERMINAL", "OTHER",
]);
export const questionTypeEnum = core.enum("question_type", [
  "SHORT_TEXT", "LONG_TEXT", "YES_NO", "SINGLE_CHOICE", "MULTI_CHOICE", "DATE", "NUMBER",
]);
export const discountTypeEnum = core.enum("discount_type", ["PERCENT", "FIXED"]);

export const doctors = core.table("doctors", {
  id: id(),
  displayName: text("display_name").notNull(),
  title: text("title"),
  bio: text("bio"),
  photoUrl: text("photo_url"),
  qualifications: text("qualifications"),
  imcNumber: text("imc_number"),
  languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
  userId: uuid("user_id"), // optional staff login (ops.users), no FK to keep schemas decoupled
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: created(), updatedAt: updated(),
});

export const services = core.table("services", {
  id: id(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  shortDescription: text("short_description"),
  description: text("description"),
  priceCents: integer("price_cents").notNull(),
  durationMin: integer("duration_min").notNull(),
  bufferMin: integer("buffer_min").notNull().default(0),
  modes: text("modes").array().notNull().default(sql`ARRAY['IN_CLINIC']::text[]`),
  payAtClinicAllowed: boolean("pay_at_clinic_allowed").notNull().default(true),
  gmsEligible: boolean("gms_eligible").notNull().default(false),
  minNoticeOverrideMin: integer("min_notice_override_min"),
  featured: boolean("featured").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  imageUrl: text("image_url"),
  createdAt: created(), updatedAt: updated(),
}, (t) => [
  uniqueIndex("services_slug_uq").on(t.slug),
  check("services_price_nonneg", sql`${t.priceCents} >= 0`),
  check("services_duration_pos", sql`${t.durationMin} > 0`),
  check("services_modes_valid", sql`${t.modes} <@ ARRAY['IN_CLINIC','VIDEO','PHONE']::text[]`),
]);

export const serviceDoctors = core.table("service_doctors", {
  id: id(),
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  doctorId: uuid("doctor_id").notNull().references(() => doctors.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("service_doctors_uq").on(t.serviceId, t.doctorId)]);

export const serviceFaqs = core.table("service_faqs", {
  id: id(),
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

// BK-41: extra per-service questionnaire questions
export const serviceQuestions = core.table("service_questions", {
  id: id(),
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  type: questionTypeEnum("type").notNull(),
  required: boolean("required").notNull().default(false),
  options: jsonb("options"),
  helpText: text("help_text"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const availabilityRules = core.table("availability_rules", {
  id: id(),
  doctorId: uuid("doctor_id").notNull().references(() => doctors.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(), // 0 = Sunday .. 6 = Saturday, Dublin local
  startTime: time("start_time").notNull(), // Dublin wall-clock
  endTime: time("end_time").notNull(),
  modes: text("modes").array().notNull().default(sql`ARRAY['IN_CLINIC']::text[]`),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
}, (t) => [
  check("availability_weekday_range", sql`${t.weekday} BETWEEN 0 AND 6`),
  check("availability_times_order", sql`${t.endTime} > ${t.startTime}`),
  check("availability_modes_valid", sql`${t.modes} <@ ARRAY['IN_CLINIC','VIDEO','PHONE']::text[]`),
]);

export const availabilityOverrides = core.table("availability_overrides", {
  id: id(),
  doctorId: uuid("doctor_id").notNull().references(() => doctors.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  startTime: time("start_time"),
  endTime: time("end_time"),
  isClosed: boolean("is_closed").notNull().default(false),
  note: text("note"),
});

export const clinicHolidays = core.table("clinic_holidays", {
  id: id(),
  date: date("date").notNull(),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("clinic_holidays_date_uq").on(t.date)]);

export const timeBlocks = core.table("time_blocks", {
  id: id(),
  doctorId: uuid("doctor_id").notNull().references(() => doctors.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  reason: text("reason"),
  recurrenceRule: text("recurrence_rule"),
});

// EXT-06: identity and contact only. Clinical data never lives here.
export const patients = core.table("patients", {
  id: id(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dob: date("dob").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  eircode: text("eircode"),
  medicalCard: boolean("medical_card").notNull().default(false),
  guardianName: text("guardian_name"),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  mergedIntoId: uuid("merged_into_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: created(), updatedAt: updated(),
}, (t) => [index("patients_email_idx").on(t.email), index("patients_name_idx").on(t.lastName, t.firstName)]);

export const slotHolds = core.table("slot_holds", {
  id: id(),
  doctorId: uuid("doctor_id").notNull().references(() => doctors.id),
  serviceId: uuid("service_id").notNull().references(() => services.id),
  mode: modeEnum("mode").notNull().default("IN_CLINIC"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | CONSUMED | EXPIRED
  createdAt: created(),
}, (t) => [index("slot_holds_expiry_idx").on(t.expiresAt)]);

export const appointments = core.table("appointments", {
  id: id(),
  bookingRef: text("booking_ref").notNull(),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  doctorId: uuid("doctor_id").notNull().references(() => doctors.id),
  serviceId: uuid("service_id").notNull().references(() => services.id),
  mode: modeEnum("mode").notNull().default("IN_CLINIC"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  status: appointmentStatusEnum("status").notNull().default("PENDING_PAYMENT"),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("UNPAID"),
  paymentChoice: paymentChoiceEnum("payment_choice").notNull(),
  priceCents: integer("price_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  reason: text("reason"),
  questionnaire: jsonb("questionnaire"), // SEC-07: never logged or emailed
  questionnaireVersion: integer("questionnaire_version").notNull().default(1), // EXT-07
  source: sourceEnum("source").notNull().default("ONLINE"),
  staffNote: text("staff_note"),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  cancelledBy: text("cancelled_by"),
  rescheduledFromId: uuid("rescheduled_from_id"),
  rescheduleCount: integer("reschedule_count").notNull().default(0),
  manageTokenHash: text("manage_token_hash").notNull(),
  consultationId: uuid("consultation_id"), // EXT-02, Phase 2
  externalRef: text("external_ref"), // EXT-02, Phase 2
  createdAt: created(), updatedAt: updated(),
}, (t) => [
  uniqueIndex("appointments_ref_uq").on(t.bookingRef),
  index("appointments_start_idx").on(t.startAt),
  index("appointments_doctor_start_idx").on(t.doctorId, t.startAt),
  index("appointments_patient_idx").on(t.patientId),
  check("appointments_time_order", sql`${t.endAt} > ${t.startAt}`),
  check("appointments_money_nonneg", sql`${t.priceCents} >= 0 AND ${t.discountCents} >= 0 AND ${t.totalCents} >= 0`),
]);

/**
 * Single guard table for no-double-booking (fix to SRS BK-21).
 * One exclusion constraint (added in the custom SQL migration) covers holds AND
 * appointments together, and end_at includes the service buffer (BK-13).
 * Rows are written in the same transaction as the hold or appointment.
 * Expired HOLD rows are deleted before any new insert for that doctor.
 */
export const slotLocks = core.table("slot_locks", {
  id: id(),
  doctorId: uuid("doctor_id").notNull().references(() => doctors.id),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(), // appointment end + buffer
  kind: lockKindEnum("kind").notNull(),
  holdId: uuid("hold_id").references(() => slotHolds.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }), // HOLD only
  createdAt: created(),
}, (t) => [
  check("slot_locks_time_order", sql`${t.endAt} > ${t.startAt}`),
  check(
    "slot_locks_one_owner",
    sql`(${t.kind} = 'HOLD' AND ${t.holdId} IS NOT NULL AND ${t.appointmentId} IS NULL AND ${t.expiresAt} IS NOT NULL)
     OR (${t.kind} = 'APPOINTMENT' AND ${t.appointmentId} IS NOT NULL AND ${t.holdId} IS NULL)`,
  ),
  index("slot_locks_expiry_idx").on(t.expiresAt),
]);

export const payments = core.table("payments", {
  id: id(),
  appointmentId: uuid("appointment_id").notNull().references(() => appointments.id),
  provider: text("provider").notNull(), // STRIPE | CLINIC
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  amountCents: integer("amount_cents").notNull(),
  status: paymentStatusEnum("status").notNull().default("UNPAID"),
  method: paymentMethodEnum("method"),
  receiptNumber: text("receipt_number"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: created(), updatedAt: updated(),
}, (t) => [
  uniqueIndex("payments_pi_uq").on(t.stripePaymentIntentId),
  uniqueIndex("payments_receipt_uq").on(t.receiptNumber),
]);

export const refunds = core.table("refunds", {
  id: id(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  stripeRefundId: text("stripe_refund_id"),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason"),
  createdBy: uuid("created_by"),
  createdAt: created(),
});

export const discountCodes = core.table("discount_codes", {
  id: id(),
  code: text("code").notNull(),
  type: discountTypeEnum("type").notNull(),
  value: integer("value").notNull(), // percent (1-100) or cents
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validTo: timestamp("valid_to", { withTimezone: true }),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  serviceIds: uuid("service_ids").array(),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("discount_codes_code_uq").on(t.code)]);
