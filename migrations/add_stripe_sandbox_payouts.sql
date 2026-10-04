-- Sandbox preparation only. Never run against production without a separate release review.
ALTER TYPE rebate_payout_status ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE rebate_payout_status ADD VALUE IF NOT EXISTS 'SENT';
ALTER TYPE rebate_payout_status ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE rebate_payout_status ADD VALUE IF NOT EXISTS 'RETURNED';
CREATE TABLE IF NOT EXISTS rebate_payout_accounts (
 user_id varchar PRIMARY KEY REFERENCES users(id), stripe_recipient_id text NOT NULL UNIQUE,
 created_at timestamp DEFAULT NOW()
);
ALTER TABLE rebate_payout_requests
 ADD COLUMN IF NOT EXISTS request_key text UNIQUE,
 ADD COLUMN IF NOT EXISTS stripe_recipient_id text,
 ADD COLUMN IF NOT EXISTS stripe_payout_method_id text,
 ADD COLUMN IF NOT EXISTS stripe_payment_id text UNIQUE,
 ADD COLUMN IF NOT EXISTS stripe_status text,
 ADD COLUMN IF NOT EXISTS provider_receipt_url text,
 ADD COLUMN IF NOT EXISTS submit_started_at timestamp,
 ADD COLUMN IF NOT EXISTS posted_at timestamp,
 ADD COLUMN IF NOT EXISTS sandbox boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS receipt_email_status text;
-- Existing non-Stripe requests are historical/manual. Never automatically execute them.
UPDATE rebate_payout_requests SET sandbox = false WHERE method <> 'stripe_bank';
