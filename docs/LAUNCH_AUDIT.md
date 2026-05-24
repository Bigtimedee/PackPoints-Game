# PackPTS Launch-Readiness Audit

**Date:** February 9, 2026  
**Auditor:** Automated launch-readiness audit  
**Scope:** Full-stack audit of PackPTS before public GTM spend

---

## GO / NO-GO CHECKLIST

| # | Area | Item | Status |
|---|------|------|--------|
| 1 | Payments | Stripe mode host-locked (live on prod only) | PASS |
| 2 | Payments | Checkout validates SKU/price server-side | PASS |
| 3 | Payments | Webhook signature verification | PASS |
| 4 | Payments | Webhook idempotent processing (purchase_events) | PASS |
| 5 | Payments | Webhook retry queue for failed events | PASS |
| 6 | Payments | Ledger immutable, append-only with idempotency keys | PASS |
| 7 | Payments | Wallet reconciliation job | PASS |
| 8 | Payments | Package guardrails (min margin enforcement) | PASS |
| 9 | Payments | Rate limiting on checkout creation | PASS |
| 10 | Gameplay | Match state machine (LOBBY->INIT->ACTIVE->FINISHED/CANCELLED) | PASS |
| 11 | Gameplay | Transactional answer submission with FOR UPDATE locks | PASS |
| 12 | Gameplay | Card image placeholder/silhouette detection (multi-layer) | PASS |
| 13 | Gameplay | Anti-pruning mutation guard with kill switch | PASS |
| 14 | Gameplay | Daily progress tracking with backfill | PASS |
| 15 | Gameplay | Wallet creation on first earn (no silent skip) | PASS |
| 16 | Gameplay | Rate limiting on game start and answer submission | PASS |
| 17 | Security | Admin routes require server-side role check | PASS |
| 18 | Security | Session cookies: httpOnly, secure on prod | PASS |
| 19 | Security | Rate limiting on login and registration | PASS |
| 20 | Security | Stripe keys never exposed client-side | PASS |
| 21 | Security | PII sanitization in response logs (emails, passwords redacted) | PASS |
| 22 | Ops | Health endpoint (/api/health) with DB + Stripe + cards checks | PASS |
| 23 | Ops | Panic switches: disable_purchases, disable_pvp, disable_set | PASS |
| 24 | Ops | Structured logging with request IDs on critical paths | PASS |
| 25 | Ops | Wallet backfill runs on startup (idempotent) | PASS |
| 26 | Ops | Webhook retry worker runs every 5 min | PASS |
| 27 | Admin | Feature flags table with admin toggle | PASS |
| 28 | Admin | Wallet reconciliation admin endpoint | PASS |
| 29 | Admin | Card image validation scheduled (every 6 hours) | PASS |
| 30 | Admin | Set import audit logging | PASS |

**Recommendation: CONDITIONAL GO**

All critical money-safety, gameplay reliability, and security items pass. The system is hardened for launch with the following monitoring in place.

---

## PHASE 1 - PAYMENTS & MONEY SAFETY

### 1.1 Stripe Mode Enforcement
**Status: PASS**

- `server/stripeClient.ts`: `getStripeMode()` checks host against `PROD_HOSTS` array (packpts.com, www.packpts.com)
- `assertLiveModeForHost()` throws error if production host resolves to test mode
- Checkout route calls `assertLiveModeForHost(host)` before creating session
- If live keys missing on production, Stripe returns not-configured error (fails closed)

### 1.2 Checkout Creation
**Status: PASS**

- SKU validated server-side against `products` table and `PRODUCT_DEFINITIONS`
- Price derived from DB/product map, never from client
- Success/cancel URLs constructed from `req.headers.host` (per-environment correct)
- Rate limited: 5 requests/minute per user+IP via `checkoutLimiter`

### 1.3 Webhooks
**Status: PASS**

