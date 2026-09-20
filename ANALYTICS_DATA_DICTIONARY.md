# PackPTS Collector Intelligence — Data Dictionary & Lineage

> Diligence reference (ANALYTICS_PROMPTS.md, Prompt 8). Every published index traces to its formula and its source events. The asset is PII-free by construction and separates a credible "clean" layer from the raw layer.

## Governance guarantees

- **PII-free:** analytics tables key users only on `user_hash` = `HMAC-SHA256(userId, SECRET_SALT)`. No email/phone/name/IP/address columns exist in any `analytics_*` table. Verified continuously by `GET /api/admin/analytics/governance` (piiAudit).
- **Clean vs raw:** every event carries `is_clean`; users whose `user_risk_state.status <> 'NORMAL'` (flagged/frozen/bot) are `is_clean = false`. All indices compute over the clean layer by default; the raw layer is available via `?clean=false`.
- **Reproducible:** marts are a pure function of the append-only event spine (full per-day recompute), so any index can be rebuilt from source.

## Source layer

| Table | Grain | Source |
|---|---|---|
| `analytics_events` | one row per user action | fire-and-forget `track()` at gameplay/reveal/commerce call sites |
| `card_price_history` | (day, player, year) | daily CardHedge snapshot worker |

Event types: `answer_submitted` (outcome, latency), `listing_click`, `set_started`, `set_published`.

## Mart layer (derived, daily)

| Mart | Key | Derivation |
|---|---|---|
| `card_attention_daily` | (player_key, day, is_clean) | plays/correct/incorrect/unique_users/latency from `answer_submitted` |
| `set_engagement_daily` | (game_set_id, day, is_clean) | starts + plays + reach per set |
| `commerce_funnel_daily` | (game_set_id, day, is_clean) | listing clicks per set |

## Index layer (the IP)

| Index | Formula | Source |
|---|---|---|
| **Card Attention Index (CAI)** | 0–100 normalized recency-weighted signal, `Σ plays_d · 0.5^(age/14)`, scaled to cohort max | `card_attention_daily` |
| **Recognition Index (RI)** | `correct / attempts`, Wilson 95% CI, ≥20-attempt floor; breakout if velocity ≥ +10pts | `card_attention_daily` |
| **Commerce Intent Funnel** | correct → clicks → purchases; CTR, conversion, attributed revenue | marts + `outbound_clicks` + `attributed_purchases` |
| **Attention Alpha** | per-player Pearson corr of attention(t) vs price(t+lag), lag 0–14d, aggregated | `card_attention_daily` × `card_price_history` |
| **Trending / Market Pulse** | attention velocity, window vs prior window | `card_attention_daily`, `set_engagement_daily` |

## Data-quality monitors (`dataQuality`)

- mart-vs-raw reconciliation (`martReconciled`)
- null `player_key` rate on answer events (< 5% healthy)
- event + price-capture freshness

## Admin operational metrics (Registered users)

| Metric | Formula | Source | Notes |
|---|---|---|---|
| **`registeredUsersNonStaff`** | `COUNT(*)` where `is_admin = false` AND `is_bot = false` | `users` | Honest registered-user number. **Cite this.** Shown on `/admin/dashboard` and `GET /api/admin/dashboard`. Legacy `overview.totalUsers` aliases it. Do not invent a public figure. |
| `staffUsers` | `COUNT(*)` where `is_admin = true` | `users` | Same staff flag as Maker Rate / retention. Not product users. |
| `botUsers` | `COUNT(*)` where `is_bot = true` | `users` | AI fallback opponents. Not product users. |
| `allUserRows` | `COUNT(*)` | `users` | Reconciliation only. **Do not cite** as registered users. |
| `newSignupsNonStaff` | same exclusion, `created_at` in last 7d | `users` | Dashboard 7d card. Scorecard weekly signups use the same exclusion. |

Authoritative SQL: `REGISTERED_USERS_NON_STAFF_SQL` in `server/services/userCounts.ts` (Railway Postgres — the app `DATABASE_URL`, not Supabase).

```sql
SELECT
  COUNT(*) FILTER (
    WHERE COALESCE(is_admin, false) = false
      AND COALESCE(is_bot, false) = false
  ) AS registered_users_non_staff,
  COUNT(*) FILTER (WHERE COALESCE(is_admin, false) = true) AS staff_users,
  COUNT(*) FILTER (WHERE COALESCE(is_bot, false) = true) AS bot_users,
  COUNT(*) AS all_user_rows
FROM users;
```

**Marketing citation:** `registeredUsersNonStaff` from the live admin dashboard only. Never all-rows. Never staff. Never bots. Never a guessed “beyond Dave” number.

**Do not cite these live public probes as registered users** (verified 2026-09-20 against packpts.com; they are not staff-excluded `users` counts):

| Probe | Live read | Why it is not the GTM number |
|---|---|---|
| `GET /api/access/cap` → `currentActive` | `3` | Founders-cap `active_user_counter.count`. Includes staff. Not `COUNT(users)` and not staff-excluded. |
| `GET /api/access/summary` → `waitlistSize` | `0` | Waitlist rows, not registered users. |
| `GET /api/leaderboard` | 3 rows (`Bigtimedee`, `designqa`, `claude_e2e_test`) | Top 20 by points. Includes staff/test. Omits users with no score. |
| `GET /api/admin/dashboard` | `401` from this environment | The cite field after deploy. Requires admin session. |

