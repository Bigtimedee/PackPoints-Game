CREATE TYPE "public"."auth_event_type" AS ENUM('LOGIN_SUCCESS', 'LOGIN_FAIL', 'SIGNUP', 'LOGOUT', 'PASSWORD_RESET', 'OAUTH_LINK', 'SESSION_CREATED');--> statement-breakpoint
CREATE TYPE "public"."award_reason" AS ENUM('QUIZ_CORRECT', 'STREAK_BONUS', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."card_set_sport" AS ENUM('Baseball', 'Basketball', 'Football', 'Hockey');--> statement-breakpoint
CREATE TYPE "public"."device_event_type" AS ENUM('DEVICE_SEEN', 'COOKIE_RESET', 'STORAGE_RESET');--> statement-breakpoint
CREATE TYPE "public"."gameplay_event_type" AS ENUM('QUESTION_SHOWN', 'ANSWER_SUBMITTED', 'MATCH_END');--> statement-breakpoint
CREATE TYPE "public"."margin_source_type" AS ENUM('PACKPTS_SALE', 'AFFILIATE_PAYOUT', 'PARTNER_REBATE', 'MANUAL_ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."matchmaking_mode" AS ENUM('1vRandom');--> statement-breakpoint
CREATE TYPE "public"."package_validation_decision" AS ENUM('PASS', 'WARN', 'BLOCK', 'OVERRIDE');--> statement-breakpoint
CREATE TYPE "public"."payment_event_type" AS ENUM('CHECKOUT_CREATED', 'PAID', 'SETTLED', 'REFUNDED', 'DISPUTE_OPENED', 'DISPUTE_WON', 'DISPUTE_LOST', 'PAYMENT_FAILED');--> statement-breakpoint
CREATE TYPE "public"."presence_status" AS ENUM('ONLINE', 'OFFLINE', 'IN_MATCH', 'SEARCHING');--> statement-breakpoint
CREATE TYPE "public"."purchase_intent_status" AS ENUM('CREATED', 'APPROVED', 'DENIED', 'PURCHASE_CONFIRMED', 'CREDIT_GRANTED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."pvp_match_status" AS ENUM('CREATED', 'ACTIVE', 'FINISHED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."rarity_type" AS ENUM('base', 'insert', 'parallel', 'sp');--> statement-breakpoint
CREATE TYPE "public"."redemption_credit_status" AS ENUM('PENDING', 'GRANTED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."redemption_event_type" AS ENUM('QUOTE', 'APPLY', 'RESERVE', 'RELEASE', 'CONSUME', 'CANCEL', 'CONFIRM');--> statement-breakpoint
CREATE TYPE "public"."redemption_source" AS ENUM('ebay', 'goldin');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('ACTIVE', 'RELEASED', 'CONSUMED');--> statement-breakpoint
CREATE TYPE "public"."risk_action_type" AS ENUM('THROTTLE', 'REDUCE_REWARDS', 'CAP_LOWER', 'CAPTCHA', 'FREEZE');--> statement-breakpoint
CREATE TYPE "public"."risk_job_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."risk_job_type" AS ENUM('ROLLUP_24H', 'COMPUTE_SIGNALS', 'UPDATE_SNAPSHOT');--> statement-breakpoint
CREATE TYPE "public"."risk_signal_type" AS ENUM('REPEAT_PAIRING', 'WIN_TRADING', 'FAST_RESPONSES', 'HIGH_VOLUME', 'MULTI_ACCOUNT');--> statement-breakpoint
CREATE TYPE "public"."risk_tier" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."sales_channel" AS ENUM('web_stripe', 'ios_iap', 'android_iap');--> statement-breakpoint
CREATE TYPE "public"."set_import_job_log_level" AS ENUM('INFO', 'WARN', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."set_import_job_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "public"."store_purchase_status" AS ENUM('CREATED', 'PAID_PENDING', 'SETTLED', 'REFUNDED', 'CHARGEBACK');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('WAITING', 'MATCHED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."user_risk_status" AS ENUM('NORMAL', 'FROZEN');--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"event_type" "auth_event_type" NOT NULL,
	"session_id" text,
	"device_id" text,
	"ip_hash" text,
	"ip_country" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "card_details_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" varchar NOT NULL,
	"raw_images_only" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_image_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" varchar NOT NULL,
	"reporter_id" varchar,
	"session_id" varchar,
	"reason" varchar(30) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"resolved_by" varchar,
	"resolved_at" timestamp,
	"resolution" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "card_set_cards" (
	"set_id" varchar NOT NULL,
	"card_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "card_sets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport" "card_set_sport" NOT NULL,
	"year" integer NOT NULL,
	"brand" text,
	"set_name" text NOT NULL,
	"provider_preference" text DEFAULT 'cardhedge' NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"expected_card_count" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cardhedge_import_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_set_id" varchar NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"finished_at" timestamp,
	"page_size" integer DEFAULT 100 NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"cards_imported" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "cardhedge_search_cache" (
	"cache_key" varchar PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_cards" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_card_id" text NOT NULL,
	"sport" "card_set_sport",
	"year" integer,
	"brand" text,
	"set_name" text,
	"card_number" text,
	"variant" text,
	"player" text,
	"description" text,
	"image_url" text,
	"category_raw" text,
	"set_raw" text,
	"raw" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "device_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"device_id" text NOT NULL,
	"fingerprint_version" text,
	"ip_hash" text,
	"ip_country" text,
	"event_type" "device_event_type" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "device_rollup_24h" (
	"device_id" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"distinct_user_count" integer DEFAULT 0,
	"purchase_count" integer DEFAULT 0,
	"purchase_amount_cents" integer DEFAULT 0,
	"signup_count" integer DEFAULT 0,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "device_rollup_24h_pk" UNIQUE("device_id","window_start")
);
--> statement-breakpoint
CREATE TABLE "external_purchase_intent" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"source" "marketplace_source" NOT NULL,
	"listing_id" text NOT NULL,
	"listing_url" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"computed_rmax" integer DEFAULT 0 NOT NULL,
	"requested_redeem_packpts" integer DEFAULT 0 NOT NULL,
	"approved_redeem_packpts" integer DEFAULT 0 NOT NULL,
	"status" "purchase_intent_status" DEFAULT 'CREATED' NOT NULL,
	"calc_snapshot" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fraud_signals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"signal_type" text NOT NULL,
	"severity" integer NOT NULL,
	"window" text DEFAULT '24h' NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gameplay_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"opponent_id" varchar,
	"event_type" "gameplay_event_type" NOT NULL,
	"card_id" varchar,
	"answer_correct" boolean,
	"response_time_ms" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "internal_player_stats" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "internal_player_stats_player_key_unique" UNIQUE("player_key")
);
--> statement-breakpoint
CREATE TABLE "ip_rollup_24h" (
	"ip_hash" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"distinct_user_count" integer DEFAULT 0,
	"purchase_count" integer DEFAULT 0,
	"purchase_amount_cents" integer DEFAULT 0,
	"signup_count" integer DEFAULT 0,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ip_rollup_24h_pk" UNIQUE("ip_hash","window_start")
);
--> statement-breakpoint
CREATE TABLE "margin_ledger" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "margin_source_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"reference_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "margin_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"redemption_id" varchar NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketplace_margin_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "marketplace_source" NOT NULL,
	"affiliate_rate" real DEFAULT 0.02 NOT NULL,
	"haircut" real DEFAULT 0.5 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "marketplace_margin_config_source_unique" UNIQUE("source")
);
--> statement-breakpoint
CREATE TABLE "match_points_counters" (
	"match_id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "matchmaking_tickets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"mode" "matchmaking_mode" NOT NULL,
	"bucket" varchar NOT NULL,
	"status" "ticket_status" DEFAULT 'WAITING' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"purchase_id" varchar,
	"stripe_event_id" text,
	"event_type" "payment_event_type" NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd',
	"payment_method_fingerprint" text,
	"ip_hash" text,
	"ip_country" text,
	"device_id" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "payment_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "playable_cards" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_set_id" varchar NOT NULL,
	"cardhedge_card_id" text NOT NULL,
	"description" text,
	"player" text,
	"set" text,
	"number" text,
	"variant" text,
	"image_url" text,
	"category" text,
	"rookie" boolean,
	"raw_images_only" boolean DEFAULT false NOT NULL,
	"is_playable" boolean DEFAULT true NOT NULL,
	"blocked_reason" text,
	"image_review_status" varchar(20) DEFAULT 'unreviewed' NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"image_rotation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "playable_cards_cardhedge_card_id_unique" UNIQUE("cardhedge_card_id")
);
--> statement-breakpoint
CREATE TABLE "player_fame" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport" varchar(20) DEFAULT 'baseball' NOT NULL,
	"player_name" text NOT NULL,
	"player_key" text NOT NULL,
	"fame_score" real DEFAULT 0.5 NOT NULL,
	"source_breakdown" jsonb DEFAULT '{}'::jsonb,
	"last_updated" timestamp DEFAULT now(),
	CONSTRAINT "player_fame_player_key_unique" UNIQUE("player_key")
);
--> statement-breakpoint
CREATE TABLE "points_awards" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"match_id" varchar,
	"card_id" varchar,
	"player_key" text,
	"fame_score" real,
	"base_pts" integer NOT NULL,
	"vintage_multiplier" real DEFAULT 1 NOT NULL,
	"rarity_multiplier" real DEFAULT 1 NOT NULL,
	"final_pts" integer NOT NULL,
	"policy_id" varchar,
	"reason" "award_reason" DEFAULT 'QUIZ_CORRECT' NOT NULL,
	"idempotency_key" varchar,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "points_awards_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "profit_policy" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"min_margin_m" real DEFAULT 0.25 NOT NULL,
	"affiliate_rate_a" real DEFAULT 0.02 NOT NULL,
	"affiliate_haircut_h" real DEFAULT 0.7 NOT NULL,
	"processing_fee_rate_r" real DEFAULT 0 NOT NULL,
	"fixed_fee_f_cents" integer DEFAULT 0 NOT NULL,
	"packpts_value_v_microusd" integer DEFAULT 2000 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pvp_matches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" "matchmaking_mode" NOT NULL,
	"bucket" varchar NOT NULL,
	"player1_id" varchar NOT NULL,
	"player2_id" varchar NOT NULL,
	"player1_ticket_id" varchar,
	"player2_ticket_id" varchar,
	"status" "pvp_match_status" DEFAULT 'CREATED' NOT NULL,
	"winner_id" varchar,
	"player1_score" integer DEFAULT 0,
	"player2_score" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "redemption_credit" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_intent_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"packpts_spent" integer NOT NULL,
	"credit_cents" integer NOT NULL,
	"status" "redemption_credit_status" DEFAULT 'PENDING' NOT NULL,
	"ledger_spend_entry_id" varchar,
	"ledger_credit_entry_id" varchar,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "redemption_credit_purchase_intent_unique" UNIQUE("purchase_intent_id")
);
--> statement-breakpoint
CREATE TABLE "redemption_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"purchase_intent_id" varchar,
	"source" "redemption_source",
	"event_type" "redemption_event_type" NOT NULL,
	"price_cents" integer,
	"pts_requested" integer,
	"pts_approved" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "redemption_reservations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_intent_id" varchar NOT NULL,
	"reserved_cents" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "redemption_reservations_intent_unique" UNIQUE("purchase_intent_id")
);
--> statement-breakpoint
CREATE TABLE "reward_policy" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"min_pts" integer DEFAULT 100 NOT NULL,
	"max_pts" integer DEFAULT 200 NOT NULL,
	"gamma" real DEFAULT 2 NOT NULL,
	"max_award_cap" integer DEFAULT 250 NOT NULL,
	"vintage_multipliers" jsonb DEFAULT '{"pre1980":1.15,"1980_1999":1.05,"2000_2019":1,"2020_plus":0.9}'::jsonb NOT NULL,
	"rarity_multipliers" jsonb DEFAULT '{"base":1,"insert":1.1,"parallel":1.2,"sp":1.3}'::jsonb NOT NULL,
	"daily_points_cap" integer DEFAULT 5000 NOT NULL,
	"per_match_points_cap" integer DEFAULT 1000 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "risk_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"action" "risk_action_type" NOT NULL,
	"reason" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "risk_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" "risk_job_type" NOT NULL,
	"user_id" varchar,
	"device_id" text,
	"ip_hash" text,
	"run_after" timestamp DEFAULT now(),
	"status" "risk_job_status" DEFAULT 'PENDING',
	"attempts" integer DEFAULT 0,
	"last_error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "risk_signals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"signal_type" "risk_signal_type" NOT NULL,
	"severity" integer DEFAULT 1 NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "risk_snapshots" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"tier_suggestion" "risk_tier" DEFAULT 'LOW',
	"score" integer DEFAULT 0,
	"flags" jsonb DEFAULT '{}'::jsonb,
	"top_reasons" text[] DEFAULT '{}',
	"last_purchase_at" timestamp,
	"last_redemption_apply_at" timestamp,
	"last_device_id" text,
	"last_ip_hash" text,
	"last_country" text
);
--> statement-breakpoint
CREATE TABLE "risk_suppressions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"signal_type" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "risk_suppressions_user_signal" UNIQUE("user_id","signal_type")
);
--> statement-breakpoint
CREATE TABLE "set_import_job_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"level" "set_import_job_log_level" NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "set_import_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" varchar NOT NULL,
	"provider" text NOT NULL,
	"status" "set_import_job_status" DEFAULT 'PENDING' NOT NULL,
	"total_pages" integer DEFAULT 0 NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"cards_found" integer DEFAULT 0 NOT NULL,
	"cards_inserted" integer DEFAULT 0 NOT NULL,
	"cards_linked" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "store_fee_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "sales_channel" NOT NULL,
	"fee_rate" real NOT NULL,
	"fee_fixed_cents" integer NOT NULL,
	"platform_fee_rate" real DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "store_fee_profiles_channel_unique" UNIQUE("channel")
);
--> statement-breakpoint
CREATE TABLE "store_package_policy" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"min_margin_rate" real DEFAULT 0.3 NOT NULL,
	"warn_margin_band" real DEFAULT 0.05 NOT NULL,
	"max_value_per_pt_microusd" integer DEFAULT 2000 NOT NULL,
	"allow_override" boolean DEFAULT false NOT NULL,
	"reserve_rate" real DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "store_package_validations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar,
	"policy_id" varchar NOT NULL,
	"fee_profile_id" varchar NOT NULL,
	"price_cents" integer NOT NULL,
	"pts_grant" integer NOT NULL,
	"channel" "sales_channel" NOT NULL,
	"total_fees_cents" integer NOT NULL,
	"net_revenue_cents" integer NOT NULL,
	"gross_margin_rate" real NOT NULL,
	"implied_value_per_pt_microusd" integer NOT NULL,
	"decision" "package_validation_decision" NOT NULL,
	"reasons" text[] NOT NULL,
	"admin_user_id" varchar,
	"override_note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "store_purchases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"status" "store_purchase_status" DEFAULT 'CREATED' NOT NULL,
	"pts_grant" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"product_sku" text,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "store_purchases_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "user_points_counters" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"date" varchar(10) NOT NULL,
	"points_awarded_today" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_presence" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"socket_id" varchar,
	"status" "presence_status" DEFAULT 'OFFLINE' NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_risk_state" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"status" "user_risk_status" DEFAULT 'NORMAL' NOT NULL,
	"reason" text,
	"frozen_at" timestamp,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_rollup_24h" (
	"user_id" varchar NOT NULL,
	"window_start" timestamp NOT NULL,
	"login_fail_count" integer DEFAULT 0,
	"login_success_count" integer DEFAULT 0,
	"distinct_device_count" integer DEFAULT 0,
	"distinct_ip_count" integer DEFAULT 0,
	"purchase_count" integer DEFAULT 0,
	"purchase_amount_cents" integer DEFAULT 0,
	"redemption_apply_count" integer DEFAULT 0,
	"redemption_pts_approved" integer DEFAULT 0,
	"gameplay_matches" integer DEFAULT 0,
	"gameplay_answers" integer DEFAULT 0,
	"gameplay_correct" integer DEFAULT 0,
	"gameplay_median_response_ms" integer,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_rollup_24h_pk" UNIQUE("user_id","window_start")
);
--> statement-breakpoint
DROP INDEX "idx_geo_rollups_daily_pk";--> statement-breakpoint
ALTER TABLE "game_sets" ADD COLUMN "cardhedge_set_query" text;--> statement-breakpoint
ALTER TABLE "game_sets" ADD COLUMN "cardhedge_category" text;--> statement-breakpoint
ALTER TABLE "game_sets" ADD COLUMN "cards_imported_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_sets" ADD COLUMN "last_import_at" timestamp;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "game_set_id" varchar;--> statement-breakpoint
ALTER TABLE "card_image_reports" ADD CONSTRAINT "card_image_reports_card_id_playable_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."playable_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_image_reports" ADD CONSTRAINT "card_image_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_image_reports" ADD CONSTRAINT "card_image_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_set_cards" ADD CONSTRAINT "card_set_cards_set_id_card_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."card_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_set_cards" ADD CONSTRAINT "card_set_cards_card_id_catalog_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."catalog_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cardhedge_import_runs" ADD CONSTRAINT "cardhedge_import_runs_game_set_id_game_sets_id_fk" FOREIGN KEY ("game_set_id") REFERENCES "public"."game_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_purchase_intent" ADD CONSTRAINT "external_purchase_intent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplay_events" ADD CONSTRAINT "gameplay_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "margin_usage" ADD CONSTRAINT "margin_usage_redemption_id_redemption_credit_id_fk" FOREIGN KEY ("redemption_id") REFERENCES "public"."redemption_credit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_points_counters" ADD CONSTRAINT "match_points_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_tickets" ADD CONSTRAINT "matchmaking_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playable_cards" ADD CONSTRAINT "playable_cards_game_set_id_game_sets_id_fk" FOREIGN KEY ("game_set_id") REFERENCES "public"."game_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_awards" ADD CONSTRAINT "points_awards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_awards" ADD CONSTRAINT "points_awards_policy_id_reward_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."reward_policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_player1_id_users_id_fk" FOREIGN KEY ("player1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_player2_id_users_id_fk" FOREIGN KEY ("player2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_player1_ticket_id_matchmaking_tickets_id_fk" FOREIGN KEY ("player1_ticket_id") REFERENCES "public"."matchmaking_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_player2_ticket_id_matchmaking_tickets_id_fk" FOREIGN KEY ("player2_ticket_id") REFERENCES "public"."matchmaking_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_credit" ADD CONSTRAINT "redemption_credit_purchase_intent_id_external_purchase_intent_id_fk" FOREIGN KEY ("purchase_intent_id") REFERENCES "public"."external_purchase_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_credit" ADD CONSTRAINT "redemption_credit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_credit" ADD CONSTRAINT "redemption_credit_ledger_spend_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_spend_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_credit" ADD CONSTRAINT "redemption_credit_ledger_credit_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_credit_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_reservations" ADD CONSTRAINT "redemption_reservations_purchase_intent_id_external_purchase_intent_id_fk" FOREIGN KEY ("purchase_intent_id") REFERENCES "public"."external_purchase_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_actions" ADD CONSTRAINT "risk_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_import_job_logs" ADD CONSTRAINT "set_import_job_logs_job_id_set_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."set_import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_import_jobs" ADD CONSTRAINT "set_import_jobs_set_id_card_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."card_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_package_validations" ADD CONSTRAINT "store_package_validations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_package_validations" ADD CONSTRAINT "store_package_validations_policy_id_store_package_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."store_package_policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_package_validations" ADD CONSTRAINT "store_package_validations_fee_profile_id_store_fee_profiles_id_fk" FOREIGN KEY ("fee_profile_id") REFERENCES "public"."store_fee_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_package_validations" ADD CONSTRAINT "store_package_validations_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_points_counters" ADD CONSTRAINT "user_points_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_risk_state" ADD CONSTRAINT "user_risk_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_events_user" ON "auth_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_auth_events_type" ON "auth_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_auth_events_created" ON "auth_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_auth_events_device" ON "auth_events" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "idx_auth_events_ip" ON "auth_events" USING btree ("ip_hash");--> statement-breakpoint
CREATE INDEX "idx_card_details_cache_expires" ON "card_details_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_card_details_cache_card_raw" ON "card_details_cache" USING btree ("card_id","raw_images_only");--> statement-breakpoint
CREATE INDEX "idx_card_image_reports_card" ON "card_image_reports" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "idx_card_image_reports_status" ON "card_image_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_card_image_reports_reporter" ON "card_image_reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "idx_card_set_cards_set" ON "card_set_cards" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "idx_card_set_cards_card" ON "card_set_cards" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "idx_card_sets_sport_year" ON "card_sets" USING btree ("sport","year");--> statement-breakpoint
CREATE INDEX "idx_card_sets_active" ON "card_sets" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_cardhedge_import_runs_game_set" ON "cardhedge_import_runs" USING btree ("game_set_id");--> statement-breakpoint
CREATE INDEX "idx_cardhedge_import_runs_status" ON "cardhedge_import_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cardhedge_search_cache_expires" ON "cardhedge_search_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_catalog_cards_provider_id" ON "catalog_cards" USING btree ("provider","provider_card_id");--> statement-breakpoint
CREATE INDEX "idx_catalog_cards_sport" ON "catalog_cards" USING btree ("sport");--> statement-breakpoint
CREATE INDEX "idx_catalog_cards_player" ON "catalog_cards" USING btree ("player");--> statement-breakpoint
CREATE INDEX "idx_device_events_user" ON "device_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_device_events_device" ON "device_events" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "idx_device_events_created" ON "device_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_device_events_ip" ON "device_events" USING btree ("ip_hash");--> statement-breakpoint
CREATE INDEX "idx_device_rollup_24h_window" ON "device_rollup_24h" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "idx_external_purchase_intent_user" ON "external_purchase_intent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_external_purchase_intent_status" ON "external_purchase_intent" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_external_purchase_intent_source" ON "external_purchase_intent" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_external_purchase_intent_created" ON "external_purchase_intent" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_fraud_signals_user_created" ON "fraud_signals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_fraud_signals_type_created" ON "fraud_signals" USING btree ("signal_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_gameplay_events_match" ON "gameplay_events" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "idx_gameplay_events_user" ON "gameplay_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_gameplay_events_created" ON "gameplay_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_internal_player_stats_key" ON "internal_player_stats" USING btree ("player_key");--> statement-breakpoint
CREATE INDEX "idx_ip_rollup_24h_window" ON "ip_rollup_24h" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "idx_margin_ledger_source_type" ON "margin_ledger" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "idx_margin_ledger_created" ON "margin_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_margin_usage_redemption" ON "margin_usage" USING btree ("redemption_id");--> statement-breakpoint
CREATE INDEX "idx_margin_usage_created" ON "margin_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_marketplace_margin_config_source" ON "marketplace_margin_config" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_match_points_counters_user" ON "match_points_counters" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_matchmaking_tickets_user" ON "matchmaking_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_matchmaking_tickets_status" ON "matchmaking_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_matchmaking_tickets_bucket" ON "matchmaking_tickets" USING btree ("bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_matchmaking_tickets_active_unique" ON "matchmaking_tickets" USING btree ("user_id","mode") WHERE status IN ('WAITING', 'MATCHED');--> statement-breakpoint
CREATE INDEX "idx_payment_events_user" ON "payment_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_payment_events_type" ON "payment_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_payment_events_created" ON "payment_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_events_stripe" ON "payment_events" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "idx_payment_events_device" ON "payment_events" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "idx_playable_cards_game_set" ON "playable_cards" USING btree ("game_set_id");--> statement-breakpoint
CREATE INDEX "idx_playable_cards_player" ON "playable_cards" USING btree ("player");--> statement-breakpoint
CREATE INDEX "idx_playable_cards_set" ON "playable_cards" USING btree ("set");--> statement-breakpoint
CREATE INDEX "idx_playable_cards_number" ON "playable_cards" USING btree ("number");--> statement-breakpoint
CREATE INDEX "idx_playable_cards_is_playable" ON "playable_cards" USING btree ("is_playable");--> statement-breakpoint
CREATE INDEX "idx_playable_cards_image_review" ON "playable_cards" USING btree ("image_review_status");--> statement-breakpoint
CREATE INDEX "idx_player_fame_sport_name" ON "player_fame" USING btree ("sport","player_name");--> statement-breakpoint
CREATE INDEX "idx_player_fame_key" ON "player_fame" USING btree ("player_key");--> statement-breakpoint
CREATE INDEX "idx_points_awards_user_created" ON "points_awards" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_points_awards_match" ON "points_awards" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "idx_points_awards_idempotency" ON "points_awards" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_profit_policy_effective" ON "profit_policy" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "idx_profit_policy_enabled" ON "profit_policy" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_pvp_matches_player1" ON "pvp_matches" USING btree ("player1_id");--> statement-breakpoint
CREATE INDEX "idx_pvp_matches_player2" ON "pvp_matches" USING btree ("player2_id");--> statement-breakpoint
CREATE INDEX "idx_pvp_matches_status" ON "pvp_matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_redemption_credit_purchase_intent" ON "redemption_credit" USING btree ("purchase_intent_id");--> statement-breakpoint
CREATE INDEX "idx_redemption_credit_user" ON "redemption_credit" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_redemption_credit_status" ON "redemption_credit" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_redemption_events_user" ON "redemption_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_redemption_events_type" ON "redemption_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_redemption_events_created" ON "redemption_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_redemption_reservations_intent" ON "redemption_reservations" USING btree ("purchase_intent_id");--> statement-breakpoint
CREATE INDEX "idx_redemption_reservations_status" ON "redemption_reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reward_policy_effective" ON "reward_policy" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "idx_reward_policy_enabled" ON "reward_policy" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_risk_actions_user" ON "risk_actions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_risk_actions_action" ON "risk_actions" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_risk_actions_created" ON "risk_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_risk_actions_expires" ON "risk_actions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_risk_jobs_status_run" ON "risk_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "idx_risk_jobs_type_run" ON "risk_jobs" USING btree ("job_type","run_after");--> statement-breakpoint
CREATE INDEX "idx_risk_signals_user" ON "risk_signals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_risk_signals_type" ON "risk_signals" USING btree ("signal_type");--> statement-breakpoint
CREATE INDEX "idx_risk_signals_created" ON "risk_signals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_risk_suppressions_user" ON "risk_suppressions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_risk_suppressions_expires" ON "risk_suppressions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_set_import_job_logs_job" ON "set_import_job_logs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_set_import_jobs_set" ON "set_import_jobs" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "idx_set_import_jobs_status" ON "set_import_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_store_fee_profiles_channel" ON "store_fee_profiles" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "idx_store_fee_profiles_active" ON "store_fee_profiles" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_store_package_policy_active" ON "store_package_policy" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_store_package_validations_product" ON "store_package_validations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_store_package_validations_decision" ON "store_package_validations" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "idx_store_package_validations_created" ON "store_package_validations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_store_purchases_user" ON "store_purchases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_store_purchases_status" ON "store_purchases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_store_purchases_session" ON "store_purchases" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "idx_user_points_counters_date" ON "user_points_counters" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_user_presence_status" ON "user_presence" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_user_presence_last_seen" ON "user_presence" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_user_risk_state_status" ON "user_risk_state" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_user_rollup_24h_window" ON "user_rollup_24h" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_geo_rollups_daily_unique" ON "geo_rollups_daily" USING btree ("day","country","region");