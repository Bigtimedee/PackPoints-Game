# PackPoints

## Overview
PackPoints is a card-collecting gaming platform focused on baseball card recognition. It enables users to identify players from card images to earn points, redeemable for credits on platforms like Goldin Auctions and eBay. The platform offers solo, 1v1, and tournament game modes, a global leaderboard, and a marketplace. Its core purpose is to engage baseball card enthusiasts and implement robust monetization and retention strategies.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Technologies
The frontend utilizes React 18, TypeScript, Vite, Wouter for routing, Tailwind CSS, shadcn/ui, and TanStack React Query. The backend is built with Node.js, Express, TypeScript, Drizzle ORM with PostgreSQL, and Zod for validation. esbuild handles backend bundling, and WebSockets provide real-time functionality.

### Card Image System
Manages baseball card images from the Card Hedge API, masking player names during gameplay. This involves server-side image masking, CSS overlay masks, and per-set configurable masks. Images undergo validation, proxying, and multi-layer content-based placeholder detection. Player/image mismatch prevention is enforced through verification, admin tools, and user reporting.

### Anti-Pruning System
Prevents automated background jobs from removing cards from gameplay using a mutation guard, a quarantine flow for suspect cards, and comprehensive audit logging for all card/set mutations.

### CardHedge Integration Layer
A server-side integration providing API endpoints for card search, details lookup, and visual image search, with a TTL-based LRU cache and placeholder detection.

### Bundle Builder System
An admin tool for creating and managing PackPTS bundles with financial guardrails, supporting bidirectional USD/PackPTS conversion, a ratio system, and validation against margin policies. All actions are audited.

### Monetization & Wallet
Features a ledger-first "PackPTS" wallet with various transaction types, a product catalog, a tiered membership system (Free, Pro, Legend), and a bucket-based point expiration system.

### PackPTS Ledger Service (Feb 2026)
Centralized ledger entry point at `server/services/packpts/ledgerService.ts`. All PackPTS mutations (gameplay earn, Stripe purchases, subscriptions, streaks, refunds) route through `applyLedgerEntry()` which provides structured classification (`source`, `eventType`, `refType`, `refId`), idempotency keys, and event logging to `packpts_events` table. Extended `ledger_entries` schema with `source`, `event_type`, `ref_type`, `ref_id` columns. API endpoints: `GET /api/packpts/balance`, `GET /api/packpts/ledger?limit=&offset=`, `POST /api/admin/packpts/reconcile`. Transactional wallet operations (profitGuardrailService reversals/cancellations) pass `LedgerClassification` directly to `walletService.earn()` to maintain atomic transaction support.

**Authoritative Balance Source (Feb 2026):** `wallets.balance` is the single source of truth for PackPTS. The legacy `users.points` field is a cumulative counter that only increments and does NOT reflect spending. The leaderboard (`getLeaderboard` in `storage.ts`) and profile stats (`/api/profile/stats`) now JOIN with the `wallets` table and use `wallets.balance` for ranking, display, and level calculations. The header already reads from the wallet via `/wallet` endpoint. All PackPTS displays must read from the wallet, never from `users.points`.

### Authentication & Access Control
Supports multi-provider authentication (Replit Auth, WorkOS, local) with identity linking and magic-link verification. An access control system manages user caps, waitlists, invite codes, and a referral system. Session cookies are configured for security.

### Admin Tools & Redemption
Comprehensive tools manage users, wallets, entitlements, and feature flags. A closed-loop redemption system converts PackPTS into store credit, requiring admin approval for high-value redemptions.

### Analytics & Geo Intelligence
An event tracking system records user actions, and a privacy-safe geolocation system infers user home states.

### Store & PackPTS Purchase
Integrated with Stripe for one-time bundle purchases and monthly subscriptions. The store dynamically fetches products, supporting custom pricing, sorting, descriptions, and highlighting.

### Financial Guardrails
Ensures profitability for PackPTS packages and redemptions, tracks margins, and prevents fraud through user risk tracking.

### Marketplace
Aggregates listings from eBay and Goldin Auctions, supporting filtering, affiliate tracking, and outbound click logging.

### Non-Linear Reward System
A fame-based point calculation system rewards users based on player obscurity, vintage, and rarity multipliers, with daily and per-match point caps.

