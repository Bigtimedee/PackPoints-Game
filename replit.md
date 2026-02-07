# PackPoints

## Overview
PackPoints is a card-collecting gaming platform centered on baseball card recognition. It allows users to identify players from card images to earn points, which can be redeemed for credits on platforms like Goldin Auctions and eBay. The platform offers solo, 1v1, and tournament game modes, a global leaderboard, and a marketplace for card listings. Its primary goal is to engage baseball card enthusiasts while implementing robust monetization and retention strategies.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Technologies
The frontend uses React 18, TypeScript, Vite, Wouter for routing, Tailwind CSS, and shadcn/ui, with TanStack React Query for state management. The backend is built with Node.js, Express, and TypeScript, utilizing Drizzle ORM with PostgreSQL and Zod for validation. esbuild handles backend bundling, and WebSockets power real-time features.

### Card Image System
A system sourced from the Card Hedge API manages baseball card images, masking player names during gameplay. This involves server-side image masking using `sharp` and `tesseract.js`, CSS overlay masks, and per-set configurable masks. Images are validated, proxied, and undergo multi-layer content-based placeholder detection via database filtering, server-side image analysis (`sharp` for entropy, color diversity, edge detection), and frontend canvas-based analysis. Player/image mismatch prevention is enforced through image refresh verification, admin tools for detection, and user reporting.

### Anti-Pruning System
This system prevents automated background jobs from unilaterally removing cards from gameplay. It uses a mutation guard with defined operation sources (ADMIN_MANUAL, SYSTEM_NON_DESTRUCTIVE, CARDHEDGE_CONFIRMED), a quarantine flow for suspect cards requiring admin approval, and comprehensive audit logging for all card/set mutations.

### CardHedge Integration Layer
A server-side integration provides API endpoints for card search, details lookup, and visual image search, protecting the API key. It employs a TTL-based LRU cache and includes placeholder detection for image searches.

### Bundle Builder System
An admin tool for creating and managing PackPTS bundles with financial guardrails. It supports bidirectional USD/PackPTS conversion, a ratio system with override capabilities, and robust validation against margin policies. All actions are tracked via audit logging.

### Monetization & Wallet
Features a ledger-first wallet for "PackPTS" with various transaction types, a product catalog, a tiered membership system (Free, Pro, Legend), and a bucket-based point expiration system.

### Authentication & Access Control
Supports multi-provider authentication (Replit Auth, WorkOS, local) with identity linking and magic-link verification. An access control system manages user caps, waitlists, invite codes, and a referral system. Session cookies are configured for security and mobile browser compatibility.

### Admin Tools & Redemption
Comprehensive tools manage users, wallets, entitlements, and feature flags. A closed-loop redemption system converts PackPTS into store credit, requiring admin approval for high-value redemptions.

### Analytics & Geo Intelligence
An event tracking system records user actions, and a privacy-safe geolocation system infers user home states.

### Store & PackPTS Purchase
Integrated with Stripe for one-time bundle purchases and monthly subscriptions. The store dynamically fetches products from the database, supporting custom pricing, sorting, descriptions, and highlighting.

### Financial Guardrails
Ensures profitability for PackPTS packages and redemptions, tracks margins, and prevents fraud through user risk tracking.

### Marketplace
Aggregates listings from eBay and Goldin Auctions, supporting filtering, affiliate tracking, and outbound click logging.

### Non-Linear Reward System
A fame-based point calculation system rewards users based on player obscurity, vintage, and rarity multipliers, with daily and per-match point caps.

### Daily Progress Tracking
Server-authoritative tracking of daily progress, including cards answered and matches completed, synchronized across match modes.

### 1v1 Matchmaking System
Real-time, random matchmaking using a DB-backed atomic pairing process with presence tracking, a ticket queue, and heartbeats.

### Match Lifecycle State Machine
A robust, database-backed state machine (LOBBY → INITIALIZING → ACTIVE → FINISHED/CANCELLED) ensures match integrity, prevents race conditions, and includes audit logging and recovery mechanisms.

### Transactional Answer Submission
Ensures synchronized state during 1v1 matches through database locking, idempotent inserts, and atomic updates, broadcasting `ANSWER_STATUS` events.

## External Dependencies

### Database
- PostgreSQL
- Drizzle Kit

### Frontend Libraries
- Radix UI
- Embla Carousel
- Recharts
- Lucide React
- React Icons

### Backend Libraries
- connect-pg-simple
- express-session
- zod

### Build & Development Tools
- Vite
- Replit Plugins
- esbuild

### Payment & Billing
- Stripe (with production/test mode enforcement via host-based detection)

## Recent Changes

### Stripe Production Hardening (Feb 2026)
- **Host-based mode enforcement**: Production hosts (packpts.com, www.packpts.com) always use LIVE Stripe keys. Test keys are blocked on production.
- **Removed production→development fallback**: The server no longer silently falls back to test keys when production keys are missing. It fails closed with a clear error.
- **Key prefix validation**: sk_live_ required for live mode, sk_test_ for test mode. Mismatched keys cause startup failure.
- **Startup logging**: Server logs clearly show `Stripe mode active: LIVE` or `TEST` and the key prefix on every boot.
- **Checkout logging**: Every checkout/subscribe call logs host, mode, SKU, and key type.
- **GET /api/stripe/config**: Returns `{ mode, publishableKey }` for the frontend to dynamically select the correct publishable key.
- **Fail-closed UI**: If checkout fails due to missing live keys, shows "Payments are temporarily unavailable" instead of falling back to test mode.
- **Webhook enforcement**: Webhook handler validates mode matches host before processing.
- **Smoke tests**: `scripts/stripe-smoke.ts` validates mode selection logic for all host scenarios.
- **Environment variables**: APP_ENV set to "development" for dev, "production" for production deploys. Production credentials are read from `STRIPE_secret` and `STRIPE_publishable` secrets (matching Replit Secrets tab naming). Fallback to `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` or Stripe connector if primary vars are not set.

