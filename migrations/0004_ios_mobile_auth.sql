-- Migration: iOS Mobile Auth support
-- Adds refresh_tokens, apple_users, apns_tokens, and apple_transactions tables

-- JWT refresh tokens (issued to iOS clients, rotated on use)
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" varchar(256) NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "device_hint" varchar(256),
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user" ON "refresh_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_token" ON "refresh_tokens" ("token");

--> statement-breakpoint

-- Apple Sign In identity mapping
CREATE TABLE IF NOT EXISTS "apple_users" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "apple_user_id" varchar(256) NOT NULL UNIQUE,
  "email" varchar(256),
  "created_at" timestamp DEFAULT now()
);

--> statement-breakpoint

-- APNs device tokens for push notifications
CREATE TABLE IF NOT EXISTS "apns_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" varchar(256) NOT NULL,
  "environment" varchar(20) NOT NULL DEFAULT 'production',
  "updated_at" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_apns_tokens_user" ON "apns_tokens" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_apns_token" ON "apns_tokens" ("token");

--> statement-breakpoint

-- Apple IAP transaction records
CREATE TABLE IF NOT EXISTS "apple_transactions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "transaction_id" varchar(256) NOT NULL UNIQUE,
  "original_transaction_id" varchar(256),
  "product_id" varchar(256) NOT NULL,
  "purchase_type" varchar(50) NOT NULL,
  "environment" varchar(20) NOT NULL DEFAULT 'production',
  "raw_receipt" text,
  "verified_at" timestamp DEFAULT now(),
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_apple_tx_user" ON "apple_transactions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_apple_tx_product" ON "apple_transactions" ("product_id");
