-- Drop growth agent tables (safe to run even if tables don't exist)
DROP TABLE IF EXISTS growth_follower_dm_log;
DROP TABLE IF EXISTS publishing_queue;
DROP TABLE IF EXISTS growth_content_items;
DROP TABLE IF EXISTS growth_content_plans;
DROP TABLE IF EXISTS growth_job_runs;
DROP TABLE IF EXISTS growth_formats;
DROP TABLE IF EXISTS user_growth_rollups;
DROP TABLE IF EXISTS global_growth_rollups;
