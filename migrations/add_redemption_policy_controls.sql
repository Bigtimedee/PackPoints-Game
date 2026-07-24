-- Meaningful-discount + solvency controls on profit_policy (July 2026).
-- Backfills the single active policy row with safe defaults.
ALTER TABLE profit_policy
  ADD COLUMN IF NOT EXISTS max_discount_pct REAL NOT NULL DEFAULT 0.15,
  ADD COLUMN IF NOT EXISTS per_user_daily_credit_cents INTEGER NOT NULL DEFAULT 2500,
  ADD COLUMN IF NOT EXISTS per_user_weekly_credit_cents INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS min_redemption_packpts INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS reserve_floor_cents INTEGER NOT NULL DEFAULT 0;