- Raw body signature verification via `req.rawBody` in express JSON middleware
- `purchase_events` table provides idempotent processing via `eventId` unique constraint
- Failed events tracked with `status='failed'`, `errorMessage`, `retryCount`
- Webhook retry worker scans every 5 minutes with exponential backoff (max 5 retries)
- Admin manual retry: `POST /api/admin/webhooks/retry`
- Handled event types: checkout.session.completed, invoice.paid, subscription.updated/deleted, charge.refunded, charge.dispute.created

### 1.4 Wallet/Ledger
**Status: PASS**

- `ledger_entries` table: immutable, append-only
- Every entry has `idempotencyKey` with unique constraint (prevents double-credit)
- Balance stored as cached value on `wallets` table, updated atomically within transactions
- `SELECT FOR UPDATE` locks prevent race conditions
- All earn/spend/adjust operations are transactional
- Wallet reconciliation job compares SUM(ledger) vs cached balance, reports mismatches
- Admin endpoint: `POST /api/admin/wallet/reconcile`
- Bucket-based point expiration tracking

### 1.5 Guardrails
**Status: PASS**

- `packageGuardrailService.ts`: enforces minimum margin on PackPTS packages
- Admin overrides logged in audit trail
- `marginLedgerService.ts`: tracks per-transaction margins

### 1.6 Fraud/Abuse
**Status: PASS**

- Rate limiting on checkout (5/min), login (10/min), registration (5/5min)
- Checkout requires authenticated + active user
- Risk pipeline tracks auth events, gameplay events with velocity signals
- `userRiskState` and `riskSignals` tables for risk scoring
- User freeze mechanism blocks wallet operations for flagged accounts

---

## PHASE 2 - GAMEPLAY RELIABILITY

### 2.1 Card Serving
**Status: PASS**

- Multi-layer placeholder detection: URL pattern matching, perceptual hash scoring, pixel analysis, dimension checks
- `isPlaceholderImage()` in `imageQuality.ts` blocks known placeholder URLs
- `analyzeImageContent()` in `imageContentAnalyzer.ts` performs deep pixel analysis for silhouettes
- Quarantine flow: suspect cards marked `quarantineStatus` rather than auto-deleted
- Scheduled validation runs every 6 hours

### 2.2 CardHedge Integration
**Status: PASS**

- Caching layer with TTL-based LRU cache
- Rate limiting on CardHedge API calls (120/min admin, 30/min public)
- Error logging with status codes
- Import runs tracked in `set_import_jobs` table

### 2.3 Match State Machine
**Status: PASS**

- States: LOBBY -> INITIALIZING -> ACTIVE -> FINISHED -> CANCELLED
- Database-backed with `SELECT FOR UPDATE` locks for transitions
- `guardCanSubmit()` validates user is participant, match is active, correct question index
- Idempotent answer submission via `clientMsgId`
- WebSocket events for real-time sync between PVP players
- Timeout handling for disconnected players

### 2.4 Daily Progress
**Status: PASS**

- Server-authoritative tracking via `user_daily_progress` table
- HOST/GUEST role assignment in matchService
- Progress applied atomically in `engine.ts` via `applyProgressForMatchIfNeeded`
- Backfill on startup for any missed matches
- Chicago timezone date keys for consistency

---

## PHASE 3 - DATA INTEGRITY & ADMIN

### 3.1 Anti-Pruning
**Status: PASS**

- Mutation guard: `DISABLE_AUTOMATED_SET_MUTATIONS` environment variable
- When enabled, background tasks skip all card mutations
- Only admin-triggered operations allowed
- Audit log entries written for all mutations (including skipped ones)
- `setAuditLog` table tracks actor_type, actor_id, action, reason

### 3.2 Feature Flags
**Status: PASS**

- `feature_flags` table with key, enabled, value, description
- Admin toggle via `adminService.toggleFeatureFlag()`
- Panic switches implemented: disable_purchases, disable_pvp, disable_set_{id}
- 10-second TTL cache to avoid DB hammering

---

## PHASE 4 - SECURITY

### 4.1 Authentication & Authorization
**Status: PASS**

