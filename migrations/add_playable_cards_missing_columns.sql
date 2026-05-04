-- Add columns that exist in the Drizzle schema but were never migrated to production.
-- Safe to run multiple times (IF NOT EXISTS guards).

ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "quarantine_status" varchar(30) NOT NULL DEFAULT 'OK';
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "last_image_check" timestamp;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "image_failure_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "image_last_error" text;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "content_verified" boolean;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "content_verified_at" timestamp;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "proposed_unplayable" boolean NOT NULL DEFAULT false;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "validation_fail_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "last_validation_reason" text;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "last_validation_http_status" integer;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "last_validation_content_type" text;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "last_validation_checked_at" timestamp;
ALTER TABLE "playable_cards" ADD COLUMN IF NOT EXISTS "first_validation_fail_at" timestamp;

-- Indexes for the new queryable columns
CREATE INDEX IF NOT EXISTS "idx_playable_cards_last_check" ON "playable_cards"("last_image_check");
CREATE INDEX IF NOT EXISTS "idx_playable_cards_content_verified" ON "playable_cards"("content_verified");
CREATE INDEX IF NOT EXISTS "idx_playable_cards_quarantine" ON "playable_cards"("quarantine_status");
CREATE INDEX IF NOT EXISTS "idx_playable_cards_proposed_unplayable" ON "playable_cards"("proposed_unplayable");
