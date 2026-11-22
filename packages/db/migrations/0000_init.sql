CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "cms";
--> statement-breakpoint
CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TYPE "core"."appointment_status" AS ENUM('PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED_BY_PATIENT', 'CANCELLED_BY_CLINIC', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "core"."discount_type" AS ENUM('PERCENT', 'FIXED');--> statement-breakpoint
CREATE TYPE "core"."lock_kind" AS ENUM('HOLD', 'APPOINTMENT');--> statement-breakpoint
CREATE TYPE "core"."mode" AS ENUM('IN_CLINIC', 'VIDEO', 'PHONE');--> statement-breakpoint
CREATE TYPE "core"."payment_choice" AS ENUM('ONLINE', 'AT_CLINIC', 'FREE');--> statement-breakpoint
CREATE TYPE "core"."payment_method" AS ENUM('CARD', 'APPLE_PAY', 'GOOGLE_PAY', 'CASH', 'TERMINAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "core"."payment_status" AS ENUM('UNPAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "core"."question_type" AS ENUM('SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'DATE', 'NUMBER');--> statement-breakpoint
CREATE TYPE "core"."booking_source" AS ENUM('ONLINE', 'WALK_IN', 'PHONE', 'STAFF');--> statement-breakpoint
CREATE TYPE "ops"."role" AS ENUM('ADMIN', 'RECEPTIONIST', 'DOCTOR');--> statement-breakpoint
CREATE TABLE "core"."appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_ref" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"mode" "core"."mode" DEFAULT 'IN_CLINIC' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "core"."appointment_status" DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"payment_status" "core"."payment_status" DEFAULT 'UNPAID' NOT NULL,
	"payment_choice" "core"."payment_choice" NOT NULL,
	"price_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"reason" text,
	"questionnaire" jsonb,
	"questionnaire_version" integer DEFAULT 1 NOT NULL,
	"source" "core"."booking_source" DEFAULT 'ONLINE' NOT NULL,
	"staff_note" text,
	"checked_in_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" text,
	"rescheduled_from_id" uuid,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"manage_token_hash" text NOT NULL,
	"consultation_id" uuid,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_time_order" CHECK ("core"."appointments"."end_at" > "core"."appointments"."start_at"),
	CONSTRAINT "appointments_money_nonneg" CHECK ("core"."appointments"."price_cents" >= 0 AND "core"."appointments"."discount_cents" >= 0 AND "core"."appointments"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core"."availability_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"is_closed" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "core"."availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"modes" text[] DEFAULT ARRAY['IN_CLINIC']::text[] NOT NULL,
	"valid_from" date,
	"valid_to" date,
	CONSTRAINT "availability_weekday_range" CHECK ("core"."availability_rules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "availability_times_order" CHECK ("core"."availability_rules"."end_time" > "core"."availability_rules"."start_time"),
	CONSTRAINT "availability_modes_valid" CHECK ("core"."availability_rules"."modes" <@ ARRAY['IN_CLINIC','VIDEO','PHONE']::text[])
);
--> statement-breakpoint
CREATE TABLE "core"."clinic_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"type" "core"."discount_type" NOT NULL,
	"value" integer NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"service_ids" uuid[],
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."doctors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"bio" text,
	"photo_url" text,
	"qualifications" text,
	"imc_number" text,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"dob" date NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"eircode" text,
	"medical_card" boolean DEFAULT false NOT NULL,
	"guardian_name" text,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"merged_into_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"stripe_payment_intent_id" text,
	"amount_cents" integer NOT NULL,
	"status" "core"."payment_status" DEFAULT 'UNPAID' NOT NULL,
	"method" "core"."payment_method",
	"receipt_number" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"stripe_refund_id" text,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."service_doctors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."service_faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."service_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"label" text NOT NULL,
	"type" "core"."question_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb,
	"help_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"short_description" text,
	"description" text,
	"price_cents" integer NOT NULL,
	"duration_min" integer NOT NULL,
	"buffer_min" integer DEFAULT 0 NOT NULL,
	"modes" text[] DEFAULT ARRAY['IN_CLINIC']::text[] NOT NULL,
	"pay_at_clinic_allowed" boolean DEFAULT true NOT NULL,
	"gms_eligible" boolean DEFAULT false NOT NULL,
	"min_notice_override_min" integer,
	"featured" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_price_nonneg" CHECK ("core"."services"."price_cents" >= 0),
	CONSTRAINT "services_duration_pos" CHECK ("core"."services"."duration_min" > 0),
	CONSTRAINT "services_modes_valid" CHECK ("core"."services"."modes" <@ ARRAY['IN_CLINIC','VIDEO','PHONE']::text[])
);
--> statement-breakpoint
CREATE TABLE "core"."slot_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"mode" "core"."mode" DEFAULT 'IN_CLINIC' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."slot_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"kind" "core"."lock_kind" NOT NULL,
	"hold_id" uuid,
	"appointment_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_locks_time_order" CHECK ("core"."slot_locks"."end_at" > "core"."slot_locks"."start_at"),
	CONSTRAINT "slot_locks_one_owner" CHECK (("core"."slot_locks"."kind" = 'HOLD' AND "core"."slot_locks"."hold_id" IS NOT NULL AND "core"."slot_locks"."appointment_id" IS NULL AND "core"."slot_locks"."expires_at" IS NOT NULL)
     OR ("core"."slot_locks"."kind" = 'APPOINTMENT' AND "core"."slot_locks"."appointment_id" IS NOT NULL AND "core"."slot_locks"."hold_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "core"."time_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text,
	"recurrence_rule" text
);
--> statement-breakpoint
CREATE TABLE "cms"."announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms"."faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms"."media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"data" text NOT NULL,
	"alt" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms"."pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms"."reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_name" text NOT NULL,
	"rating" integer NOT NULL,
	"text" text NOT NULL,
	"review_date" date,
	"source" text DEFAULT 'google' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"changes" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"type" text NOT NULL,
	"document_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "ops"."data_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ops"."enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"message" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"notes" text,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."notifications_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid,
	"type" text NOT NULL,
	"channel" text DEFAULT 'EMAIL' NOT NULL,
	"recipient" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_id" text,
	"status" text DEFAULT 'SENT' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "ops"."role" NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text,
	"failed_logins" text DEFAULT '0' NOT NULL,
	"locked_until" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "core"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."appointments" ADD CONSTRAINT "appointments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "core"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "core"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."availability_overrides" ADD CONSTRAINT "availability_overrides_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "core"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."availability_rules" ADD CONSTRAINT "availability_rules_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "core"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."payments" ADD CONSTRAINT "payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "core"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "core"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."service_doctors" ADD CONSTRAINT "service_doctors_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "core"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."service_doctors" ADD CONSTRAINT "service_doctors_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "core"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."service_faqs" ADD CONSTRAINT "service_faqs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "core"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."service_questions" ADD CONSTRAINT "service_questions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "core"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."slot_holds" ADD CONSTRAINT "slot_holds_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "core"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."slot_holds" ADD CONSTRAINT "slot_holds_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "core"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."slot_locks" ADD CONSTRAINT "slot_locks_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "core"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."slot_locks" ADD CONSTRAINT "slot_locks_hold_id_slot_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "core"."slot_holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."slot_locks" ADD CONSTRAINT "slot_locks_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "core"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."time_blocks" ADD CONSTRAINT "time_blocks_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "core"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_ref_uq" ON "core"."appointments" USING btree ("booking_ref");--> statement-breakpoint
CREATE INDEX "appointments_start_idx" ON "core"."appointments" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "appointments_doctor_start_idx" ON "core"."appointments" USING btree ("doctor_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_idx" ON "core"."appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_holidays_date_uq" ON "core"."clinic_holidays" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_codes_code_uq" ON "core"."discount_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "patients_email_idx" ON "core"."patients" USING btree ("email");--> statement-breakpoint
CREATE INDEX "patients_name_idx" ON "core"."patients" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_pi_uq" ON "core"."payments" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_receipt_uq" ON "core"."payments" USING btree ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "service_doctors_uq" ON "core"."service_doctors" USING btree ("service_id","doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_slug_uq" ON "core"."services" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "slot_holds_expiry_idx" ON "core"."slot_holds" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "slot_locks_expiry_idx" ON "core"."slot_locks" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_key_uq" ON "cms"."media" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_key_version_uq" ON "cms"."pages" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "ops"."audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "domain_events_unprocessed_idx" ON "ops"."domain_events" USING btree ("processed_at","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once_uq" ON "ops"."notifications_sent" USING btree ("appointment_id","type","channel","recipient");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "ops"."users" USING btree ("email");