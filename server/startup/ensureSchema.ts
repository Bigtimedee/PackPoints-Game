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
    `);

    console.log("[ensureSchema] Schema verified/created successfully.");
  } catch (err: any) {
    // Log but do not crash — missing tables will surface as 500s per-endpoint,
    // which is better than blocking all startup.
    console.error("[ensureSchema] Failed to ensure schema:", err?.message);
  }
}
