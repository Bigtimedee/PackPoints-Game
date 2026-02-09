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
- Zyla API
- eBay Browse API
- Goldin Auctions
- ipinfo.io
- WorkOS
- Nodemailer

## Launch Hardening (Feb 2026)

### Rate Limiting
Centralized rate limiter middleware at `server/middleware/rateLimiter.ts` applied to login (10/min/IP), registration (5/5min/IP), game start (15/min), answer submit (15/10sec), checkout (5/min), lobby create (10/min). In-memory store with periodic cleanup.

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