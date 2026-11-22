CREATE TABLE "ops"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "ops"."users" ALTER COLUMN "failed_logins" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ops"."users" ALTER COLUMN "failed_logins" SET DATA TYPE integer USING "failed_logins"::integer;--> statement-breakpoint
ALTER TABLE "ops"."users" ALTER COLUMN "failed_logins" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ops"."users" ADD COLUMN "totp_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."users" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "ops"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "ops"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "ops"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "ops"."sessions" USING btree ("user_id");