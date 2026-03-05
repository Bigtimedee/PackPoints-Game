-- Add factual accuracy guardrail fields to growth_content_items
-- Run on Railway: railway run npx drizzle-kit push
-- Or apply directly: psql $DATABASE_URL -f migrations/add_fact_check_fields.sql

-- New status: PENDING_REVIEW
-- Items blocked by the fact-checker (Layer 1/2) or restricted claim detector
-- (Layer 3) land here instead of READY. A human must approve or reject them
-- via the review queue API before they can be published.
COMMENT ON COLUMN growth_content_items.status IS
  'QUEUED | READY | POSTED | FAILED | PENDING_REVIEW';

-- fact_check_result: stores the full FactCheckResult JSON
-- { verdict, claims, overallExplanation, restrictedClaimsFound, checkedAt }
ALTER TABLE growth_content_items
  ADD COLUMN IF NOT EXISTS fact_check_result JSONB;

COMMENT ON COLUMN growth_content_items.fact_check_result IS
  'JSON result from factChecker.ts: { verdict, claims, overallExplanation, restrictedClaimsFound, checkedAt }';

-- Index to make the review queue query fast
CREATE INDEX IF NOT EXISTS idx_growth_content_items_pending_review
  ON growth_content_items(status, created_at DESC)
  WHERE status = 'PENDING_REVIEW';
