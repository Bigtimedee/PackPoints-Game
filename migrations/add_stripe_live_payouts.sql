-- Apply add_stripe_sandbox_payouts.sql first. Additive, no money movement.
-- Existing recipients and Stripe requests stay test-only. NULL financial accounts
-- deliberately block old rows until reviewed. Never relabel them live.
BEGIN;
ALTER TABLE rebate_payout_accounts
 ADD COLUMN IF NOT EXISTS sandbox boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS financial_account_id text;
ALTER TABLE rebate_payout_accounts DROP CONSTRAINT IF EXISTS rebate_payout_accounts_pkey;
ALTER TABLE rebate_payout_accounts ADD PRIMARY KEY (user_id, sandbox);
ALTER TABLE rebate_payout_requests ADD COLUMN IF NOT EXISTS financial_account_id text;
COMMIT;
