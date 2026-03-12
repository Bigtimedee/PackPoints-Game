# PackPTS Database Migrations

This directory contains all SQL migration files for the PackPTS PostgreSQL database.

## Migration Approach

Migrations are applied automatically at container startup via `start.sh` using Drizzle ORM:

```sh
# Production
npx drizzle-kit push

# Development (force mode — allows schema drift)
npx drizzle-kit push --force
```

The `start.sh` script (project root) detects `NODE_ENV` and applies the appropriate command before starting the Node server.

### Manual Application

To apply a supplementary SQL file directly (e.g. on Railway or any PostgreSQL host):

```sh
psql $DATABASE_URL -f migrations/<filename>.sql
```

Or using the Railway CLI:

```sh
railway run psql $DATABASE_URL -f migrations/<filename>.sql
```

---

## Migration Files

### Drizzle-managed migrations (applied automatically in order)

These files are generated and tracked by Drizzle ORM. The `meta/` subdirectory contains `_journal.json` and snapshot files that Drizzle uses to track which migrations have been applied.

| File | Description |
|------|-------------|
| `0000_add_geo_tables.sql` | **Initial schema.** Creates the full base schema including: `users`, `wallets`, `ledger_entries`, `sessions`, `baseball_cards`, `game_sets`, `lobbies`, `matches`, `match_participants`, `match_tokens`, `streak_state`, `streak_claim_log`, `streak_reward_config`, `packpts_bucket`, `packpts_expiration_policy`, `packpts_liability_snapshot`, `packpts_spend_allocation`, `redemption_tiers`, `reward_redemptions`, `products`, `purchase_events`, `stripe_checkout_sessions`, `stripe_customers`, `subscription_products`, `user_entitlements`, `user_identities`, `local_credentials`, `founders_pass`, `founders_pass_events`, `invite_codes`, `waitlist_entries`, `app_config`, `feature_flags`, `event_log`, `access_audit_log`, `admin_audit_log`, `identity_link_audit`, `daily_quotas`, `match_context_log`, `outbound_clicks`, `marketplace_cache`, `external_listings_snapshot`, `goldin_curated_listings`, `user_active_sets`, `user_geo_session`, `user_geo_profile`, `geo_rollups_daily`, `pending_link_challenges`, `password_reset_tokens`, `active_user_counter`. Also creates all ENUMs, foreign keys, and indexes. |
| `0001_fast_ozymandias.sql` | **Extended schema.** Adds ~30 additional tables and ENUMs for: authentication events (`auth_events`), gameplay events, risk pipeline (`risk_job_queue`, `risk_signals`, `risk_snapshots`), matchmaking (`matchmaking_tickets`, `pvp_matches`), card set import jobs (`set_import_jobs`, `set_import_job_logs`), store purchases, redemption reservations/credits/events, PackPTS margin tracking, leaderboards, user presence, progress tracking (`daily_progress`, `weekly_progress`), webhook retry queue, A/B tests, and social media campaign tables. Adds ENUMs: `auth_event_type`, `award_reason`, `card_set_sport`, `device_event_type`, `gameplay_event_type`, `matchmaking_mode`, `payment_event_type`, `pvp_match_status`, `rarity_type`, `risk_action_type`, `risk_job_status`, `risk_job_type`, `risk_signal_type`, `risk_tier`, and others. |
| `0002_match_question_replacement.sql` | **Match question tracking.** Adds `seed_version`, `replaced_count`, and `assigned_at` columns to `match_questions` to support card replacement tracking within active matches. |
| `0003_follower_dm_log.sql` | **Growth: follower DM log.** Creates `growth_follower_dm_log` table for tracking outbound DMs sent to social media followers (platform, follower ID, status, errors). Superseded by `drop_growth_tables.sql`. |

---

### Supplementary SQL migrations (applied manually)

These files are not tracked by Drizzle and must be applied manually when needed.

| File | Description |
|------|-------------|
| `add_social_media_agent.sql` | **Social media agent schema.** Creates enums (`social_platform`, `social_post_status`, `social_content_type`, `ab_test_status`, `campaign_reward_type`) and tables for autonomous social media posting: `growth_content_plans`, `growth_content_items`, `publishing_queue`, and social A/B test / campaign tables. Apply before enabling `SOCIAL_MEDIA_AGENT_ENABLED=true`. |
| `add_fact_check_fields.sql` | **Fact-check guardrails.** Adds `fact_check_status`, `fact_check_score`, `fact_check_notes`, and `fact_check_reviewed_at` columns to `growth_content_items` to support the AI content moderation pipeline. Apply after `add_social_media_agent.sql`. |
| `add_notion_fields_to_publishing_queue.sql` | **Notion integration.** Adds `notion_page_id`, `notion_synced_at`, and `notion_sync_error` columns to `publishing_queue` for syncing published content to a Notion database. Apply after `add_social_media_agent.sql`. |
| `drop_growth_tables.sql` | **Growth table cleanup.** Drops `growth_follower_dm_log`, `publishing_queue`, `growth_content_items`, and `growth_content_plans` when the social media agent is disabled or removed. **Destructive — back up data before applying.** |
| `add_job_queue.sql` | **Persistent job queue.** Creates the `job_queue` table used by `server/jobs/pgJobQueue.ts` to replace volatile `setInterval` jobs with crash-resistant, PostgreSQL-backed, retry-safe job processing. Includes indexes on `(status, scheduled_at)` and `(job_type)`. Apply before deploying B7 job queue changes. |

---

## Meta Directory

| File | Description |
|------|-------------|
| `meta/_journal.json` | Drizzle migration journal — tracks which numbered migrations have been applied. Do not edit manually. |
| `meta/0000_snapshot.json` | Schema snapshot after migration 0000. Used by Drizzle for diff computation. |
| `meta/0001_snapshot.json` | Schema snapshot after migration 0001. Used by Drizzle for diff computation. |

---

## Adding a New Migration

### Drizzle-managed (recommended for schema changes)

1. Modify the schema definition in `shared/schema.ts` (or the appropriate schema file).
2. Run `npx drizzle-kit generate` to generate the numbered SQL file.
3. The file will appear as `migrations/000N_<name>.sql` and be tracked in `meta/_journal.json`.
4. Commit both the SQL file and the updated `meta/` snapshot.

### Supplementary SQL (for additive patches)

1. Create a new `.sql` file in this directory with a descriptive name.
2. Test it locally: `psql $DATABASE_URL -f migrations/<your_file>.sql`
3. Document it in this README under the "Supplementary SQL migrations" table.
4. Apply to production: `railway run psql $DATABASE_URL -f migrations/<your_file>.sql`