### Game Session Persistence (Feb 2026)
Solo game sessions are persisted to PostgreSQL via the `game_sessions` table (previously in-memory). Sessions survive server restarts and deployments. Table stores questions as JSONB, with indexes on `user_id` and `status`. Frontend handles expired/missing sessions gracefully by redirecting users to start a new game instead of showing cryptic errors.

### Daily Progress Tracking
Server-authoritative tracking of daily progress, including cards answered and matches completed, synchronized across match modes. Progress is applied atomically when matches finish via `applyProgressForMatchIfNeeded` in `engine.ts`, writing to `user_daily_progress` table. The `/api/progress/daily` endpoint reads from this table using Chicago timezone dates. Match participants are assigned HOST/GUEST roles in `matchService.ts`; the engine has a resilient player1/player2 fallback for legacy data without proper roles. An admin backfill endpoint (`POST /api/admin/progress/backfill`) can retroactively populate progress for finished matches.

### 1v1 Matchmaking System
Real-time, random matchmaking using a database-backed atomic pairing process with presence tracking, a ticket queue, and heartbeats.

### Match Lifecycle State Machine
A robust, database-backed state machine (LOBBY → INITIALIZING → ACTIVE → FINISHED/CANCELLED) ensures match integrity, prevents race conditions, and includes audit logging and recovery.

### Transactional Answer Submission
Ensures synchronized state during 1v1 matches through database locking, idempotent inserts, and atomic updates, broadcasting `ANSWER_STATUS` events.

## External Dependencies

- PostgreSQL
- Drizzle Kit
- Radix UI
- Embla Carousel
- Recharts
- Lucide React
- React Icons
- connect-pg-simple
- express-session
- zod
- Vite
- Replit Plugins
- esbuild
- Stripe
- Card Hedge API
- eBay Browse API
- Goldin Auctions
- ipinfo.io
- WorkOS
- Nodemailer

## Launch Hardening (Feb 2026)

### Rate Limiting
Centralized rate limiter middleware at `server/middleware/rateLimiter.ts` applied to login (10/min/IP), registration (5/5min/IP), game start (15/min), answer submit (15/10sec), checkout (5/min), lobby create (10/min). In-memory store with periodic cleanup.

### Stripe Webhook System (Feb 2026)
Webhook endpoint: `POST /webhooks/purchases`. Signature verification uses direct `stripe.webhooks.constructEvent()` with env var secrets (`STRIPE_WEBHOOK_SECRET_LIVE` / `STRIPE_WEBHOOK_SECRET_TEST`), falling back to stripeSync managed secret, then Stripe API re-fetch as last resort. Global `express.json()` skips `/webhooks/` routes to preserve raw body for signature verification. Error handling: invalid signature = 400, verified events always return 200 (even if internal processing fails). Livemode guard rejects events where `event.livemode` doesn't match the server's Stripe mode. Health endpoint at `GET /webhooks/health` (no auth, no secrets). Admin diagnostics at `GET /api/admin/stripe-diagnostics` includes last 50 webhook events.

### Webhook Retry Worker
`server/services/webhookRetryWorker.ts` scans failed `purchase_events` every 5 minutes, retries with exponential backoff (2^retryCount * 60s), max 5 retries. Admin manual trigger at `POST /api/admin/webhooks/retry`.

### Wallet Reconciliation
`server/services/walletReconciliation.ts` compares SUM(ledger_entries.amount) against cached wallet.balance. Report-only (no auto-fix). Admin endpoint at `POST /api/admin/wallet/reconcile`.

### Health Endpoint
`GET /api/health` (no auth) checks DB connectivity, Stripe mode/config, playable card count, uptime. Returns "ok" or "degraded" status.

### Panic Switches
Admin panic switches via `server/services/panicService.ts` using `feature_flags` table: `disable_purchases`, `disable_pvp`, `disable_set_{id}`. Enforced in checkout and lobby creation routes. 10-second TTL cache. Admin endpoints at `/api/admin/panic/*`.

### Structured Logging
Request ID middleware (`server/middleware/requestLogger.ts`) assigns UUID to every request. Critical path logging for game/payment/auth/admin routes with structured JSON output.

### Audit Documentation
Launch readiness audit documented in `docs/LAUNCH_AUDIT.md` with GO/NO-GO checklist.

