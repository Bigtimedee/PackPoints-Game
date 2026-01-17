CREATE TYPE "public"."founders_pass_event_type" AS ENUM('ISSUED', 'LINK_VIEWED', 'REDEEM_ATTEMPT', 'REDEEM_SUCCESS', 'REDEEM_FAIL', 'DEACTIVATED_GLOBAL', 'DEACTIVATED_INDIVIDUAL');--> statement-breakpoint
CREATE TYPE "public"."founders_pass_status" AS ENUM('ACTIVE', 'CONSUMED', 'DEACTIVATED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."marketplace_source" AS ENUM('ebay', 'goldin');--> statement-breakpoint
CREATE TABLE "access_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" varchar(30) NOT NULL,
	"user_id" varchar,
	"email" varchar(255),
	"ip_address" varchar(45),
	"user_agent" text,
	"device_fingerprint" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "active_user_counter" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reserved_seats_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" varchar NOT NULL,
	"action" varchar(100) NOT NULL,
	"target_user_id" varchar,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"updated_by" varchar
);
--> statement-breakpoint
CREATE TABLE "baseball_cards" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_name" text NOT NULL,
	"team" text DEFAULT 'Unknown' NOT NULL,
	"position" text DEFAULT 'Unknown' NOT NULL,
	"year" integer DEFAULT 1987 NOT NULL,
	"set_name" text DEFAULT 'Topps' NOT NULL,
	"card_number" text NOT NULL,
	"image_url" text NOT NULL,
	"popularity" integer DEFAULT 50 NOT NULL,
	"image_verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_quotas" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"quota_date" varchar(10) NOT NULL,
	"mode" varchar(50) NOT NULL,
	"matches_started" integer DEFAULT 0 NOT NULL,
	"matches_completed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"user_id" varchar,
	"session_id" varchar(100),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "external_listings_snapshot" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "marketplace_source" NOT NULL,
	"query" text NOT NULL,
	"listing_count" integer NOT NULL,
	"min_price_cents" integer,
	"max_price_cents" integer,
	"captured_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"value" jsonb,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "feature_flags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "founders_pass" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"issued_to_user_id" varchar NOT NULL,
	"status" "founders_pass_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"consumed_at" timestamp,
	"consumed_by_user_id" varchar,
	"consumed_by_ip" varchar(45),
	"consumed_by_device_fingerprint" varchar(128),
	"deactivated_at" timestamp,
	CONSTRAINT "founders_pass_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "founders_pass_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pass_id" varchar NOT NULL,
	"event_type" "founders_pass_event_type" NOT NULL,
	"ip" varchar(45),
	"user_agent" text,
	"device_fingerprint" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "game_sets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport" text NOT NULL,
	"brand" text NOT NULL,
	"year" integer NOT NULL,
	"set_name" text NOT NULL,
	"league" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"marketplace_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "geo_rollups_daily" (
	"day" timestamp NOT NULL,
	"country" text NOT NULL,
	"region" text NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"new_users" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goldin_curated_listings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"image_url" text,
	"destination_url" text NOT NULL,
	"ends_at" timestamp,
	"price_display" text,
	"tags" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "identity_link_audit" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" varchar,
	"target_user_id" varchar,
	"provider" varchar(20) NOT NULL,
	"provider_user_id" varchar(255) NOT NULL,
	"action" varchar(30) NOT NULL,
	"reason" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"device_fingerprint" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"code" varchar(20) PRIMARY KEY NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"reserved_seat" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"created_by_admin_user_id" varchar,
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" varchar NOT NULL,
	"entry_type" varchar(20) NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb,
	"idempotency_key" varchar(64),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "lobbies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"join_code" varchar(6) NOT NULL,
	"host_id" varchar NOT NULL,
	"host_username" text NOT NULL,
	"host_secret" varchar(32) NOT NULL,
	"guest_id" varchar,
	"guest_username" text,
	"guest_secret" varchar(32),
	"status" text DEFAULT 'waiting' NOT NULL,
	"mode" text DEFAULT '1v1_friend' NOT NULL,
	"total_questions" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "lobbies_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "local_credentials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"password_hash" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketplace_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "marketplace_source" NOT NULL,
	"cache_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "marketplace_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "match_context_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"match_id" varchar,
	"game_set_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "match_participants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"username" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"correct_answers" integer DEFAULT 0 NOT NULL,
	"current_question_index" integer DEFAULT 0 NOT NULL,
	"is_connected" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"user_id" varchar NOT NULL,
	"mode" varchar(50) NOT NULL,
	"session_id" varchar,
	"signature" varchar(128) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"max_points" integer DEFAULT 0 NOT NULL,
	"points_awarded" integer,
	"multiplier" real DEFAULT 1 NOT NULL,
	"issued_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	CONSTRAINT "match_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lobby_id" varchar NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_question_index" integer DEFAULT 0 NOT NULL,
	"total_questions" integer NOT NULL,
	"questions_data" text NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "outbound_clicks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "marketplace_source" NOT NULL,
	"listing_id" text NOT NULL,
	"destination_url" text NOT NULL,
	"user_id" varchar,
	"session_id" text,
	"ip" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "packpts_bucket" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"original_amount" integer NOT NULL,
	"remaining_amount" integer NOT NULL,
	"earned_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_from_ledger_entry_id" varchar,
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "packpts_expiration_policy" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"earned_days_to_expire" integer DEFAULT 365 NOT NULL,
	"purchased_days_to_expire" integer,
	"bonus_default_days_to_expire" integer DEFAULT 90 NOT NULL,
	"inactivity_enabled" boolean DEFAULT false NOT NULL,
	"inactivity_days" integer DEFAULT 90 NOT NULL,
	"inactivity_min_age_days" integer DEFAULT 90 NOT NULL,
	"grace_period_days" integer DEFAULT 7 NOT NULL,
	"json_overrides" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "packpts_liability_snapshot" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of_date" varchar(10) NOT NULL,
	"total_outstanding" integer NOT NULL,
	"outstanding_earned" integer NOT NULL,
	"outstanding_purchased" integer NOT NULL,
	"outstanding_bonus" integer NOT NULL,
	"expiring_30d" integer NOT NULL,
	"expiring_60d" integer NOT NULL,
	"expiring_90d" integer NOT NULL,
	"aged_0_30" integer NOT NULL,
	"aged_31_90" integer NOT NULL,
	"aged_91_180" integer NOT NULL,
	"aged_181_365" integer NOT NULL,
	"aged_366_plus" integer NOT NULL,
	"breakage_estimate_pct" real DEFAULT 25 NOT NULL,
	"projected_breakage" integer NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "packpts_spend_allocation" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spend_ledger_entry_id" varchar NOT NULL,
	"bucket_id" varchar NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "pending_link_challenges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_user_id" varchar(255) NOT NULL,
	"email" varchar(255),
	"target_user_id" varchar,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"magic_link_token" varchar(128),
	"magic_link_expires_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "pending_link_challenges_magic_link_token_unique" UNIQUE("magic_link_token")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" varchar(20) NOT NULL,
	"packpts_grant" integer,
	"entitlement_key" varchar(100),
	"duration_days" integer,
	"price_usd" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "purchase_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(200) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"user_id" varchar,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"error_message" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "purchase_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "redemption_tiers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"packpts_required" integer NOT NULL,
	"usd_cap_cents" integer NOT NULL,
	"effective_rate_pct" integer DEFAULT 100 NOT NULL,
	"description" varchar(255) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reward_redemptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"packpts_spent" integer NOT NULL,
	"usd_value" integer NOT NULL,
	"type" varchar(50) DEFAULT 'store_credit' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"credit_token" varchar(64),
	"ledger_idempotency_key" varchar(64),
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"reversal_reason" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "reward_redemptions_credit_token_unique" UNIQUE("credit_token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streak_claim_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"local_date" varchar(10) NOT NULL,
	"streak_day" integer NOT NULL,
	"daily_reward" integer NOT NULL,
	"milestone_bonus" integer DEFAULT 0 NOT NULL,
	"total_awarded" integer NOT NULL,
	"idempotency_key" varchar(64) NOT NULL,
	"match_id" varchar,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "streak_claim_log_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "streak_reward_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_until" timestamp,
	"json_schedule" jsonb NOT NULL,
	"daily_cap" integer DEFAULT 250 NOT NULL,
	"milestone_bonuses" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "streak_state" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"current_days" integer DEFAULT 0 NOT NULL,
	"longest_days" integer DEFAULT 0 NOT NULL,
	"last_active_local_date" varchar(10),
	"last_claim_local_date" varchar(10),
	"timezone" varchar(64) DEFAULT 'America/Chicago' NOT NULL,
	"freezes_available" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "streak_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_checkout_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"sku" varchar(100) NOT NULL,
	"stripe_session_id" varchar(200) NOT NULL,
	"status" varchar(20) DEFAULT 'CREATED' NOT NULL,
	"packpts_grant" integer,
	"amount_cents" integer,
	"currency" varchar(10) DEFAULT 'usd',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "stripe_checkout_sessions_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_customers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"stripe_customer_id" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "stripe_customers_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "stripe_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "subscription_products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"packpts_grant" integer NOT NULL,
	"price_usd" integer NOT NULL,
	"billing_interval" varchar(20) DEFAULT 'month' NOT NULL,
	"stripe_price_id" varchar(100),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_best_value" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_active_sets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"game_set_id" varchar NOT NULL,
	"last_used_at" timestamp DEFAULT now(),
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_entitlements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"entitlement_key" varchar(100) NOT NULL,
	"expires_at" timestamp,
	"source" varchar(50) NOT NULL,
	"source_reference" varchar(200),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_geo_profile" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"home_country" text,
	"home_region" text,
	"confidence" integer DEFAULT 0 NOT NULL,
	"basis" jsonb,
	"last_computed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_geo_session" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"session_id" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"timezone" text,
	"country" text,
	"region" text,
	"asn" text,
	"carrier_name" text,
	"is_vpn" boolean,
	"source" varchar(10) DEFAULT 'http' NOT NULL,
	"geo_confidence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_user_id" varchar(255) NOT NULL,
	"email" varchar(255),
	"email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar,
	"email" varchar,
	"email_normalized" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"points" integer DEFAULT 0 NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"correct_answers" integer DEFAULT 0 NOT NULL,
	"total_answers" integer DEFAULT 0 NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"workos_user_id" varchar,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"activated_at" timestamp,
	"waitlist_joined_at" timestamp,
	"device_fingerprint" varchar(128),
	"last_signup_ip" varchar(45),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_workos_user_id_unique" UNIQUE("workos_user_id")
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_normalized" varchar(255) NOT NULL,
	"name" varchar(255),
	"status" varchar(20) DEFAULT 'WAITING' NOT NULL,
	"position" integer NOT NULL,
	"referral_code" varchar(20),
	"referred_by_code" varchar(20),
	"referrals_count" integer DEFAULT 0 NOT NULL,
	"invite_code_sent" varchar(20),
	"invited_at" timestamp,
	"accepted_at" timestamp,
	"device_fingerprint" varchar(128),
	"signup_ip" varchar(45),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "waitlist_entries_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"lifetime_earned" integer DEFAULT 0 NOT NULL,
	"lifetime_spent" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "wallets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "access_audit_log" ADD CONSTRAINT "access_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_quotas" ADD CONSTRAINT "daily_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders_pass" ADD CONSTRAINT "founders_pass_issued_to_user_id_users_id_fk" FOREIGN KEY ("issued_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders_pass" ADD CONSTRAINT "founders_pass_consumed_by_user_id_users_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders_pass_events" ADD CONSTRAINT "founders_pass_events_pass_id_founders_pass_id_fk" FOREIGN KEY ("pass_id") REFERENCES "public"."founders_pass"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_link_audit" ADD CONSTRAINT "identity_link_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_link_audit" ADD CONSTRAINT "identity_link_audit_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_admin_user_id_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_context_log" ADD CONSTRAINT "match_context_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_context_log" ADD CONSTRAINT "match_context_log_game_set_id_game_sets_id_fk" FOREIGN KEY ("game_set_id") REFERENCES "public"."game_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_tokens" ADD CONSTRAINT "match_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_clicks" ADD CONSTRAINT "outbound_clicks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packpts_bucket" ADD CONSTRAINT "packpts_bucket_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packpts_bucket" ADD CONSTRAINT "packpts_bucket_created_from_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("created_from_ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packpts_spend_allocation" ADD CONSTRAINT "packpts_spend_allocation_spend_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("spend_ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packpts_spend_allocation" ADD CONSTRAINT "packpts_spend_allocation_bucket_id_packpts_bucket_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."packpts_bucket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_link_challenges" ADD CONSTRAINT "pending_link_challenges_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streak_claim_log" ADD CONSTRAINT "streak_claim_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streak_state" ADD CONSTRAINT "streak_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_checkout_sessions" ADD CONSTRAINT "stripe_checkout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_active_sets" ADD CONSTRAINT "user_active_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_active_sets" ADD CONSTRAINT "user_active_sets_game_set_id_game_sets_id_fk" FOREIGN KEY ("game_set_id") REFERENCES "public"."game_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_geo_profile" ADD CONSTRAINT "user_geo_profile_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_geo_session" ADD CONSTRAINT "user_geo_session_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_access_audit_action" ON "access_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_access_audit_user" ON "access_audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_access_audit_created" ON "access_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_access_audit_ip" ON "access_audit_log" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_admin" ON "admin_audit_log" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_target" ON "admin_audit_log" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_action" ON "admin_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_created" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_daily_quotas_user_date" ON "daily_quotas" USING btree ("user_id","quota_date");--> statement-breakpoint
CREATE INDEX "idx_daily_quotas_user_date_mode" ON "daily_quotas" USING btree ("user_id","quota_date","mode");--> statement-breakpoint
CREATE INDEX "idx_event_log_type" ON "event_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_event_log_user" ON "event_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_event_log_created" ON "event_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_event_log_type_created" ON "event_log" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_external_listings_source" ON "external_listings_snapshot" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_external_listings_captured" ON "external_listings_snapshot" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "idx_feature_flags_key" ON "feature_flags" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_founders_pass_issued_to" ON "founders_pass" USING btree ("issued_to_user_id");--> statement-breakpoint
CREATE INDEX "idx_founders_pass_status" ON "founders_pass" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_founders_pass_token_hash" ON "founders_pass" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_founders_pass_events_pass" ON "founders_pass_events" USING btree ("pass_id");--> statement-breakpoint
CREATE INDEX "idx_founders_pass_events_type" ON "founders_pass_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_founders_pass_events_created" ON "founders_pass_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_game_sets_active" ON "game_sets" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_game_sets_sport_year" ON "game_sets" USING btree ("sport","year");--> statement-breakpoint
CREATE INDEX "idx_geo_rollups_daily_pk" ON "geo_rollups_daily" USING btree ("day","country","region");--> statement-breakpoint
CREATE INDEX "idx_geo_rollups_daily_day" ON "geo_rollups_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "idx_goldin_curated_active" ON "goldin_curated_listings" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_goldin_curated_ends" ON "goldin_curated_listings" USING btree ("ends_at");--> statement-breakpoint
CREATE INDEX "idx_link_audit_actor" ON "identity_link_audit" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_link_audit_target" ON "identity_link_audit" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "idx_link_audit_provider" ON "identity_link_audit" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "idx_link_audit_action" ON "identity_link_audit" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_link_audit_created" ON "identity_link_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_invite_codes_expires" ON "invite_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_ledger_wallet" ON "ledger_entries" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_created" ON "ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ledger_idempotency" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_marketplace_cache_source_key" ON "marketplace_cache" USING btree ("source","cache_key");--> statement-breakpoint
CREATE INDEX "idx_marketplace_cache_expires" ON "marketplace_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_match_context_user_created" ON "match_context_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_match_context_game_set" ON "match_context_log" USING btree ("game_set_id");--> statement-breakpoint
CREATE INDEX "idx_match_tokens_token" ON "match_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_match_tokens_user" ON "match_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_match_tokens_user_issued" ON "match_tokens" USING btree ("user_id","issued_at");--> statement-breakpoint
CREATE INDEX "idx_match_tokens_status" ON "match_tokens" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_outbound_clicks_source" ON "outbound_clicks" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_outbound_clicks_user" ON "outbound_clicks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_outbound_clicks_created" ON "outbound_clicks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_bucket_user" ON "packpts_bucket" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_bucket_user_expires" ON "packpts_bucket" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_bucket_user_status" ON "packpts_bucket" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_bucket_expires_status" ON "packpts_bucket" USING btree ("expires_at","status");--> statement-breakpoint
CREATE INDEX "idx_expiration_policy_effective" ON "packpts_expiration_policy" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "idx_expiration_policy_enabled" ON "packpts_expiration_policy" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_liability_snapshot_date" ON "packpts_liability_snapshot" USING btree ("as_of_date");--> statement-breakpoint
CREATE INDEX "idx_spend_allocation_ledger" ON "packpts_spend_allocation" USING btree ("spend_ledger_entry_id");--> statement-breakpoint
CREATE INDEX "idx_spend_allocation_bucket" ON "packpts_spend_allocation" USING btree ("bucket_id");--> statement-breakpoint
CREATE INDEX "idx_pending_link_session" ON "pending_link_challenges" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_pending_link_provider" ON "pending_link_challenges" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "idx_pending_link_status" ON "pending_link_challenges" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pending_link_magic_token" ON "pending_link_challenges" USING btree ("magic_link_token");--> statement-breakpoint
CREATE INDEX "idx_products_sku" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "idx_products_active" ON "products" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_purchase_events_event_id" ON "purchase_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_purchase_events_user" ON "purchase_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_purchase_events_status" ON "purchase_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_purchase_events_created" ON "purchase_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_redemption_tiers_active" ON "redemption_tiers" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_redemption_tiers_sort" ON "redemption_tiers" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "idx_redemptions_user" ON "reward_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_redemptions_status" ON "reward_redemptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_redemptions_credit_token" ON "reward_redemptions" USING btree ("credit_token");--> statement-breakpoint
CREATE INDEX "idx_redemptions_created" ON "reward_redemptions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_streak_claim_log_user" ON "streak_claim_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_streak_claim_log_user_date" ON "streak_claim_log" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "idx_streak_claim_log_idempotency" ON "streak_claim_log" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_streak_claim_log_created" ON "streak_claim_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_streak_reward_config_effective" ON "streak_reward_config" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "idx_streak_reward_config_enabled" ON "streak_reward_config" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_streak_state_user" ON "streak_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_streak_state_last_active" ON "streak_state" USING btree ("last_active_local_date");--> statement-breakpoint
CREATE INDEX "idx_checkout_sessions_user" ON "stripe_checkout_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_checkout_sessions_stripe" ON "stripe_checkout_sessions" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "idx_checkout_sessions_status" ON "stripe_checkout_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_stripe_customers_user" ON "stripe_customers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_stripe_customers_stripe" ON "stripe_customers" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "idx_subscription_products_active" ON "subscription_products" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_subscription_products_sort" ON "subscription_products" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "idx_user_active_sets_user" ON "user_active_sets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_active_sets_game_set" ON "user_active_sets" USING btree ("game_set_id");--> statement-breakpoint
CREATE INDEX "idx_entitlements_user" ON "user_entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_entitlements_key" ON "user_entitlements" USING btree ("entitlement_key");--> statement-breakpoint
CREATE INDEX "idx_entitlements_expires" ON "user_entitlements" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_user_geo_session_user_last_seen" ON "user_geo_session" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_user_geo_session_country_region" ON "user_geo_session" USING btree ("country","region");--> statement-breakpoint
CREATE INDEX "idx_user_geo_session_session_id" ON "user_geo_session" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_user_identities_user" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_identities_provider_id" ON "user_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "idx_user_identities_email" ON "user_identities" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_users_email_normalized" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "idx_waitlist_email_normalized" ON "waitlist_entries" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "idx_waitlist_status" ON "waitlist_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_waitlist_position" ON "waitlist_entries" USING btree ("position");--> statement-breakpoint
CREATE INDEX "idx_waitlist_referral_code" ON "waitlist_entries" USING btree ("referral_code");