- Multi-provider: WorkOS, local credentials
- Admin routes: `isAuthenticated` + `requireAdmin` middleware (server-side role check)
- Match routes validate session token and user belongs to match
- Session cookies configured with httpOnly, secure flags

### 4.2 Rate Limiting
**Status: PASS**

Implemented via `server/middleware/rateLimiter.ts`:
- Login: 10/min per IP
- Registration: 5/5min per IP
- Game start: 15/min per IP+user
- Answer submit: 15/10sec per IP+user
- Checkout: 5/min per IP+user
- Lobby create: 10/min per IP+user
- Marketplace search: 20/min per IP
- CardHedge search: 120/min per admin user

### 4.3 Data Privacy
**Status: PASS**

- Stripe keys never returned to client (publishable key served via `/api/stripe/config`)
- Auth debug logs mask session IDs (first 8 chars only)
- No raw passwords logged
- Response body logging sanitized via `sanitizeForLog()`: email, password, phone, address, name fields auto-redacted
- Large array responses truncated to `[Array(N)]` to prevent log bloat

---

## PHASE 5 - OBSERVABILITY & RECOVERY

### 5.1 Health Check
**Status: PASS**

`GET /api/health` (no auth required) returns:
- Database connectivity + latency
- Stripe mode (live/test) + configured status
- Playable card count
- Server uptime
- Top-level status: "ok" or "degraded"

### 5.2 Structured Logging
**Status: PASS**

- Request ID middleware assigns 12-char UUID to every request
- Critical path logging: game start/answer, checkout, webhooks, auth, admin operations
- Structured JSON format: `{ rid, method, path, status, ms, userId }`
- Error-level logging for 5xx, warn-level for 4xx

### 5.3 Panic Switches
**Status: PASS**

Admin endpoints:
- `POST /api/admin/panic/purchases` - disable/enable purchases
- `POST /api/admin/panic/pvp` - disable/enable PVP
- `POST /api/admin/panic/set` - disable/enable specific sets
- `GET /api/admin/panic/status` - view all switch states

Enforcement: returns 503 with clear error message when switch is active.

### 5.4 Workers
**Status: PASS**

- Webhook retry worker: every 5 minutes, exponential backoff, max 5 retries
- Image validation: every 6 hours
- Card pool refresh: every 12 hours
- Stale redemption cleanup: every 1 hour
- Wallet backfill: runs on startup (idempotent)
- Daily progress backfill: runs on startup (idempotent)

---

## KNOWN LIMITATIONS / FUTURE WORK

1. **Wallet reconciliation is report-only** - does not auto-fix mismatches. Admin must manually investigate.
2. **Rate limiting is in-memory** - resets on server restart. Acceptable for single-instance deployment.
3. **No automated E2E test suite in CI** - recommend adding Playwright test suite for critical flows.
4. **CardHedge health check** not included in /api/health (would add latency to health checks from external API call).
5. **Email configuration warnings** - app password format should be validated/fixed before launch.

---

## EVIDENCE

### Health Endpoint Response
```json
{
  "status": "ok",
  "timestamp": "2026-02-09T15:10:20.614Z",
  "uptime": 7,
  "checks": {
    "database": { "status": "ok", "latencyMs": 1 },
    "stripe": { "status": "ok", "mode": "test", "configured": true },
    "playableCards": { "status": "ok", "count": 8600 }
  }
}
```

### Server Startup Log (Clean)
```
[Auth] Auth tables verified
[Access] Active user counter verified
[MatchService] Loaded 8600 player names for answer options
[PackageGuardrails] Configuration seeded successfully
[RewardEngine] Active reward policy exists
[RewardEngine] Health check complete
[Stripe] Connection verified - Mode: TEST
[WebhookRetryWorker] Starting worker (interval: 300s)
[WalletBackfill] Found 0 counter records with points > 0
[WalletBackfill] Complete: 0 users, 0 pts credited, 0 ledger entries, 0 errors
```