### Daily 5 Challenge (Feb 2026)
Daily challenge where all users play the same 5 cards. Uses SHA-256 seeded deterministic card selection with `SECRET_SALT` env var. Challenge auto-creates at 8 PM ET daily (01:00 UTC), 24-hour play window. DB tables: `daily_challenges`, `daily_challenge_cards`, `daily_challenge_entries`. Service at `server/services/daily5Service.ts`. API endpoints: `GET /api/daily5/status`, `POST /api/daily5/start`, `POST /api/daily5/answer`, `POST /api/daily5/finish`, `GET /api/daily5/leaderboard`. Frontend at `/daily5` with countdown, game flow, results, and daily leaderboard. Entry point on home page game modes grid.

### Growth Agent System (Feb 2026)
AI-powered content generation and social media automation system. Controlled by `GROWTH_AGENT_ENABLED` env var (default: false). Core files in `server/services/growth/`. Full documentation at `docs/GROWTH_AGENT.md`. Components:
- **Job Runner** (`jobRunner.ts`): DB-backed job execution with idempotency keys, structured logging to `growth_job_runs` table, and persistent retry queue with exponential backoff (max 3 retries, 2^n * 60s delay). Retry worker scans every 120s for RETRY_PENDING jobs.
- **Scheduler** (`scheduler.ts`): UTC-based daily scheduling with same-day dedup. Ticks every 60s.
- **Circuit Breaker** (`circuitBreaker.ts`): 5 failures in 30 min pauses auto-posting for 30 min cooldown.
- **OpenAI Adapter** (`openaiAdapter.ts`): GPT-4o-mini integration with structured JSON output parsing.
- **Zod Schemas** (`schemas.ts`): Strict Zod validation for all AI-generated content (plans, Discord, Reddit, X thread, Instagram, video scripts, Daily 5 announcements/recaps). All outputs validated before database insertion.
- **Compliance Validator** (`complianceValidator.ts`): Two-pass AI system - generates content, then validates against brand rules (no competitor mentions, no profanity, no false claims). Auto-rewrites once if violations found.
- **Diversity Tracker** (`diversityTracker.ts`): Prevents duplicate hooks within 2 days and repeating player names within 72 hours. Constraints injected into AI prompts.
- **Context Builder** (`contextBuilder.ts`): Enriches prompts with in-app events (yesterday's Daily 5 winners, active card set themes, seasonal moments calendar).
- **Content Jobs** (`contentJobs.ts`): Daily plan generation, content item generation, Daily 5 announcement/recap.
- **Platform Adapters** (`platformAdapters.ts`): Auto-posting to Discord (webhook), X/Twitter (`twitter-api-v2` with OAuth 1.0a), Instagram (Facebook Graph API container→publish flow), and Reddit (OAuth2 script app, 1 post/subreddit/day rate limit, MANUAL_QUEUE by default). TikTok/YouTube use manual publishing queue.
- **Auto Poster** (`autoPoster.ts`): Processes READY items with AUTO posting mode across all configured platforms.
- **X/Twitter secrets**: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`. Supports single tweets and threaded posts (`tweetThread`).
- **Instagram secrets**: `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN`. Uses Graph API v21.0 two-step container→publish. Falls back to PackPTS logo if no image URL in metadata. Caption limit: 2200 chars.
- **Reddit secrets**: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_TARGET_SUBREDDITS` (comma-separated, default: baseballcards), `REDDIT_USER_AGENT`.
DB tables: `growth_content_plans`, `growth_content_items`, `growth_job_runs`, `publishing_queue`.
Admin UI at `/admin/growth` with Overview (includes platform connectivity status and pipeline health), Plans (view/archive/activate), Content, Queue (copy/mark-posted), and Job Logs tabs (with retry status display).
Admin API: `GET /api/admin/growth/overview`, `GET /api/admin/growth/plans`, `PATCH /api/admin/growth/plans/:id`, `GET /api/admin/growth/items`, `GET /api/admin/growth/queue`, `POST /api/admin/growth/queue/:id/posted`, `GET /api/admin/growth/runs`, `POST /api/admin/growth/run-job`, `POST /api/admin/growth/circuit-breaker/reset`.

### Daily 5 Share Card (Feb 2026)
Shareable result card on the Daily 5 results page. Shows score grid (Lucide Check/X icons with colored backgrounds), points, correct count, and rank. Uses Web Share API when available, falls back to clipboard copy. Share text includes text-based grid (`[+]/[-]`) and stats.