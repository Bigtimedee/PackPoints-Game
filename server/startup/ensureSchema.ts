import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Idempotent startup migration — creates tables/types that may be missing from
 * the production database if drizzle-kit push was never run after deployment.
 * Safe to run on every boot (all statements use IF NOT EXISTS).
 */
export async function ensureSchema(): Promise<void> {
  try {
    await db.execute(sql`
      -- Enums (DO $$ blocks are idempotent via exception catch)
      DO $$ BEGIN
        CREATE TYPE "public"."card_set_sport" AS ENUM('Baseball', 'Basketball', 'Football', 'Hockey');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE "public"."set_import_job_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE "public"."set_import_job_log_level" AS ENUM('INFO', 'WARN', 'ERROR');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE "public"."social_post_status" AS ENUM(
          'DRAFT', 'QUEUED', 'MEDIA_PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'SKIPPED', 'BLOCKED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        ALTER TYPE "public"."social_post_status" ADD VALUE IF NOT EXISTS 'MEDIA_PENDING';
      EXCEPTION WHEN others THEN NULL;
      END $$;

      DO $$ BEGIN
        ALTER TYPE "public"."social_post_status" ADD VALUE IF NOT EXISTS 'BLOCKED';
      EXCEPTION WHEN others THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE "public"."media_status" AS ENUM('NOT_REQUIRED', 'PENDING', 'GENERATED', 'UPLOADED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      -- card_sets
      CREATE TABLE IF NOT EXISTS "card_sets" (
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

      -- catalog_cards
      CREATE TABLE IF NOT EXISTS "catalog_cards" (
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

      -- card_set_cards
      CREATE TABLE IF NOT EXISTS "card_set_cards" (
        "set_id" varchar NOT NULL,
        "card_id" varchar NOT NULL,
        "created_at" timestamp DEFAULT now()
      );

      -- set_import_jobs
      CREATE TABLE IF NOT EXISTS "set_import_jobs" (
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

      -- set_import_job_logs
      CREATE TABLE IF NOT EXISTS "set_import_job_logs" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "job_id" varchar NOT NULL,
        "level" "set_import_job_log_level" NOT NULL,
        "message" text NOT NULL,
        "meta" jsonb,
        "created_at" timestamp DEFAULT now()
      );

      -- set_audit_log
      CREATE TABLE IF NOT EXISTS "set_audit_log" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "set_id" varchar,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "action_type" varchar(50) NOT NULL,
        "operation_source" varchar(30) NOT NULL,
        "actor_user_id" varchar,
        "before_total_cards" integer DEFAULT 0 NOT NULL,
        "after_total_cards" integer DEFAULT 0 NOT NULL,
        "before_playable_cards" integer DEFAULT 0 NOT NULL,
        "after_playable_cards" integer DEFAULT 0 NOT NULL,
        "delta_total_cards" integer DEFAULT 0 NOT NULL,
        "delta_playable_cards" integer DEFAULT 0 NOT NULL,
        "reason" text,
        "evidence_json" jsonb
      );

      -- Indexes for set_audit_log
      CREATE INDEX IF NOT EXISTS "idx_set_audit_log_set" ON "set_audit_log" ("set_id");
      CREATE INDEX IF NOT EXISTS "idx_set_audit_log_created" ON "set_audit_log" ("created_at");
      CREATE INDEX IF NOT EXISTS "idx_set_audit_log_action" ON "set_audit_log" ("action_type");
      CREATE INDEX IF NOT EXISTS "idx_set_audit_log_source" ON "set_audit_log" ("operation_source");

      -- job_queue (persistent background job table for pgJobQueue.ts)
      CREATE TABLE IF NOT EXISTS "job_queue" (
        "id" serial PRIMARY KEY,
        "job_type" text NOT NULL,
        "payload" jsonb DEFAULT '{}' NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "attempts" integer DEFAULT 0 NOT NULL,
        "max_attempts" integer DEFAULT 3 NOT NULL,
        "scheduled_at" timestamp DEFAULT now() NOT NULL,
        "started_at" timestamp,
        "completed_at" timestamp,
        "last_error" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "idx_job_queue_type_status" ON "job_queue" ("job_type", "status", "scheduled_at");

      -- social_posts media columns (idempotent)
      ALTER TABLE IF EXISTS "social_posts" ADD COLUMN IF NOT EXISTS "media_required" boolean NOT NULL DEFAULT false;
      ALTER TABLE IF EXISTS "social_posts" ADD COLUMN IF NOT EXISTS "media_status" "media_status" NOT NULL DEFAULT 'NOT_REQUIRED';
      ALTER TABLE IF EXISTS "social_posts" ADD COLUMN IF NOT EXISTS "publish_block_reason" text;
      ALTER TABLE IF EXISTS "social_posts" ADD COLUMN IF NOT EXISTS "preflight_passed" boolean;

      -- growth_content_items media columns (idempotent)
      ALTER TABLE IF EXISTS "growth_content_items" ADD COLUMN IF NOT EXISTS "media_required" boolean NOT NULL DEFAULT false;
      ALTER TABLE IF EXISTS "growth_content_items" ADD COLUMN IF NOT EXISTS "media_status" "media_status" NOT NULL DEFAULT 'NOT_REQUIRED';
      ALTER TABLE IF EXISTS "growth_content_items" ADD COLUMN IF NOT EXISTS "media_asset_count" integer NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS "growth_content_items" ADD COLUMN IF NOT EXISTS "publish_block_reason" text;
      ALTER TABLE IF EXISTS "growth_content_items" ADD COLUMN IF NOT EXISTS "preflight_passed" boolean;

      -- baseball_cards admin review columns (idempotent)
      ALTER TABLE IF EXISTS "baseball_cards" ADD COLUMN IF NOT EXISTS "image_review_status" varchar(20) NOT NULL DEFAULT 'unreviewed';
      ALTER TABLE IF EXISTS "baseball_cards" ADD COLUMN IF NOT EXISTS "report_count" integer NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS "baseball_cards" ADD COLUMN IF NOT EXISTS "blocked_reason" text;

      -- Drop FK that incorrectly ties card_image_reports to the empty playable_cards table.
      -- Reports are filed against baseball_cards IDs; application-layer lookup enforces validity.
      ALTER TABLE IF EXISTS "card_image_reports" DROP CONSTRAINT IF EXISTS "card_image_reports_card_id_playable_cards_id_fk";

      -- card_set_masks (CSS mask regions per card set)
      CREATE TABLE IF NOT EXISTS "card_set_masks" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "set_key" text NOT NULL UNIQUE,
        "provider_set_id" text,
        "mask_version" integer DEFAULT 1 NOT NULL,
        "regions" jsonb NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );

      -- card_image_mask_cache (server-side masked image cache)
      CREATE TABLE IF NOT EXISTS "card_image_mask_cache" (
        "card_id" text PRIMARY KEY,
        "raw_image_url" text NOT NULL,
        "masked_image_path" text NOT NULL,
        "mask_version" text NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "idx_card_mask_cache_version" ON "card_image_mask_cache" ("mask_version");

      -- global_growth_rollups (growth flywheel daily rollup)
      CREATE TABLE IF NOT EXISTS "global_growth_rollups" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "day_key" varchar(10) NOT NULL UNIQUE,
        "dau" integer DEFAULT 0 NOT NULL,
        "matches_played" integer DEFAULT 0 NOT NULL,
        "daily5_entries" integer DEFAULT 0 NOT NULL,
        "shares_total" integer DEFAULT 0 NOT NULL,
        "invites_sent" integer DEFAULT 0 NOT NULL,
        "signups_from_invites" integer DEFAULT 0 NOT NULL,
        "first_matches_from_invites" integer DEFAULT 0 NOT NULL,
        "first_purchases_from_invites" integer DEFAULT 0 NOT NULL,
        "k_factor" real,
        "computed_at" timestamp DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "idx_global_growth_rollups_day" ON "global_growth_rollups" ("day_key");

      -- user_growth_rollups (per-user growth flywheel daily rollup)
      CREATE TABLE IF NOT EXISTS "user_growth_rollups" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL,
        "day_key" varchar(10) NOT NULL,
        "matches_played" integer DEFAULT 0 NOT NULL,
        "daily5_entries" integer DEFAULT 0 NOT NULL,
        "shares_total" integer DEFAULT 0 NOT NULL,
        "invites_sent" integer DEFAULT 0 NOT NULL,
        "signups_from_invites" integer DEFAULT 0 NOT NULL,
        "computed_at" timestamp DEFAULT now(),
        UNIQUE ("user_id", "day_key")
      );
      CREATE INDEX IF NOT EXISTS "idx_user_growth_rollup_day" ON "user_growth_rollups" ("day_key");
      CREATE INDEX IF NOT EXISTS "idx_user_growth_rollup_user" ON "user_growth_rollups" ("user_id");
    `);

    console.log("[ensureSchema] Schema verified/created successfully.");
  } catch (err: any) {
    // Log but do not crash — missing tables will surface as 500s per-endpoint,
    // which is better than blocking all startup.
    console.error("[ensureSchema] Failed to ensure schema:", err?.message);
  }
}
