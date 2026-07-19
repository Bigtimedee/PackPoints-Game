# Incident Report — Card Sets Missing From Production (2026-07-18)

## Summary

On 2026-07-18, after the apex domain `packpts.com` was correctly repointed to Railway, the site showed **zero playable card sets**. Investigation established that the Railway Postgres database — the true production database — had no staff-created `game_sets` or `playable_cards` rows. The flagship set (1987 Topps Baseball, 860 cards imported, 608 playable) was rebuilt the same day from the Card Hedge API and verified playable end-to-end.

## What the owner saw, and why

Until 2026-07-18, the apex `packpts.com` DNS A record pointed at a retired pre-Railway legacy deployment with **its own separate, older database**. That legacy app displayed card sets and appeared healthy. The Railway deployment — reachable only via `www.packpts.com` — was the app actually being developed and deployed, and its database had no staff sets. When the apex was repointed to Railway (fixing a stale-app/dead-API problem that affected every visitor), the Railway database's true state became visible for the first time: no sets.

**The DNS fix did not delete any data. It exposed a data gap that already existed in the Railway database, which had been masked by the legacy deployment answering on the apex domain.**

## Root cause chain

1. **Two live deployments, two databases.** The legacy pre-Railway host kept serving `packpts.com` with an old database long after the Railway migration. Development, deploys, and schema changes happened on Railway; the audience-facing domain served the legacy app. No monitoring compared the two.
2. **The Railway database never had (or lost) the staff card sets.** The exact moment cannot be reconstructed — there are no backups and boot logs rotate. The prime destructive mechanism present in the stack: `start.sh` runs `npx drizzle-kit push --force` on **every deploy**. `--force` auto-approves any statement drizzle generates, **including DROPs and table recreations that destroy data**, whenever the live schema and `shared/schema.ts` disagree in a way drizzle resolves destructively. Multiple schema-changing deploys occurred during the Making Layer build-out (2026-07-16 → 07-18).
3. **No safety net existed.** Railway volume backups: zero (backup API calls return Not Authorized — likely a plan limitation). The Supabase project believed to be "production" contains **zero rows in every table** — it only ever held schema, never data, so it provided neither redundancy nor valid verification.

## Verification errors made by Claude during this session (owned in full)

- Data "verifications" and "cleanups" were run against the Supabase project on the assumption it was production. Deletes of rows that never existed there returned success, and `COUNT(*) = 0` checks passed vacuously. **A zero-rows-deleted result was treated as proof of cleanup.** The correct check — reading back through the live app's own API — was only done later, which is what exposed the discrepancy.
- Documentation (CLAUDE.md, PACKPTS_PROJECT_CONTEXT.md) asserting Supabase as the data store was trusted without verifying the app's actual `DATABASE_URL` until the discrepancy forced it.

## What was restored

| Item | Status |
|---|---|
| `game_sets` row: 1987 Topps (baseball, MLB, Card Hedge query `1987 Topps Baseball`) | ✅ Recreated via admin API |
| `playable_cards`: 860 imported from Card Hedge, 608 passing playability filters | ✅ Imported |
| Gameplay: set listed in `/api/playable-sets`, game starts, masked images render | ✅ Verified live |

## What could NOT be restored, and open decisions for the owner

1. **Any staff sets beyond 1987 Topps.** Their definitions existed only as database rows. If other sets existed, provide their names/years and they will be recreated + imported the same way.
2. **Legacy-host data.** The retired legacy deployment (still live at `34.111.179.208` as of this writing) has its own database that served real traffic until 2026-07-18. Any real user accounts/points created there are stranded in that database. Decide whether that data must be exported before the legacy deployment is shut down.
3. **Railway backups.** Backup create/schedule API calls return Not Authorized — check the Railway plan and enable volume backups for `postgres-volume` in the dashboard if available.

## Prevention (shipped with this report)

1. **Boot-time dump-before-push guard** (`start.sh`): before any `drizzle-kit push`, the container takes a compressed `pg_dump` of the entire database into the persistent volume (`/app/data/masked-cards/.db-backups/`, last 7 kept). **If the dump fails, the schema push is skipped** — the app still boots, but no schema mutation runs without a restore point.
2. **`pg_dump` installed in the image** (`postgresql16-client` in the Dockerfile).
3. **Permanent rule in CLAUDE.md**: no destructive schema operation (`drizzle-kit push --force`, `DROP`, column type changes) may ever run against production without a verified same-day dump, and all data verification must be performed against the database the app actually reads (`DATABASE_URL`), never a mirror.
