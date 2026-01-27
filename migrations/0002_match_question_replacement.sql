-- Add columns for card replacement tracking to match_questions
ALTER TABLE "match_questions" ADD COLUMN IF NOT EXISTS "seed_version" integer NOT NULL DEFAULT 1;
ALTER TABLE "match_questions" ADD COLUMN IF NOT EXISTS "replaced_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "match_questions" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp DEFAULT now();

-- Add unique constraint on (match_id, idx) if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'match_questions_match_idx_unique'
  ) THEN
    ALTER TABLE "match_questions" ADD CONSTRAINT "match_questions_match_idx_unique" UNIQUE ("match_id", "idx");
  END IF;
END $$;

-- Create table to track used cards per match (prevents duplicate card assignments)
CREATE TABLE IF NOT EXISTS "match_used_cards" (
  "match_id" varchar NOT NULL,
  "card_id" varchar NOT NULL,
  "added_at" timestamp DEFAULT now(),
  PRIMARY KEY ("match_id", "card_id")
);