## Admin operational metrics (Making Layer)

| Metric | Formula | Source | Notes |
|---|---|---|---|
| **Maker Rate** | `makers_30d / mau_30d` | `game_sets` ÷ `event_log` | % of 30d MAU who published ≥1 user-created set in the same 30d window. Staff (`users.is_admin`) excluded from both sides. Activity source matches admin DAU (`event_log`), not `user_presence`. |
| `makers_30d` | `COUNT(DISTINCT created_by_user_id ∪ co_creator_user_id)` where `is_user_created` and `created_at` in last 30d | `game_sets` ⨝ `users` | Non-admin creators + collab co-creators |
| `publishedSetsNonStaff` | `COUNT(*)` of `is_user_created` sets whose `created_by_user_id` is non-admin | `game_sets` ⨝ `users` | Lifetime, admin-only. Diligence ≥10 published-set gate. Not a public metric. |
| `makerSupplyGate` | `{ publishedSetsNonStaff, target: 10, remaining, progress, reached }` | derived from `publishedSetsNonStaff` | Admin progress to the ≥10 non-staff published-set gate. |
| `mau_30d` | `COUNT(DISTINCT user_id)` with any event in last 30d | `event_log` ⨝ `users` | Same spine as `GET /api/admin/metrics` DAU |
| Maker-supply funnel | event + unique-user counts for `make_started` → `identify_success` → `name_started` → `publish_success` → `share_generated` → `share_opened` → `set_viewed`; plus `identify_fail` / `publish_fail`; top drop-off = largest unique-user loss between consecutive success steps | `event_log` ⨝ `users` | Last 7d and 30d. Staff (`users.is_admin`) excluded. Anonymous (null `user_id`) counts as events, not unique users. Admin-only. |
| Identify fail rate | `identify_fail.events / (identify_success.events + identify_fail.events)` | `event_log` | Design MAKE_FRICTION. Per-card attempts. |
| Time-to-publish | p50 / p90 of `publish_success.created_at − last prior make_started.created_at` per user | `event_log` | Staff excluded. Samples = paired publishes. |
| Name/mixtape drop-off | unique `name_started` users − unique `publish_success` users | `event_log` | Users who reached the name + mixtape form but did not publish. |
| Share open rate | unique `share_opened` users / unique `publish_success` users | `event_log` | Share sheet / Share CTA (Surface A + set page), not copy-link. |

Funnel `event_type` values (written by `logMakingLayerEvent` → `analyticsService` → `event_log`):

| Event | When |
|---|---|
| `make_started` | `POST /api/make/start` on `/make` mount (once per browser session) |
| `identify_success` / `identify_fail` | `POST /api/sets/identify-card` |
| `name_started` | `POST /api/make/event` when the maker opens the name/mixtape form |
| `publish_success` / `publish_fail` | `POST /api/sets/create` |
| `share_generated` | Maker-share PNG persisted in `onSetPublished` |
| `share_opened` | `POST /api/make/event` when Share / share-without-card is invoked |
| `set_viewed` | `GET /api/sets/:id` for `is_user_created` sets |

Endpoint: `GET /api/admin/metrics/making-layer` → `{ makerRate, makers30d, mau30d, publishedSetsNonStaff, makerSupplyGate, funnel: { last7d, last30d }, ... }` (admin session only; Maker Rate and funnel volume are not public).
Implementation: `server/services/makingLayerMetrics.ts`, `server/services/makingLayerEvents.ts`.

## Admin operational metrics (Retention — unpublished)

| Metric | Formula | Source | Notes |
|---|---|---|---|
| **Cohort** | Users whose **first** `event_log` row falls in that ISO week (Mon–Sun, America/Chicago) | `event_log` ⨝ `users` | Not `users.created_at`. Matches admin DAU / Maker Rate activity spine. |
| **D1 / D7 / D30** | `returned_N / cohort_size` | `event_log` | Returned = ≥1 event on first-active CT date + N. Day 0 is not D1. Rate is `null` until today (CT) > week Sunday + N. |
| Staff / bots | `users.is_admin` and `users.is_bot` excluded | `users` | Staff exclusion matches Maker Rate. Bots are the AI fallback, not product users. |
| **Maker Rate** (same page) | `makers_30d / mau_30d` | `fetchMakerRateMetrics` | Reused, not redefined. |

Endpoint: `GET /api/admin/retention` (admin session only). UI: `/admin/metrics`. **Never** expose on `/api/home-stats` or marketing pages.
Implementation: `server/services/retentionCohorts.ts`. Retention emails (`retentionEmails.ts`) use last-played (`streak_state.last_active_local_date`) — same activity family, not this cohort statistic.

How to read a weekly row: cohort size first (small-n rates are real but noisy); ignore “—” (window open); D1/D7/D30 are independent; Maker Rate is a 30d conversion metric, not a retention substitute.