### Checkout Fulfillment Resilience (Feb 2026)
- **Direct Stripe API fallback**: When the success page polls for checkout status and the DB still shows CREATED, the server queries Stripe's API directly. If the session is complete/paid, it triggers fulfillment immediately rather than waiting for the webhook.
- **Shared idempotency keys**: Both webhook and direct-poll fulfillment paths use the same idempotency key format (`checkout_session_${sessionId}_${priceId}` for wallet credits, `checkout_session_${sessionId}` for entitlements), preventing double-grants regardless of which path runs first.
- **Audit trail**: Direct poll fulfillment records a purchaseEvents entry (`poll_fulfill_${sessionId}`) for full auditability.
- **Subscription safety**: Subscription sessions are marked PAID by direct poll but PackPTS/entitlement grants are deferred to invoice.paid, matching webhook behavior.

### 1v1 Match Resilience Hardening (Feb 2026)
- **DB-authoritative answer submission**: Both WebSocket and HTTP fallback converge on `matchEngine.submitAnswer()` with DB transactions and FOR UPDATE locking. In-memory state is never authoritative.
- **DB-sourced broadcasts**: All match broadcasts (`match_state`, `next_question`, `match_started`) call `matchEngine.buildMatchState()` for authoritative data.
- **Client-side answer deduplication**: `processedAnswerForIdx` ref prevents duplicate UI updates when both WS and HTTP fallback respond.
- **Persistent membershipSecret**: Secret stored in localStorage, persists across page refreshes during active match, cleared only on match end. Auto-reconnect via `onClose` handler re-sends `join_match`.
- **Host disconnect grace period**: Host gets 30-second grace period in lobbies (matching guest behavior). Broadcasts `host_disconnected`/`host_reconnected` events to guest with UI indicator.
- **Auto-submit timeout**: 15-second timer auto-submits wrong answer for disconnected players mid-question. Recursive scheduling for subsequent questions. Cancelled on reconnect. Triple-guarded with DB checks before submitting.
- **Answer rate limiting**: 3 submissions per 2-second window on both WS and HTTP paths. Periodic cleanup prevents memory leaks. Returns `rate_limited` rejection.

### PackPTS Tracking Hardening (Feb 2026)
- **Daily gameplay wallet auto-creation**: `awardDailyBaseForCorrectCard` now creates wallets for new users who don't have one yet, preventing silent point loss on first matches.
- **Bucket creation for daily rewards**: Daily gameplay base rewards now create PackPTS buckets via `bucketService.createBucket(tx)` within the same transaction, ensuring FIFO expiration tracking stays in sync with wallet balances.
- **Frozen-user enforcement**: Daily gameplay base rewards check `isUserFrozen()` before awarding points, matching the guardrail in `walletService.earn()`.
- **FOR UPDATE wallet locking**: Daily gameplay base now uses `FOR UPDATE` on wallet select to prevent race conditions during concurrent answer submissions.
- **Streak earn result checking**: `streakService.claimDailyStreak` now checks `walletService.earn()` result and throws to roll back the entire claim transaction if the wallet credit fails.
- **Stripe fulfillment error tracking**: Unknown SKUs and `purchaseCredit` failures are now logged as `FULFILLMENT_ERROR` and reflected in the purchase event status (failed/partial).
- **Redemption reversal/cancel safety**: `reverseRedemption` and `cancelRedemption` now verify `walletService.earn()` succeeded before marking redemption as REVERSED, preventing status updates without actual refunds.
- **Match engine reward logging**: Improved error context for reward failures including userId, matchId, cardId, and stack traces.

### Redemption Flow Hardening (Feb 2026)
- **Frozen-user check on spend()**: `walletService.spend()` now calls `isUserFrozen()` before debiting, matching the existing guard in `earn()`. Frozen users cannot redeem PackPTS through any path.
- **applyRedemption() pre-checks**: Marketplace redemption now checks user risk state and wallet status before creating margin reservations, preventing reservations for ineligible users.
- **applyRedemption() transaction atomicity**: All 4 mutating steps (create reservation, spend PackPTS, insert redemption credit, update intent status) are wrapped in a single `db.transaction()`. `walletService.spend()` and `treasuryService.createReservation()` accept optional `txOrDb` parameter to participate in outer transactions.
- **redemptionService.redeem() transaction fix**: `walletService.spend()` now receives the outer transaction, so wallet debit and redemption record insert commit atomically. Transaction errors are caught and returned as `{ success: false }` to preserve the API contract.
- **Reservation leak prevention**: Since all steps in `applyRedemption()` are transactional, any failure (including credit insert) automatically rolls back the reservation.

### Third-party APIs
- Card Hedge API
- Zyla API
- eBay Browse API
- Goldin Auctions (integration via admin)
- ipinfo.io
- WorkOS
- Nodemailer