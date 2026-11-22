-- Custom SQL: no-double-booking guard (fix to SRS BK-21) and Phase 2 reserved schema.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- One constraint covers holds AND appointments for the same doctor; end_at already includes the buffer.
ALTER TABLE "core"."slot_locks"
  ADD CONSTRAINT "slot_locks_no_overlap"
  EXCLUDE USING gist ("doctor_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&);
--> statement-breakpoint
-- EXT / SRS 5.2: reserved for Phase 2. Intentionally empty in Phase 1.
CREATE SCHEMA IF NOT EXISTS "clinical";
