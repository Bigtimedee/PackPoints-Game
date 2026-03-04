CREATE TABLE "growth_follower_dm_log" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "platform" varchar(20) NOT NULL,
  "follower_id" varchar(100) NOT NULL,
  "follower_username" varchar(100),
  "dm_status" varchar(20) DEFAULT 'SENT' NOT NULL,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "growth_follower_dm_log_platform_follower_id_unique" UNIQUE("platform","follower_id")
);
CREATE INDEX "idx_follower_dm_log_platform" ON "growth_follower_dm_log"("platform");
