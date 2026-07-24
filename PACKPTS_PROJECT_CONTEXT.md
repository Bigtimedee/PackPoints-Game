# PackPTS Project Context

> **Canonical project brain.** Every future Claude Code session, developer, agent, or AI tool working on PackPTS must read this file before making changes. If your work changes product behavior, architecture, schema, routes, environment variables, payments, fraud controls, marketplace logic, or core assumptions, update this file in the same session.

**Last verified against codebase:** 2026-06-22
**Live URL:** https://packpts.com
**Deployment:** Railway (project `marvelous-freedom`), auto-deploy on `git push main`

---

## 1. Executive Summary

PackPTS is a competitive trading-card recognition game. Users are shown exact digital replicas of real trading cards — vintage baseball, basketball, football, and hockey — with the player's name masked or blurred. The user must identify the player from multiple-choice options and earns PackPTS (points) based on difficulty, rarity, obscurity, card vintage, and player fame.

The game is not trivia. It combines trading-card nostalgia, sports knowledge, competitive real-time gameplay, a virtual-currency economy (PackPTS), a streak/reward system, and an affiliate marketplace where users can spend earned or purchased points toward real cards on eBay and Goldin Auctions.

**Stack:** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui (frontend) · Express.js + TypeScript (backend) · PostgreSQL + Drizzle ORM (database) · WebSocket via `ws` (real-time) · Stripe (payments) · WorkOS (OAuth) · CardHedge API (card catalog) · Railway (hosting).

**Scale:** 144+ database tables, 30+ client pages, 100+ API endpoints, real-time 1v1 multiplayer, an admin dashboard with 20+ views, a fraud/risk pipeline, a wallet with append-only ledger, FIFO point-bucket expiration, affiliate marketplace with margin controls, and an autonomous social-media growth agent.

---

## 2. Product Thesis

Trading cards are one of the most emotionally resonant collectible categories in the world. Hundreds of millions of people grew up opening packs, memorizing player stats, and trading cards with friends. PackPTS taps that nostalgia and transforms it into a competitive, mobile-first game.

**Why this works:**
- The card itself is the emotional center. Seeing a real 1987 Topps card triggers instant recognition and delight.
- Name-masking creates a genuine knowledge challenge — not a generic quiz.
- Points create engagement loops: earn, accumulate, redeem, compete.
- The marketplace connects gameplay to real commerce — users see cards related to what they just played and can use points toward buying them.
- 1v1 matches and daily challenges create social competition and retention.
- The Founders Pass / waitlist / invite system creates exclusivity during early growth.

**Commercial thesis:** Users play free → earn points → want more points → buy bundles → spend points in marketplace (eBay/Goldin affiliate) → PackPTS earns affiliate commissions and retains margin on point sales. Subscriptions add recurring revenue. Mobile (iOS) will add IAP revenue.

---

## 3. Core User Experience

### Account Creation
1. User visits packpts.com or receives a Founders Pass / invite link.
2. Signup requires username, email, password. Invite code may be required if the founders cap is active.
3. WorkOS SSO (Google, etc.) is an alternative auth path.
4. After signup, the user lands on the home page and can immediately play a solo game.

### First Game
1. User selects a game mode (Solo is the default entry point).
2. Chooses a card set (e.g., 1987 Topps Baseball) and number of cards (5, 10, 15, or 20).
3. A card is displayed with the player name masked (blurred/pixelated regions on the card image).
4. Four answer choices are presented.
5. User selects an answer. Correct = PackPTS awarded (animated breakdown showing fame, vintage multiplier, rarity multiplier). Incorrect = 0 points.
6. After all cards, a results screen shows score, accuracy, streak milestones, and a share button.
7. If unauthenticated, a signup modal prompts the user to save their score.

### Ongoing Engagement
- **Daily 5 Challenge:** Same 5 cards for all users each day, with a daily leaderboard.
- **1v1 Friend Match:** Create a lobby with a 6-character join code, share with a friend, compete in real-time via WebSocket.
- **1v1 Random Match:** Join a matchmaking queue, get paired with a random opponent.
- **Streaks:** Daily play maintains a streak; milestones grant bonus points; freeze tokens protect streaks.
- **Leaderboard:** Global all-time and daily rankings.
- **Marketplace:** Browse eBay/Goldin listings contextually matched to gameplay; redeem PackPTS as discounts.
- **Store:** Purchase PackPTS bundles or subscriptions via Stripe.
- **Profile:** View stats, level, achievements, Founders Pass status, streak calendar.

---

## 4. Core Gameplay Loop

```
Select Mode → Receive Card (masked) → View Answer Options → Submit Answer
     ↓                                                           ↓
  Choose set/count                                    Correct? → Award PackPTS
                                                      Wrong?  → 0 points
     ↓                                                           ↓
  Next Card ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ←
     ↓ (last card)
  Results Screen → Update wallet, stats, leaderboard, streak
     ↓
  Share / Rematch / Marketplace / Home
```

**Key invariants:**
- The player name is never visible before the answer is submitted.
- Points are calculated server-side using the reward engine (fame score, vintage multiplier, rarity multiplier, policy caps).
- Each answer submission is idempotent (unique constraint on matchId + userId + questionIndex).
- Daily and per-match point caps are enforced server-side.

---

## 5. Game Modes

### Solo Play
- **Status:** Implemented
- **Flow:** Select card set → select card count (5/10/15/20) → play through cards → results screen
- **Scoring:** Server-side reward engine; base points inversely proportional to player fame; vintage and rarity multipliers applied; per-match cap of 1,000 pts; daily cap of 5,000 pts (configurable via `rewardPolicy` table)
- **Fairness:** Answer options are generated server-side from the card set's player pool; 4 choices per question
- **Known gaps:** No adaptive difficulty (ELO-based card selection is planned, not implemented)

### Daily 5 Challenge
- **Status:** Implemented
- **Flow:** Once per day, all users get the same 5 cards. Play, submit scores, see daily leaderboard.
- **Scoring:** Same reward engine; max 250 pts per Daily 5 session (configurable via `DAILY5_MAX_POINTS`); minimum answer time of 15s enforced to prevent botting
- **Fairness:** Same cards for everyone; new-account detection (accounts < 7 days old may have restrictions)
- **Known gaps:** Timezone handling for "day" boundary uses `DAILY5_TZ` (defaults to America/New_York)

### 1v1 Friend Match
- **Status:** Implemented
- **Flow:** Host creates lobby → gets 6-char join code → shares with friend → friend joins → host starts match → both play same cards in real-time via WebSocket → results
- **Scoring:** Both players see the same questions. Points are awarded per correct answer. Winner determined by score (or correct count as tiebreaker).
- **Real-time:** WebSocket messages: `start_match`, `submit_answer`, `ready_next`, `match_resync`, `rematch_vote`
- **Battle Sessions:** Multiple consecutive matches tracked as a series (wins/losses/ties across rematches)
- **Known gaps:** Host disconnect has 30s grace period; guest disconnect is immediate leave

### 1v1 Random Match
- **Status:** Implemented
- **Flow:** User joins matchmaking queue → paired with random opponent → match plays identically to friend match
- **Fairness:** No ELO-based matchmaking yet. `playerRatings` table exists with ELO fields (default 1200, tiers: BRONZE through LEGEND) but matchmaking does not filter by rating.
- **Known gaps:** Queue may have low population; no timeout/fallback to AI opponent

### Wager Matches
- **Status:** In progress (not complete)
- **Flow:** Lobbies and matches have a `wagerAmount` field. `POST /api/wager/validate` exists. `wagerSettled` boolean on matches.
- **Known gaps:** Full wager settlement logic and UI are still in progress. Do not treat as a working feature.

### Tournament / Pack-Opening
- **Status:** Not implemented (UI shows "coming soon" badge on home page)
- **Planned:** Tournament brackets, pack-opening card-reveal animations

---

## 6. Card Data Model and Content Rules

### Primary Card Tables

**`playableCards`** — The active card table for gameplay (imported from CardHedge API)
| Field | Type | Purpose |
|-------|------|---------|
| id | varchar PK | UUID |
| gameSetId | FK → gameSets | Which card set this belongs to |
| cardhedgeCardId | text, unique | External ID from CardHedge |
| description | text | Full card description |
| player | text | Player name (used for answer matching) |
| set | text | Card set name |
| number | text | Card number in set |
| variant | text | Card variant (base, refractor, etc.) |
| imageUrl | text | URL to card image |
| category | text | Sport category |
| rookie | boolean | Rookie card flag |
| isPlayable | boolean | Whether card is active for gameplay |
| blockedReason | text | Why card was disabled |
| imageReviewStatus | varchar | unreviewed / reported / approved / rejected |
| reportCount | integer | User reports count |
| imageRotation | integer | 0, 90, 180, 270 degrees |
| quarantineStatus | varchar | OK / SUSPECT_TRANSIENT / SUSPECT_PERSISTENT / QUARANTINED_ADMIN_REVIEW |
| contentVerified | boolean | Admin content verification |
| validationFailCount | integer | Image URL validation failures |
| rawImagesOnly | boolean | Whether to use raw (unprocessed) images |

**`baseballCards`** — Legacy card table (effectively dead for active gameplay; exists only as a fallback if `playableCards` is empty, for backward compatibility, and for legacy admin image validation. Candidate for deprecation — but fallback code paths in `matchService.ts`, `maskingService.ts`, and `storage.ts` should remain defensive until removal is deliberate.)
| Field | Type | Purpose |
|-------|------|---------|
| id | varchar PK | UUID |
| playerName | text | Player name |
| team | text | Team name |
| position | text | Player position |
| year | integer | Card year |
| setName | text | Card set |
| cardNumber | text | Card number |
| imageUrl | text | Card image URL |
| popularity | integer | 0-100 popularity score |
| isPlayable | boolean | Active flag |
| imageVerified | boolean | Image verification status |

**`gameSets`** — Card set definitions
| Field | Type | Purpose |
|-------|------|---------|
| id | varchar PK | UUID |
| sport | text | baseball, basketball, football, hockey |
| brand | text | Card manufacturer (Topps, Fleer, etc.) |
| year | integer | Card year |
| setName | text | Set name |
| league | text | League (MLB, NBA, NFL, NHL) |
| isActive | boolean | Whether set is available for play |
| marketplaceKeywords | jsonb | Keywords for marketplace matching |
| cardhedgeSetQuery | text | Query string for CardHedge import |
| cardsImportedCount | integer | Cards imported from CardHedge |

### Content Rules
- Card images are sourced from CardHedge API and served via their CDN URLs.
- Images are validated on a 6-hour cycle: URL accessibility, content-type checks, color diversity analysis (detects blank/placeholder images).
- Cards with failed validation are quarantined progressively: OK → SUSPECT_TRANSIENT → SUSPECT_PERSISTENT → QUARANTINED_ADMIN_REVIEW.
- Users can report cards (wrong sport, wrong player, bad image, upside down, multi-player). Reports increment `reportCount` and are reviewable in admin.
- Card images may need rotation (stored in `imageRotation`).
- `rawImagesOnly` flag controls whether to use raw vs. processed card images from CardHedge.

### Planned Fields (not yet in schema)
- Explicit difficulty score per card
- Machine-learning-derived masking difficulty rating
- Card condition/grade metadata

---

## 7. Name Masking and Anti-Spoiler Rules

### ⚠️ MISSION CRITICAL — READ THIS SECTION BEFORE TOUCHING CARD DISPLAY CODE ⚠️

The entire game depends on the player not knowing who is on the card before submitting their answer. Any leak — visual, textual, or metadata — destroys the gameplay experience.

### How Masking Works Today
- **Client-side canvas masking:** The `MaskedCardImage` component applies blur/pixelate effects to configurable rectangular regions on the card image. Mask regions are defined per card set in the `cardSetMasks` table.
- **Name-band rendering is pure blur (2026-07-06):** In `GameCard.tsx` (the card renderer used by solo, Daily 5, and 1v1 match), the bottom name-band region (index 1) always renders as a heavy `backdrop-filter: blur(24px)` with a neutral dark-slate tint (`rgba(15, 23, 42, 0.2)`) and the "WHO IS THIS PLAYER?" label — regardless of whether the region's configured `type` is `solid` or `blur`. The previous amber/orange gradient (`amber-600→800`) and orange-brown tint (`rgba(120, 53, 15, 0.4)`) were removed for UX quality. Server-side baked blur (`server/masking/maskCardImage.ts`, sigma 25) remains the anti-cheat backstop; the client blur is presentational.
- **Image validation:** Canvas-based analysis checks color diversity and dominant color percentage to detect blank/silhouette placeholder images that shouldn't be served.
- **Card replacement:** If an image fails to load or is detected as a placeholder, the client requests a replacement card from the server (`POST /api/game/session/:id/replace-card` or WebSocket `question_replace_request`). Maximum 2 replacements before skipping.

### What Must NEVER Happen
1. **Player name visible in card image** before answer submission (masking regions must fully cover all name text on the card).
2. **Player name in image filename or URL** accessible to client before answer submission.
3. **Player name in API response** for the question payload before answer submission — the `correctAnswer` field must not be sent to the client until after the answer is submitted.
4. **Player name in HTML alt text, title, aria-label**, or any other DOM attribute.
5. **Player name in browser network tab** (API responses for questions must not include the answer).
6. **Player name in console logs** on the client side.
7. **Player name derivable from answer option ordering** (options must be randomized).

### Where Leaks Can Occur
- Card image URL containing the player name (e.g., `/images/mike-trout-1987-topps.jpg`)
- API response for "get next question" including the correct answer
- Client-side state or React Query cache exposing answer data
- Image EXIF metadata containing player info
- Card set masking regions not covering the name on certain card layouts
- Browser accessibility tree exposing hidden text

### Required Safeguards
- Server must send questions with answer choices but NOT identify which is correct until after submission.
- Mask regions must be verified per card set — different sets have names in different positions.
- Any new card set import must include mask configuration before cards become playable.
- Image URLs should be opaque (CardHedge IDs, not player-name-based filenames).

### P0 Masking Leak Found and Fixed (Prompt 9)

**Root cause:** `GET /api/game/session/:id`, `POST /api/game/start`, `POST /api/game/next`, and `POST /api/game/session/:id/replace-card` were returning the full `GameSession` object, which includes `correctAnswer` and `card.playerName` on **every question** in the session. Any user could open DevTools and see all correct answers before submitting a single answer.

**Fix:** `server/utils/questionSanitizer.ts` exports `sanitizeQuestionForClient()` and `sanitizeSessionForClient()`. These strip `correctAnswer` and `card.playerName` from all question payloads. Applied at all 6 API response sites in `routes.ts`. The `POST /api/game/answer` response still sends `correctAnswer` at the **top level** (intentional post-submission reveal). The session embedded in that response is sanitized.

**Client change:** `game.tsx` no longer reads `currentQuestion.correctAnswer` (which is now absent). Instead, `revealedCorrectAnswer` state is populated from `data.correctAnswer` in `submitAnswerMutation.onSuccess`.

**New shared types:** `ClientGameQuestion` and `ClientGameSession` in `@shared/schema` (type-only exports — no schema/table changes). The 1v1 REST match state endpoint (`GET /api/matches/:matchId/state`) was also fixed.

### DEFAULT_MASK_REGIONS Geometry — DO NOT REVERT

`DEFAULT_MASK_REGIONS` in `shared/schema.ts` is **`yPct:54, hPct:46`** (covers bottom 46%, from 54% to 100% of card height). It was intentionally extended from `yPct:82, hPct:18` because:

- Vintage Topps cards (1987 Topps, etc.) have a team-color band occupying roughly **yPct:54–92**. The player's name sits in this band at ~yPct:65–80.
- The old `yPct:82` mask only covered the very bottom edge — the name was fully visible in the orange/colored band above it.
- The new `yPct:54` mask covers the entire team-color band and the name.

**Never reduce `yPct` below 54 or `hPct` below 46 in `DEFAULT_MASK_REGIONS` without verifying the player name is still covered on all active card sets.**

The test `"DEFAULT_MASK_REGIONS is a single bottom band at yPct:54, hPct:46"` in `server/tests/masking.test.ts` enforces this. It will fail CI if the values regress.

### "WHO IS THIS PLAYER?" Band Is Unconditional — DO NOT Move Back Into regions.map()

The "WHO IS THIS PLAYER?" blur overlay in `GameCard.tsx` is rendered **outside** the `regions.map()` loop, anchored unconditionally to `bottom: 0, height: 46%` with `zIndex: 21`. It is **not** driven by mask region config.

**Why:** `DEFAULT_MASK_REGIONS` defines only one region (index 0). When the name band text was gated behind `{index === 1 && ...}` inside the map, any set using the default config (or any single-region custom config) silently dropped the overlay, exposing the player's printed name on the card image below. This was a data-exposure bug.

**Rule:** The name band must always render when `!isRevealed && !imageError` regardless of how many mask regions are configured. It is not a cosmetic region — it is a security invariant. The `regions.map()` renders cosmetic set-label overlays only; the name band stands alone.

### Chrome backdropFilter + maskImage Compositing Bug — DO NOT USE

**Never combine `backdropFilter` and `mask-image` (or `WebkitMaskImage`) on the same DOM element in the card overlay.** Chrome's compositor fails to render `backgroundColor` when both are present, causing the underlying card art (which may be vivid orange/red for certain team-color cards) to bleed through even an opaque `rgba` background. The fix is a simple solid `backgroundColor: "#0a0e16"` with no `backdropFilter` at all. This was debugged across multiple deploys in June 2026.

Files affected: `client/src/components/GameCard.tsx` and `client/src/components/MaskedCardImage.tsx`.

### Automated Masking Tests (server/tests/masking.test.ts — 33 tests)

Added in Prompt 9, extended through June 2026. These run in CI and guard:
- `sanitizeQuestionForClient` strips `correctAnswer` and `card.playerName`, preserves all other fields
- `sanitizeSessionForClient` strips both from every question in a session, preserves session metadata
- Does NOT mutate the original question/session (server-side state intact for answer checking)
- Correct answer appears exactly once in the options list
- Options are randomized (not always in a fixed position)
- Post-submission reveal contract: top-level `correctAnswer` in answer response, absent inside `session.questions`
- Replacement card masking: `replace-card` endpoint also sanitizes

### Automated Reward Engine Tests (Prompt 10)

Two test files added covering the entire reward computation stack:

**`server/tests/rewardEnginePure.test.ts` (30 tests — no DB required, runs anywhere):**
- `computeBasePts`: fame=0→maxPts(200), fame=1→minPts(100), fame=0.5→175, extremes clamped, result always integer
- `getVintageMultiplier`: all 4 year buckets (pre-1980: 1.15; 1980-1999: 1.05; 2000-2019: 1.0; 2020+: 0.9) + undefined→1.0
- `getRarityMultiplier`: base→1.0, insert→1.1, parallel→1.2, sp→1.3, unknown→1.0, undefined→1.0
- `computeFinalPts`: maxAwardCap clamp (200×1.15×1.3=299→250), minPts floor (30→100), integer result
- Uses `vi.mock('../db')` to neutralize the DATABASE_URL guard at module load time

**`server/tests/rewardEngine.test.ts` (6 tests — requires CI DATABASE_URL):**
- Frozen user: `awardPoints` returns `finalPts=0`, `capped=true`, `cappedReason` matches `account_frozen`
- Idempotency: second call with same matchId+questionId returns `null`
- Daily cap reached: pre-populate `userPointsCounters` at 5000 → `daily_cap_reached`
- Daily cap partial: 10 pts remaining → award trimmed, `daily_cap_partial` reason
- Match cap reached: pre-populate `matchPointsCounters` at 1000 → `match_cap_reached`
- Normal award: `finalPts` in `[100, 250]`, `capped=false`

### Test Cases Future Agents Must Run Before Changing Card Display Logic
1. Load a game and inspect the network tab — verify no API response contains the correct answer before submission. (Automated: masking.test.ts)
2. Inspect the DOM — verify no element contains the player name before answer submission. (Playwright — deferred, requires TEST_BASE_URL)
3. Verify mask regions fully cover the name area for each active card set.
4. Test card replacement flow — verify replacement card also has proper masking. (Automated: masking.test.ts)
5. Test with browser dev tools — verify no console output reveals the answer.
6. Test image loading failure path — verify fallback/skip behavior doesn't reveal the answer.

---

## 8. Scoring and PackPTS Economy

### How Points Are Earned

Points are calculated by the **reward engine** (`server/services/rewardEngine.ts`) using a policy-driven system stored in the `rewardPolicy` table.

**Formula (as implemented in `computeBasePts`):**
```
basePts = minPts + (maxPts - minPts) × (1 - fameScore^gamma)
vintageMultiplier = lookup by card year (pre-1980: 1.15, 1980-1999: 1.05, 2000-2019: 1.0, 2020+: 0.9)
rarityMultiplier = lookup by card variant (base: 1.0, insert: 1.1, parallel: 1.2, sp: 1.3)
finalPts = clamp(round(basePts × vintageMultiplier × rarityMultiplier), minPts, maxAwardCap)
```

**Note:** The formula uses `1 - fame^gamma` (not `(1-fame)^gamma`). Both satisfy boundary conditions (fame=0→maxPts, fame=1→minPts) but produce different curves — the implemented formula is steeper at low fame values.

**Default policy values:**
| Parameter | Default | Purpose |
|-----------|---------|---------|
| minPts | 100 | Minimum points for a correct answer (famous player) |
| maxPts | 200 | Maximum points for a correct answer (obscure player) |
| gamma | 2.0 | Curve steepness for fame-to-points mapping |
| maxAwardCap | 250 | Hard cap per single answer |
| dailyPointsCap | 5,000 | Maximum points earnable per day through gameplay |
| perMatchPointsCap | 1,000 | Maximum points earnable in a single match |

### Fame Score
- Stored in `playerFame` table per player (0.0 to 1.0 scale).
- Higher fame = fewer points (Mike Trout ≈ 0.9 fame → ~100 pts; obscure 1950s player ≈ 0.1 fame → ~180 pts).
- Fame scores are derived from `internalPlayerStats` (attempt/correct ratios across all users) and external sources.
- Default fame if unknown: 0.5.

### Streaks
- Daily play streaks tracked in `streakState` table.
- Configurable reward schedule in `streakRewardConfig` (JSON schedule of points per streak day + milestone bonuses).
- Streak freeze tokens can be purchased with PackPTS to protect a streak.
- Streak claims are append-only (`streakClaimLog`) with idempotency keys.

### Daily Caps
- **Gameplay rewards:** `rewardPolicy.dailyPointsCap` (default 5,000)
- **Streak rewards:** `streakRewardConfig.dailyCap` (default 250)
- **Card answers per day:** `DAILY_GAMEPLAY_BASE.CARDS_MAX_PER_DAY` = 200
- **Daily 5 max:** 250 pts per session
- Enforcement: `userPointsCounters` table tracks `pointsAwardedToday` per user per date.

### Abuse Prevention (Implemented)
- Rate limiting on answer submissions (3 answers per 2 seconds per user)
- Match tokens (`matchTokens` table) with anti-cheat validation: token signature, max points cap, expiration
- Idempotency on all point awards (`pointsAwards.idempotencyKey` unique constraint)
- Server-side scoring only — client never calculates points
- Minimum answer time for Daily 5 (15 seconds)

---

## 9. Wallet, Ledger, and Points Accounting

### Wallet Table
Each user has one wallet (`wallets` table):
- `balance` — current available PackPTS
- `lifetimeEarned` — total PackPTS ever earned
- `lifetimeSpent` — total PackPTS ever spent
- `status` — `active`, `frozen`, `suspended`

### Ledger (Append-Only)
Every point change is recorded in `ledgerEntries`:
- `entryType`: EARN, SPEND, ADJUST, PURCHASE_CREDIT, REVERSAL, STREAK_EARN, EXPIRE
- `source`: gameplay, purchase, admin, redemption, adjustment, streak
- `amount`: positive for credits, negative for debits
- `balanceAfter`: wallet balance after this entry
- `idempotencyKey`: unique — prevents duplicate entries
- `refType` + `refId`: links to source record (match, purchase, redemption, etc.)
- `metadata`: JSON for additional context

### FIFO Point Buckets
Points are tracked by source and expiration in `packptsBucket`:
- `sourceType`: EARNED, PURCHASED, BONUS, ADJUSTMENT
- `originalAmount` / `remainingAmount`: bucket balance
- `expiresAt`: when points expire
- `status`: OPEN, DEPLETED, EXPIRED

When points are spent, the `packptsSpendAllocation` table records which buckets were drawn from (FIFO — oldest first).

### Expiration Policy
Configurable in `packptsExpirationPolicy`:
- Earned points: 365 days to expire (default)
- Bonus points: 90 days to expire (default)
- Purchased points: no expiration by default
- Grace period: 7 days
- Inactivity clawback: disabled by default (configurable)

### Liability Snapshots
`packptsLiabilitySnapshot` records daily accounting snapshots:
- Total outstanding points by source type
- Aging buckets (0-30d, 31-90d, 91-180d, 181-365d, 366+)
- Breakage estimate (default 25%)
- Used for financial reporting and risk monitoring

### Fraud Holds
- Wallet `status` can be `frozen` or `suspended` by admin or risk pipeline.
- `walletService.earn()` checks `isUserFrozen()` before awarding any points.
- Risk state tracked in `userRiskState` table.
- Frozen wallets cannot earn, spend, or redeem.

### What Exists vs. What's Needed
| Feature | Status |
|---------|--------|
| Wallet with balance tracking | ✅ Implemented |
| Append-only ledger | ✅ Implemented |
| Idempotency on all entries | ✅ Implemented |
| FIFO bucket expiration | ✅ Implemented + scheduled. `server/services/expirationEngine.ts` (`runExpirationJob()` and `runInactivityExpiration()`); admin endpoint `POST /api/admin/expiration/run`; standalone script `server/jobs/runExpiration.ts`. Daily date-based run wired into pgJobQueue via `scheduleRecurringJob('packpts_expiration', …)` in `server/index.ts`, runs at `EXPIRATION_RUN_HOUR_UTC` (default 6 UTC = 1 AM EST). Set `EXPIRATION_ENABLED=false` to disable. Inactivity expiration is not yet on a recurring schedule. |
| Liability snapshots | ✅ Schema exists |
| Chargeback reversal | ⚠️ Schema supports it (REVERSAL entry type), but automated Stripe chargeback → reversal flow needs verification |
| Multi-currency support | ❌ Not implemented (USD only) |
| Real-time balance websocket push | ❌ Not implemented |

---

## 10. Payments and PackPTS Purchases

### Stripe Integration (Implemented)
- **Client:** `stripeClient.ts` configures Stripe with live/test key switching based on `APP_ENV` or `NODE_ENV`.
- **Checkout flow:** `POST /api/checkout` creates a Stripe Checkout Session → user redirected to Stripe → webhook `checkout.session.completed` processes fulfillment.
- **Webhook handling:** `POST /api/stripe/webhook` verifies signature, processes events. `purchaseEvents` table stores all webhook events with idempotent `eventId`.
- **Products:** Stored in `products` table with `stripePriceId` linking to Stripe. Types: CONSUMABLE (point bundles), ENTITLEMENT, SUBSCRIPTION.
- **Subscriptions:** `subscriptionProducts` table, monthly/yearly billing, Stripe recurring.
- **Customer mapping:** `stripeCustomers` table links users to Stripe customer IDs.
- **Checkout sessions:** `stripeCheckoutSessions` tracks session lifecycle (CREATED → PAID / CANCELED / EXPIRED).

### PackPTS Bundles (from products table / productMap)
Env-var-configured Stripe price IDs:
- `STRIPE_PRICE_PACKPTS_500` — 500 PackPTS bundle
- `STRIPE_PRICE_PACKPTS_1500` — 1,500 PackPTS bundle
- `STRIPE_PRICE_PACKPTS_6000` — 6,000 PackPTS bundle
- Monthly subscriptions: 500, 2000, 5000 PackPTS/month
- Pro and Legend tiers with entitlements

### Store Fee Profiles
`storeFeeProfiles` table tracks per-channel fee structures:
- `web_stripe`: 2.9% + $0.30
- `ios_iap`: platform fee rate (30% Apple)
- `android_iap`: platform fee rate

### Margin Guardrails
Products have `guardrailsStatus` (PASS, WARN, BLOCK, OVERRIDE) and `guardrailsJson` computed from `profitPolicy`:
- Minimum margin: 25% (default `minMarginM`)
- PackPTS value: $0.002 per point (default `packptsValueVMicrousd` = 2000)
- Ratio tracking: `ratioUsdPerPackptMicro` / `ratioPackptPerUsdMicro` per product

### iOS In-App Purchase (Planned/Partially Implemented)
- `appleTransactions` table stores verified IAP receipts
- `POST /api/purchases/verify-apple` endpoint exists for server-side receipt verification
- StoreKit 2 integration planned for native iOS app (see iOS Adaptation Plan)
- Apple's 30% fee factored into `storeFeeProfiles`

### What Must Be Tested Before Launch
- Stripe webhook idempotency (replay same event → no duplicate credit)
- Checkout session expiration handling
- Subscription renewal and cancellation
- Chargeback handling (disputed payment → point reversal)
- Product guardrail enforcement (block sale if margin < threshold)
- Test/live key switching

---

## 11. Marketplace and Affiliate Commerce

### Purpose
The PackPTS Marketplace lets users spend earned or purchased PackPTS toward real trading cards listed on eBay and Goldin Auctions. PackPTS acts as a discount/credit — users still pay the remaining balance in USD via the external marketplace.

### How It Works
1. User plays games → earns PackPTS → visits `/marketplace`.
2. Marketplace shows listings from eBay and Goldin, contextually matched to the user's recent gameplay (card sets, players, teams, years).
3. User selects a listing → system calculates maximum redeemable PackPTS based on profit policy.
4. `externalPurchaseIntent` is created with: listing price, computed max redemption (`computedRmax`), requested PackPTS spend.
5. On approval, `redemptionCredit` is issued: PackPTS deducted from wallet, credit token generated.
6. User clicks through affiliate link to complete purchase on eBay/Goldin.

### Affiliate Integration
**eBay Partner Network (EPN):**
- Outbound links built with EPN tracking parameters: `campId`, `customIdPrefix`, `mkcid`, `mksid`
- `GET /out/ebay/:listingId` generates signed outbound URL with HMAC token (1-hour expiry)
- Click tracking in `outboundClicks` table (source, listing, user, IP hash, referrer, page path, card context)

**Goldin Auctions:**
- Admin-curated listings only (`goldinCuratedListings` table) — no live API integration, and none is planned
- Listings are manually managed by admin with end-time countdown display

**Marketplace caching:** `marketplaceCache` table caches search results per source with TTL.

### Margin Rules
`profitPolicy` table (versioned, time-effective):
- `minMarginM`: 25% of the affiliate margin retained by the business (NOT 25% of price)
- `affiliateRateA`: 2% (eBay affiliate commission)
- `affiliateHaircutH`: 70% (what % of affiliate revenue funds redemptions)
- `packptsValueVMicrousd`: $0.002 per PackPTS

**Meaningful discounts + solvency model (July 2026).** The affiliate Rmax formula alone caps credit at ~1% of price. Redemption credit is now the **minimum** of four ceilings, computed in `profitGuardrailService.createQuote`:
1. **Meaningful ceiling** — `maxDiscountPct × price` (default 15%). The headline generosity dial.
2. **Solvency ceiling** — `availableMarginPool + thisTxMargin`. Credit is only ever paid from the funded reserve (`margin_ledger` net of `margin_usage`/reservations), so aggregate payouts can never exceed funded dollars. This is the hard solvency guarantee.
3. **Per-user velocity** — `perUserDailyCreditCents` ($25/day) and `perUserWeeklyCreditCents` ($100/week), summing PENDING+GRANTED credit in rolling windows.
4. **Minimum** — offers below `minRedemptionPackpts` (500) show ineligible.
Plus a **reserve-floor kill switch** (`reserveFloorCents`): if the funded reserve drops below the floor, all redemptions pause. All five knobs live on `profit_policy` and are set via `POST /api/admin/profit-policy`.

**To enable meaningful discounts in production:** fund the reserve with a real marketing budget via `POST /api/admin/treasury/credit` (sourceType `MANUAL_ADJUSTMENT`). Until funded, discounts stay bounded to ~1% per-transaction affiliate margin. The code guarantees payouts never exceed the funded reserve, so generosity scales only with real dollars deposited — insolvency is impossible by construction.

**Solvency invariant** — `treasuryService.getSolvencyStatus()` / `GET /api/admin/treasury/solvency`: dollar-denominated outstanding PackPTS liability (`SUM(wallets.balance) × packptsValue`) vs funded reserve, with coverage ratio. This is the number to watch.

**Redemption fraud gates (hardened July 2026):** the marketplace `applyRedemption` risk-state check is now **fail-closed** (a risk-read error denies, not allows); high-value confirms (≥$25 credit) are held at `PURCHASE_CONFIRMED` for admin review via `POST /api/admin/redemption/intents/:id/grant` instead of auto-granting; the tier `POST /api/redeem` path now blocks frozen users (it previously did not).

**Earning-side liability guard (July 2026):** a hard `PTS_MAX_PER_CARD = 500` ceiling is applied AFTER the Set-of-the-Week multiplier (`dailyGameplayBase.ts`) — previously the 250 per-card cap was applied before the multiplier, so a featured card could pay `250 × setMultiplier` unbounded. The dormant `riskEngine.runPeriodicScan` (collusion / bot / high-volume auto-freeze) is now scheduled hourly via `server/services/riskScanWorker.ts`.

**Rmax formula (corrected July 2026):** `Cmax = (h·A·P·(1−m) − f)/(1+r)`. The original formula `((h·A − m)·P − f)` treated `m` as a fraction of PRICE — negative for every real affiliate rate, so Rmax was permanently 0 and no eBay redemption could ever grant credit; a unit test even asserted the always-zero behavior as correct. At the default policy a $100 listing now yields Rmax 525 PackPTS ($1.05 credit). Note the profit policy is a DB row — after the July 2026 data loss it had to be recreated via `POST /api/admin/profit-policy` with the documented defaults.

`marketplaceMarginConfig` table allows per-source overrides (eBay vs. Goldin haircut rates).

### Redemption Flow
1. `POST /api/redemption/calculate` — estimate PackPTS → USD value for a given listing
2. `POST /api/redeem` — execute redemption (minimum 1,000 PackPTS; admin review required if USD value ≥ threshold)
3. `redemptionCredit` record created → wallet debited via ledger → credit token generated
4. `POST /api/redemption/validate-token` / `consume-token` — verify and apply credit

### ⚠️ Affiliate Attribution Warning
Affiliate redirect URLs and marketplace links MUST preserve tracking parameters. Any change to outbound URL construction, the `/out/ebay/:listingId` route, or the EPN parameter assembly must be tested to confirm affiliate attribution is not broken. Lost attribution = lost revenue.

### Attribution Loop (Prompt 15 — complete)
Full funnel instrumented: card_view → outbound_click → affiliate postback → attributed_purchase.
- **card_views** table: logged via `POST /api/attribution/card-view`. Captures userId, cardId, cardSetId, sessionId, ipHash, userAgent, pagePath, viewDurationMs.
- **outbound_clicks** table: existing, written on `/out/ebay/:listingId` redirect with EPN customId.
- **attributed_purchases** table: written by `GET /api/webhooks/epn-postback` when eBay EPN sends conversion confirmation. Links `customId` → `outbound_clicks.id` → `users.id`. Idempotent via unique constraint on `transaction_id`.
- EPN customId format: `packpts:u_<userId12>:i_<itemId16>:t_<timestamp>` — ties postback back to click.

---

## 12. Matchmaking and 1v1 Gameplay

### Architecture
- **Lobbies:** Created via REST (`POST /api/lobby/create`), joined via join code. Stored in `lobbies` table.
- **Matches:** Created when host starts game. Stored in `matches` table with full lifecycle: LOBBY → INITIALIZING → ACTIVE → FINISHED / CANCELLED.
- **Battle Sessions:** `battleSessions` table tracks multi-match series between two players (wins, losses, ties, rematch flow).
- **Participants:** `matchParticipants` table tracks each player's state in a match (score, correctAnswers, connection status, last seen).
- **Questions:** `matchQuestions` table stores per-match card assignments with point values and seed versioning.
- **Answers:** `matchAnswers` table with unique constraint on (matchId, userId, idx) preventing double-submission.

### WebSocket Flow
1. Client connects to `/ws`, authenticates via session cookie or `auth` message.
2. **Queue:** `join_queue` → server pairs two users → creates lobby + match → sends `match_found`.
3. **Lobby:** `join_lobby` → `set_lobby_card_set` → `start_match` (host only).
4. **Match:** `submit_answer` → server validates, records, broadcasts → `ready_next` → next question or finish.
5. **Rematch:** `rematch_vote` (both must accept) → new match in same battle session.

### Card Selection
- Cards drawn from `playableCards` filtered by the selected `gameSet`.
- Previously used cards in a match tracked in `matchUsedCards` to avoid repeats.
- If a card's image fails, `question_replace_request` triggers server-side replacement (tracked via `replacedCount` on `matchQuestions`).

### Disconnect Handling
- **Heartbeat:** Clients send periodic heartbeats; server tracks `isConnected` and `lastSeenAt` on participants.
- **Lobby disconnect:** Host gets 30-second grace period to reconnect; guest disconnecting immediately removes them.
- **Match disconnect:** 60-second grace period, after which the disconnected player auto-forfeits.
- **Battle session disconnect:** Immediate end, no reconnect.

### Fairness
- Both players see identical questions in the same order.
- Answer submissions are timestamped server-side.
- Rate limiting prevents rapid-fire answer spam (3 per 2 seconds).
- Match tokens provide anti-cheat validation.

### Daily Quotas
`dailyQuotas` table tracks matches started/completed per user per day per mode. Configurable limits can be enforced to prevent match grinding.

### Known Issues
- No ELO-based matchmaking filtering (schema exists, logic not wired to queue)
- No AI fallback opponent if queue is empty
- Wager settlement logic may be incomplete

---

## 13. User Accounts and Authentication

> **Verified 2026-06-14 (Plan Prompt 5)** — auth surface audited end-to-end after the OIDC purge. No dead references to the removed third-party provider remain in `server/`, `client/`, or `shared/`. Local-credential and WorkOS paths are both wired. E2E coverage in `tests/e2e/auth.spec.ts` (signup → /api/friends gate → logout → re-login → forgot-password) runs green against production.

### Implemented Auth Methods

**Local Auth (Primary) — verified green:**
- Registration: `POST /api/auth/register` — username, email, password (bcrypt hashed in `localCredentials` table); rate-limited; sets `req.session.localUserId`; issues 250 PackPTS welcome bonus
- Login: `POST /api/auth/local-login` — `usernameOrEmail` + password → express-session; rate-limited (5/15min)
- Logout: `POST /api/auth/local-logout`
- Password reset: `POST /api/auth/forgot-password` → token email → `GET /api/auth/validate-reset-token?token=…` → `POST /api/auth/reset-password`
- Magic-link account linking: `/api/auth/link/{challenge,confirm,send-magic,verify,cancel}`
- Sessions stored in PostgreSQL via `sessions` table (sid, sess JSONB, expire)
- Session management: Passport.js with local strategy
- Canonical guard: `server/auth/middleware.ts:isAuthenticated` returns `{ message: "Unauthorized" }` on 401 (no internals)
- Session inspector: `GET /api/auth/user`

**WorkOS OAuth (SSO) — wired, package installed:**
- `WORKOS_API_KEY` + `WORKOS_CLIENT_ID` configure OIDC flow (`@workos-inc/node`)
- Routes: `GET /api/auth/workos/start`, `GET /api/auth/workos/callback`, `POST /api/auth/workos/logout`
- Client trigger: `client/src/pages/auth.tsx` "Continue with WorkOS" button posts to `/api/auth/workos/start`
- Maps to `userIdentities` table (provider: "workos", providerUserId, email); enum allowlist in `shared/schema.ts:identityProviders` = `["local", "workos"]`
- Email collision handling via `pendingLinkChallenges` (magic link verification)
- Sets `req.session.workosUserId`

**iOS JWT Auth:**
- `POST /api/auth/token` — exchange email/password for JWT access token (15-min) + refresh token (30-day)
- `POST /api/auth/refresh` — rotate refresh token
- `POST /api/auth/apple` — Sign in with Apple identity token verification
- `POST /api/auth/logout` — JWT logout
- Refresh tokens stored in `refreshTokens` table with device hint and revocation tracking

### User Model
Key fields on `users` table:
- `status`: PENDING → ACTIVE (after invite/cap check) or WAITLISTED or BANNED
- `isAdmin`: boolean for admin dashboard access
- `deviceFingerprint`, `lastSignupIp`: fraud signals
- `points`, `gamesPlayed`, `correctAnswers`, `totalAnswers`: aggregate stats

### Access Control
- **Founders Cap:** `activeUserCounter` table enforces maximum active users. New signups beyond the cap go to waitlist.
- **Invite Codes:** `inviteCodes` table with max uses, expiration. Required during capped signup.
- **Founders Pass:** Viral invite system — existing users can issue passes (`foundersPass` table) that let new users bypass the cap.
- **Waitlist:** `waitlistEntries` with position, referral tracking, status progression.

### Security
- Rate limiting on login (5 attempts per 15 minutes) and registration
- Password reset via email token (`passwordResetTokens` table, expiring)
- Identity linking audit trail (`identityLinkAudit` table)
- Access audit log (`accessAuditLog` table) tracks every activation, invite, and abuse event

---

## 14. Admin, Operations, and Content Management

### Admin Dashboard
All admin routes require `isAdmin: true`. Admin UI lives at `/admin/*` with 20+ pages.

**Implemented Admin Features:**
- **Dashboard:** KPIs (total users, games played, points awarded, card stats), top players chart
- **User Management:** Search/filter users by status, view detailed analytics per user, adjust wallet, freeze/unfreeze accounts, approve waitlisted users
- **Card Management:** Import card sets from CardHedge, configure mask regions, review reported cards, view card telemetry (wrong-answer rates), manage quarantine status, rotate images
- **Card Sets:** Create/edit game sets, configure CardHedge import queries, manage active/inactive sets
- **Redemption Management:** View pending/approved/rejected redemptions, approve/reject/reverse, manage redemption tiers
- **Streak Management:** View streak stats, configure reward schedules, force-freeze user streaks, manually adjust streak counts
- **Products/Store:** CRUD for PackPTS bundles and subscriptions, margin guardrail status
- **Access Control:** Manage founders cap, create invite codes, manage waitlist, invite from waitlist
- **Founders Pass:** View all passes, deactivate individual or all passes
- **Geo Analytics:** Geographic user distribution, session data by country/region
- **Growth Agent:** Content generation management, social media posting controls
- **Audit Log:** Searchable log of all admin actions with metadata
- **Panic Controls:** Emergency switches to disable purchases, PvP, or specific card sets

**Missing Admin Features (Needed):**
- Manual fraud review queue (risk signals exist but no admin UI for reviewing them)
- Marketplace margin override UI
- Automated chargeback → wallet freeze flow
- Batch card import validation preview
- A/B test results dashboard (post analytics visible in growth admin, but no dedicated A/B test comparison view)
- Discord/Reddit/Instagram publisher configuration UI

---

### 14a. Growth Agent & Social Media System

PackPTS has two complementary growth automation systems, plus a growth flywheel analytics layer.

#### System 1: Growth Agent (Manual/Triggered)

**Location:** `server/services/growthAgent/`
**Entry point:** `POST /api/admin/growth/trigger` or admin dashboard
**Purpose:** Generate daily content plans + per-platform content items via OpenAI (GPT-4o-mini)

Pipeline:
1. `planGenerator.ts` — Calls OpenAI to generate daily themes, goals, and platform targets
2. `contentGenerator.ts` — Generates per-platform content items (TikTok scripts, Instagram captions, X tweets, Reddit posts)
3. `index.ts` — Orchestrates the above, writes to `growth_content_plans` + `growth_content_items`, queues drafts into `publishing_queue`

Platform-specific flags: `GROWTH_TIKTOK_ENABLED`, `GROWTH_INSTAGRAM_ENABLED`, `GROWTH_X_ENABLED`, `GROWTH_REDDIT_ENABLED`

Items in the `publishing_queue` are designed for **manual posting** by an operator (or future auto-publisher). Admin UI at `/admin/growth` provides mark-posted and mark-skipped actions.

#### System 2: Social Media Agent (Autonomous)

**Location:** `server/services/socialMedia/`
**Toggle:** `SOCIAL_MEDIA_AGENT_ENABLED=true`
**Purpose:** Fully autonomous content generation, image composition, A/B testing, publishing, analytics, and prompt evolution

Startup (`index.ts`):
1. Verify DB connectivity (hard fail)
2. Verify CardHedge API (soft fail — per-post degradation)
3. Verify Twitter credentials (soft fail)
4. Verify TikTok credentials (soft fail)
5. Seed campaign rewards if empty
6. Recover stuck PUBLISHING posts to QUEUED
7. Audit and block orphaned QUEUED posts missing media
8. Start all 4 scheduler loops

**Scheduler Loops (all in-process):**

| Loop | Interval | Fires At | Purpose |
|------|----------|----------|---------|
| Prompt Evolution | 5 min check | 1 AM EST (daily) | Read A/B test winners → OpenAI → generate next-gen copy variants |
| Daily Queue Builder | 5 min check | 2 AM EST (daily) | Build 2-4 posts per platform per day, alternate acquisition/retention campaigns |
| Publisher | 60 sec | Continuous | Pick up QUEUED posts with scheduledAt <= now, publish to Twitter/TikTok |
| Analytics Fetcher | 6 hours | Continuous | Fetch post metrics, trigger A/B test analysis |

**Content Generation (`contentGenerator.ts`):**
- 7 content types: TRIVIA_CARD, LEADERBOARD_HIGHLIGHT, STREAK_MILESTONE, MARKET_PRICE_SPOTLIGHT, NEW_USER_ACQUISITION, REWARD_ANNOUNCEMENT, CHALLENGE
- 3 A/B variants (A/B/C) per content type, rotated by day
- Context enrichment: queries live DB for user counts, streak records, top scores, active reward values
- Fallback templates when OPENAI_API_KEY is not set

**Publishers:**
- Twitter (`publisher/twitter.ts`): Full auto-publish with image upload via twitter-api-v2
- TikTok (`publisher/tiktok.ts`): Photo post via TikTok Content Publishing API, token auto-refresh
- Discord: **Not implemented** (webhook URL env var defined in docs but no publisher code)
- Reddit: **Not implemented** (env vars defined in strategy docs but no publisher code)
- Instagram: **Not implemented** (env var defined but no publisher code)

**Safety Systems:**
- Fact Checker (`factChecker.ts`): Verifies user counts, match counts, scores, streaks, reward values against DB. Auto-corrects claims >10% off actual values.
- Preflight Validator (`preflight.ts`): Blocks posts referencing visual content without attached media image.
- Startup Audit: Blocks orphaned QUEUED posts missing media.
- Crash Recovery: Resets PUBLISHING posts to QUEUED on startup.
- Rate Limit Tracking: Twitter publisher tracks remaining rate limit.
- Retry Logic: 3 attempts per post with 30-minute backoff.
- A/B Test Timeout: Marks inconclusive after 7 days.

**Prompt Evolution (`promptEvolution.ts`):**
- Reads concluded A/B tests from last 30 days
- Loads `prompt_program.md` (human-editable research direction file)
- Calls OpenAI to generate next-generation copy variants
- Writes to `evolved_copy_variants` table
- `contentGenerator` loads active evolved variants in preference to hardcoded copy
- Each generation learns from the prior generation's winners

**Campaigns:**
- `newUserAcquisition.ts`: Acquisition-focused content type rotation, runs on even-numbered days
- `retention.ts`: Retention-focused content type rotation, runs on odd-numbered days

**Image Composition:**
- `imageComposer.ts` → `gameImageRenderer.ts`: Renders card images with branding overlay
- `imageStorage.ts`: Uploads composed images to Cloudflare R2
- Falls back to local storage if R2 is unavailable

#### Growth Flywheel Analytics

**Location:** `server/services/growthFlywheel/rollup.ts`
**Trigger:** `POST /api/admin/growth/flywheel/compute` (admin API)

Computes daily aggregates from gameplay events, Daily 5 entries, share events, referral links, and referral attributions. Writes to:
- `global_growth_rollups`: DAU, matches played, Daily 5 entries, shares, invites, signups from invites, k-factor
- `user_growth_rollups`: Per-user daily metrics (same dimensions)

Idempotent — safe to re-run for the same day.

#### Growth Database Tables

| Table | System | Purpose |
|-------|--------|---------|
| `growth_content_plans` | Growth Agent | Daily AI-generated content plans |
| `growth_content_items` | Growth Agent | Per-platform content items from plans |
| `publishing_queue` | Growth Agent | Manual posting queue with Notion sync |
| `growth_job_runs` | Growth Agent | Job execution log with timing and errors |
| `social_posts` | Social Media Agent | Auto-posting queue + history |
| `post_analytics` | Social Media Agent | Per-post performance metrics (impressions, likes, shares, clicks) |
| `ab_tests` | Social Media Agent | A/B test tracking (RUNNING, CONCLUDED, INCONCLUSIVE) |
| `evolved_copy_variants` | Social Media Agent | Prompt evolution output (active copy variants) |
| `campaign_rewards` | Social Media Agent | Campaign reward config (signup bonus, streak rewards) |
| `global_growth_rollups` | Flywheel | DAU, matches, shares, k-factor by day |
| `user_growth_rollups` | Flywheel | Per-user daily growth metrics |
| `share_events` | Flywheel | Content sharing/viral tracking |

#### Known Gaps

1. **Missing publishers:** Discord, Reddit, and Instagram publishers are referenced in strategy docs but no code exists. Discord (webhook) is the easiest to implement.
2. **No global circuit breaker:** Strategy docs describe "5 failures in 30 min → pause 30 min" but code only has per-post retry logic.
3. **Diversity tracking is in-memory:** Resets on server restart. Should be DB-backed for production reliability.
4. **Daily 5 announcements not wired:** Strategy calls for 8 AM ET announcement and 9 PM ET recap posts. These are not integrated into the Social Media Agent scheduler.
5. **Brand rules validator not implemented:** Strategy describes a "second AI pass" for compliance validation. Only the DB fact-checker exists.

---

## 15. Fraud, Risk, and Abuse Prevention

### Threat Model

| Threat | Vector | Current Mitigation | Gap |
|--------|--------|-------------------|-----|
| **Gameplay botting** | Automated answer submission | Rate limiting (3 ans/2s), match tokens, minimum answer time (Daily 5) | No ML-based anomaly detection |
| **Multiple accounts** | Create many accounts to farm points | Device fingerprint tracking, IP tracking, founders cap | No automated multi-account detection |
| **Answer harvesting** | Inspect API/network to get correct answers | Server withholds correct answer until after submission | Must be continuously verified |
| **Payment fraud** | Stolen cards, chargebacks | Stripe handles card verification; `purchaseEvents` idempotency | Automated chargeback → freeze not confirmed |
| **Referral abuse** | Self-referral, fake accounts | Referral tracking, device/IP logging | No automated referral fraud detection |
| **Redemption abuse** | Redeem points from fraudulent purchases | Wallet freeze, admin review threshold, minimum redemption (1,000 pts) | Hold periods not fully implemented |
| **Collusion** | Two players sharing answers in 1v1 | Both see same questions simultaneously | No pattern detection for coordinated answers |
| **Device manipulation** | Factory reset to create new accounts | `deviceFingerprint` tracking | No device-level ban enforcement |
| **Marketplace manipulation** | Inflate listing prices to extract more redemption value | `profitPolicy` margin floor, per-source affiliate rates | No listing price validation against market data |

### Risk Pipeline (Prompt 26 — Automated Scoring Live)
- **Event logging:** `authEvents`, `deviceEvents`, `paymentEvents`, `redemptionEvents`, `gameplayEvents` tables capture signals
- **Rollups:** `userRollup24h`, `deviceRollup24h`, `ipRollup24h` aggregate suspicious activity
- **Risk state:** `userRiskState` per user (NORMAL, UNDER_REVIEW, FROZEN)
- **Risk jobs:** `riskJobs` table for background processing
- **Risk suppression:** `riskSuppressions` for false-positive management
- **Feature flag:** `RISK_PIPELINE_ENABLED` (defaults to true)
- **Auto-freeze (Prompt 26):** `updateRiskSnapshot()` now calls `riskEngine.applyAction(FREEZE)` whenever `tierSuggestion === "HIGH"` and user is not already frozen
- **Hourly scan (Prompt 26):** `startHourlyRiskScan()` in `jobQueue.ts` runs every 60 min, queries `user_presence` for active users, enqueues `UPDATE_SNAPSHOT` job for each
- **Admin on-demand scan:** `POST /api/admin/risk/run-scan?hours=N` triggers immediate batch scan of recently active users

### What Must Be Added
1. ~~**Automated risk scoring** — consume rollup data → compute risk score → auto-freeze high-risk accounts~~ ✅ Done (Prompt 26)
2. **Hold periods** — purchased points should have a cooldown before becoming redeemable (e.g., 72 hours)
3. **Velocity checks** — flag unusual patterns (many redemptions in short period, sudden point spikes)
4. **Admin review queue** — UI for reviewing flagged accounts with risk context
5. **Chargeback webhook handler** — Stripe `charge.disputed` → auto-freeze wallet → create REVERSAL ledger entry
6. **Device-level banning** — block known fraudulent device fingerprints from creating new accounts

---

## 16. Current Technical Architecture

### Repository Structure
```
PackPoints-Game/
├── client/                      # Frontend (React + Vite)
│   ├── src/
│   │   ├── main.tsx            # Entry point
│   │   ├── App.tsx             # Router, providers, layout
│   │   ├── pages/              # Route-level page components
│   │   │   ├── game.tsx        # Solo game
│   │   │   ├── match.tsx       # 1v1 match
│   │   │   ├── daily5.tsx      # Daily 5 challenge
│   │   │   ├── lobby.tsx       # Match lobby
│   │   │   ├── queue.tsx       # Matchmaking queue
│   │   │   ├── marketplace.tsx # Affiliate marketplace
│   │   │   ├── store.tsx       # PackPTS store
│   │   │   ├── leaderboard.tsx # Rankings
│   │   │   ├── profile.tsx     # User profile
│   │   │   ├── friends.tsx     # Friend list
│   │   │   ├── auth.tsx        # Login/signup
│   │   │   ├── home.tsx        # Landing page
│   │   │   └── admin/          # 20+ admin pages
│   │   ├── components/         # Reusable components
│   │   │   ├── GameCard.tsx    # Card display with masking
│   │   │   ├── MaskedCardImage.tsx # Image masking engine
│   │   │   ├── CardSetPicker.tsx
│   │   │   ├── header.tsx
│   │   │   ├── mobile-nav.tsx
│   │   │   ├── OnboardingModal.tsx
│   │   │   ├── streak-card.tsx
│   │   │   ├── AchievementBadges.tsx
│   │   │   └── ui/             # 50+ shadcn/Radix primitives
│   │   ├── hooks/              # Custom React hooks
│   │   │   ├── use-auth.ts
│   │   │   ├── useWebSocket.ts
│   │   │   ├── use-wallet.ts
│   │   │   ├── use-daily-progress.ts
│   │   │   └── use-cardhedge.ts
│   │   ├── lib/                # Utilities
│   │   │   ├── queryClient.ts  # TanStack Query config + API helpers
│   │   │   ├── utils.ts
│   │   │   └── auth-utils.ts
│   │   └── types/              # TypeScript types
│   │       └── api.ts
│   └── index.html
├── server/                      # Backend (Express.js)
│   ├── index.ts                # App entry, middleware, route registration
│   ├── routes.ts               # Main route definitions
│   ├── auth.ts                 # Passport + session setup
│   ├── websocket.ts            # WebSocket server
│   ├── storage.ts              # Database access layer
│   ├── stripeClient.ts         # Stripe configuration
│   ├── routes/                 # Route modules
│   │   ├── friends.ts
│   │   ├── wallet.routes.ts
│   │   ├── admin.routes.ts
│   │   ├── health.routes.ts
│   │   ├── ios.routes.ts
│   │   ├── growth.routes.ts
│   │   ├── referrals.ts
│   │   └── cardhedge.routes.ts
│   ├── services/               # Business logic
│   │   ├── walletService.ts
│   │   ├── matchService.ts
│   │   ├── rewardEngine.ts
│   │   ├── redemptionService.ts
│   │   ├── streakService.ts
│   │   ├── daily5Service.ts
│   │   ├── geoService.ts
│   │   ├── jwtService.ts
│   │   ├── tokenService.ts
│   │   ├── cardHedge.ts
│   │   ├── marketplace/        # eBay + Goldin integration
│   │   │   ├── ebay.ts
│   │   │   ├── outbound.ts
│   │   │   └── index.ts
│   │   ├── risk/               # Fraud detection
│   │   │   └── events.ts
│   │   ├── growthAgent/        # AI content generation
│   │   └── socialMedia/        # Social platform posting
│   ├── middleware/
│   │   ├── rateLimiter.ts
│   │   ├── geoMiddleware.ts
│   │   ├── gameGuards.ts
│   │   └── requestLogger.ts
│   └── config/
│       └── rewards.ts          # Reward constants
├── shared/                      # Shared between client and server
│   └── schema.ts               # Drizzle ORM schema (144+ tables)
├── migrations/                  # SQL migration files
├── docs/                        # Project documentation
├── tests/                       # Playwright E2E tests
├── scripts/                     # Utility scripts
├── drizzle.config.ts           # Drizzle configuration
├── vite.config.ts              # Vite configuration
├── tailwind.config.ts          # Tailwind configuration
├── tsconfig.json               # TypeScript configuration
├── package.json                # Dependencies and scripts
├── CLAUDE.md                   # AI agent instructions
├── PACKPTS_PROJECT_CONTEXT.md  # This file
└── design_guidelines.md        # Brand and design system
```

---

## 17. Frontend Architecture

### Routing
- **Library:** Wouter (lightweight client-side router)
- **Split loading:** Critical paths (Home, Auth) are eagerly imported; all other pages are lazy-loaded with React.lazy + Suspense
- **Route guards:** `ProtectedRoute` component checks auth/admin status, redirects to `/auth` if unauthorized
- **Layout:** `AppShell` wraps all pages with Header and MobileNav (hidden on fullscreen game/match routes)

### Pages (30+)
Public: `/`, `/game/:mode`, `/lobby`, `/match/:matchId`, `/queue`, `/daily5`, `/leaderboard`, `/marketplace`, `/store`, `/auth`, `/waitlist`, `/invite`, `/redeem`, `/forgot-password`, `/reset-password`, `/privacy-policy`, `/terms-of-service`, `/creators`, `/partners`, `/roadmap`

Protected: `/profile`, `/friends`

Admin (20+): `/admin/dashboard`, `/admin/users`, `/admin/users/:userId`, `/admin/metrics`, `/admin/audit-log`, `/admin/redemptions`, `/admin/tiers`, `/admin/streaks`, `/admin/daily5`, `/admin/products`, `/admin/subscriptions`, `/admin/access`, `/admin/geo`, `/admin/playable-sets`, `/admin/card-sets`, `/admin/cardhedge-card`, `/admin/card-search`, `/admin/card-reports`, `/admin/card-telemetry`, `/admin/package-guardrails`, `/admin/growth`

### Data Fetching
- **TanStack React Query v5** for all server state
- `apiRequest(method, path, body)` utility in `lib/queryClient.ts`
- Stale times: auth = 5 minutes, wallet = 30 seconds (60s refetch interval), leaderboard = varies
- UTM parameter capture in sessionStorage for attribution

### Card Display Components
- `GameCard.tsx` — Main card component with masking, image validation, placeholder detection, rotation, skip/replace logic
- `MaskedCardImage.tsx` — Canvas-based masking engine with configurable blur/pixelate regions per card set
- Image validation: color diversity analysis and dominant-color percentage detection to catch blank/silhouette placeholders

### Styling
- Tailwind CSS 3.4 with custom HSL color variables
- Dark/light mode via class-based toggle (`ThemeProvider`)
- shadcn/ui component library (50+ Radix UI primitives)
- Custom design tokens: border-radius (lg: 9px, md: 6px, sm: 3px)
- Animations via Framer Motion (card reveals, point awards, leaderboard updates) — all < 500ms

---

## 18. Backend Architecture

### Express App Structure
Entry point: `server/index.ts`

**Startup sequence:**
1. Environment validation (DATABASE_URL, SESSION_SECRET required)
2. CORS middleware with `ALLOWED_ORIGINS`
3. JSON body parsing (with raw body capture for Stripe webhooks)
4. Request ID injection + structured logging (PII sanitized)
5. Static file serving
6. Auth setup (express-session → PostgreSQL store, Passport)
7. Route registration (game, match, lobby, daily5, wallet, admin, marketplace, friends, referrals, CardHedge, iOS, health, growth)
8. WebSocket server setup on `/ws`
9. Background jobs: risk pipeline, image validation (6h), card pool refresh (12h), session cleanup (1h), match cleanup (1h), redemption cleanup (1h)

### Middleware
- `rateLimiter.ts` — Per-endpoint rate limits (login: 5/15min, registration, answer submission: 3/2s, checkout)
- `geoMiddleware.ts` — IP-based geolocation (IPInfo API), privacy-preserving IP hashing, VPN detection
- `gameGuards.ts` — Quota and entitlement validation before game start
- `requestLogger.ts` — Structured request logging with request IDs, PII redaction

### Key API Groups
- **Auth:** `/api/auth/*` — register, login, logout, password reset, WorkOS OAuth, iOS JWT
- **Game:** `/api/game/*` — start session, answer, next question, replace card
- **Daily5:** `/api/daily5/*` — start, answer, finish, status, leaderboard
- **Lobby/Match:** `/api/lobby/*` — create, join, leave (REST); match lifecycle via WebSocket
- **Wallet:** `/wallet` — balance + history; `/api/wager/validate`
- **Redemption:** `/api/redemption/*` + `/api/redeem` — tiers, calculate, execute, history, token validation
- **Streak:** `/api/streak` — state, buy freeze, config
- **Marketplace:** `/api/marketplace/*` — search listings; `/out/ebay/:listingId` — affiliate redirect
- **Store:** `/api/checkout` — Stripe checkout; `/api/stripe/webhook` — payment webhooks
- **Admin:** `/api/admin/*` — 40+ endpoints for dashboard, users, cards, redemptions, streaks, products, access, geo, growth, panic
- **Friends:** Friend list management, match invites
- **Referrals:** `/api/referrals/*` — create, attribute, stats, leaderboard
- **Health:** `/api/health`, `/api/version`

### WebSocket Server
- Upgrade path: `/ws`
- Origin validation against `ALLOWED_ORIGINS`
- Session resolution from cookies
- Message types: auth, heartbeat, join_lobby, leave_lobby, start_match, join_match, join_queue, leave_queue, submit_answer, ready_next, match_resync, question_replace_request, rematch_vote, leave_match, battle_rematch_request, battle_leave, set_lobby_card_set
- Broadcast functions: `broadcastToLobby()`, `broadcastToMatch()`, `sendToUser()`

### Error Handling
- Centralized Express error handler
- `errorMonitor.expressErrorHandler()` for exception tracking
- Sentry integration available (`SENTRY_DSN` env var)
- Panic service for emergency system-wide disables

---

## 19. Database Schema

The database has **144+ tables** defined in `shared/schema.ts` using Drizzle ORM. Below are the major domain groups with key tables.

### User & Auth Domain (13 tables)
| Table | Purpose |
|-------|---------|
| `users` | Core user accounts (id, username, email, points, status, isAdmin) |
| `sessions` | Express-session PostgreSQL store |
| `localCredentials` | Bcrypt password hashes |
| `passwordResetTokens` | Time-limited reset tokens |
| `refreshTokens` | iOS JWT refresh tokens with device hints |
| `appleUsers` | Apple Sign In identity mapping |
| `apnsTokens` | iOS push notification device tokens |
| `userIdentities` | Multi-provider auth (local, workos) |
| `pendingLinkChallenges` | Email collision verification for identity linking |
| `identityLinkAudit` | Identity linking attempt tracking |
| `waitlistEntries` | Waitlist position and referral tracking |
| `inviteCodes` | Invite codes with max uses and expiration |
| `accessAuditLog` | All access control events |

### Gameplay Domain (20+ tables)
| Table | Purpose |
|-------|---------|
| `gameSessionsTable` | Solo game session state |
| `lobbies` | Match lobby with join codes |
| `matches` | Match lifecycle (LOBBY → ACTIVE → FINISHED) |
| `matchParticipants` | Per-player match state |
| `battleSessions` | Multi-match series tracking |
| `matchQuestions` | Per-match card assignments |
| `matchAnswers` | Player answers with unique constraint |
| `matchUsedCards` | Cards used in a match (no repeats) |
| `matchEvents` | Append-only match event log |
| `playerRatings` | ELO ratings and ranked tiers |
| `ratingHistory` | ELO change log per match |
| `matchTokens` | Anti-cheat tokens |
| `dailyQuotas` | Per-mode daily match limits |
| `userDailyProgress` | Daily card/match counters |

### Economy Domain (18+ tables)
| Table | Purpose |
|-------|---------|
| `wallets` | User PackPTS balance and status |
| `ledgerEntries` | Append-only transaction log with idempotency |
| `packptsBucket` | FIFO point-source tracking with expiration |
| `packptsSpendAllocation` | FIFO spend allocation |
| `packptsExpirationPolicy` | Configurable expiration rules |
| `packptsLiabilitySnapshot` | Daily accounting snapshots |
| `products` | Store catalog (bundles, subscriptions) |
| `subscriptionProducts` | Subscription tier definitions |
| `userEntitlements` | Active entitlements per user |
| `stripeCustomers` | Stripe customer ID mapping |
| `stripeCheckoutSessions` | Checkout lifecycle tracking |
| `purchaseEvents` | Webhook event deduplication |
| `storeFeeProfiles` | Per-channel fee structures |
| `storePackagePolicy` | Package validation rules |
| `storePurchases` | Purchase records |

### Reward & Streak Domain
| Table | Purpose |
|-------|---------|
| `rewardPolicy` | Versioned scoring rules |
| `playerFame` | Per-player fame scores |
| `pointsAwards` | Append-only points audit log |
| `userPointsCounters` | Daily cap enforcement |
| `internalPlayerStats` | Player attempt/correct ratios |
| `streakState` | User streak tracking |
| `streakRewardConfig` | Reward schedule configuration |
| `streakClaimLog` | Append-only streak claim records |
| `redemptionTiers` | PackPTS → USD conversion tiers |
| `rewardRedemptions` | Redemption records with admin review |

### Card & Content Domain (15+ tables)
| Table | Purpose |
|-------|---------|
| `playableCards` | Active cards (imported from CardHedge) |
| `baseballCards` | Legacy card data |
| `gameSets` | Card set definitions |
| `userActiveSets` | User's selected card sets |
| `cardImageReports` | User-reported card issues |
| `cardhedgeImportRuns` | Import job tracking |
| `cardDetailsCache` | CardHedge card detail cache |
| `cardhedgeSearchCache` | Search result cache |
| `cardImageQuarantine` | Quarantined card images |
| `cardImageMaskCache` | Cached mask configurations |

### Marketplace Domain (10+ tables)
| Table | Purpose |
|-------|---------|
| `profitPolicy` | Versioned margin/affiliate rules |
| `externalPurchaseIntent` | Marketplace redemption calculations |
| `redemptionCredit` | Issued store credits |
| `marginLedger` | Company-side revenue tracking |
| `marginUsage` | Consumed margin tracking |
| `redemptionReservations` | Race condition prevention |
| `marketplaceMarginConfig` | Per-source affiliate rates |
| `marketplaceCache` | Listing cache with TTL |
| `outboundClicks` | Affiliate click tracking |
| `externalListingsSnapshot` | Listing availability snapshots |
| `goldinCuratedListings` | Admin-curated Goldin listings |

### Risk & Fraud Domain (14+ tables)
| Table | Purpose |
|-------|---------|
| `authEvents` | Login/logout/MFA event log |
| `deviceEvents` | Device fingerprint tracking |
| `paymentEvents` | Payment transaction signals |
| `redemptionEvents` | Redemption activity signals |
| `gameplayEvents` | Match participation signals |
| `userRollup24h` | 24-hour user activity aggregation |
| `deviceRollup24h` | 24-hour device activity aggregation |
| `ipRollup24h` | 24-hour IP activity aggregation |
| `fraudSignals` | Detected fraud indicators |
| `riskSnapshots` | Point-in-time risk assessments |
| `riskSuppressions` | False positive management |
| `riskJobs` | Background risk processing queue |
| `userRiskState` | Current risk status per user |

### Geo Intelligence (4 tables)
| Table | Purpose |
|-------|---------|
| `userGeoSession` | Privacy-safe session geolocation (IP hash, country, region, VPN flag) |
| `userGeoProfile` | Inferred home state with confidence score |
| `geoRollupsDaily` | Pre-aggregated geographic stats |

### Social & Growth Domain
| Table | Purpose |
|-------|---------|
| `friendships` | Undirected friend graph (userLow/userHigh) |
| `friendMatchInvites` | Match invitations between friends |
| `foundersPass` | Viral invite tokens |
| `foundersPassEvents` | Pass lifecycle events |
| `activeUserCounter` | Atomic cap enforcement (single row) |
| `eventLog` | General analytics events |
| `featureFlags` | Runtime feature toggles |
| `appConfig` | Runtime application settings |
| `adminAuditLog` | Admin action tracking |

---

## 20. Environment Variables and Secrets

> **Production secret enforcement**: `server/utils/secretsCheck.ts` runs at startup. In `NODE_ENV=production` or `APP_ENV=production`, the server exits with a fatal error if any secret marked ✗ REQUIRED is missing **or** equals its known development default. In development the same check fires as loud warnings. Secret values are never printed in logs — only presence/absence.

### Required in production — startup will exit(1) if these are absent or default
| Variable | Purpose | Required in prod | Known dev default (NEVER ship) |
|----------|---------|:---:|---|
| `DATABASE_URL` | PostgreSQL connection string | ✗ | — |
| `SESSION_SECRET` | Express-session signing key (≥32 chars) | ✗ | — |
| `JWT_SECRET` | JWT signing for iOS tokens | ✗ | `packpoints-dev-secret-change-me-in-production-2026` |
| `IP_HASH_SALT` | IP anonymization salt | ✗ | `default-ip-salt-change-in-production` |
| `DEVICE_HASH_SALT` | Device fingerprint hashing salt | ✗ | `default-device-salt-change-in-production` |
| `FOUNDERS_PASS_PEPPER` | Founders pass token hashing pepper | ✗ | `default-pepper-change-in-production` |
| `SECRET_SALT` (or `GROWTH_AGENT_SECRET_SALT`) | Daily-5 challenge signing salt | ✗ | `packpts-daily5-default-salt-change-me` |
| `STRIPE_secret` or `STRIPE_SECRET_KEY` | Stripe API secret key | ✗ | — |
| `STRIPE_WEBHOOK_SECRET_LIVE` or `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification | ✗ | — |

Generate unique values with `openssl rand -hex 32`. Set in Railway → Service → Variables tab.

### Payments (Required for store/marketplace functionality)
| Variable | Purpose |
|----------|---------|
| `STRIPE_PUBLISHABLE_KEY` | Stripe public key (client-side) |
| `INTERNAL_API_KEY` | Internal API authentication for wallet operations |
| `OUTBOUND_SECRET` | HMAC signing for affiliate outbound links |

### Auth
| Variable | Purpose | Default |
|----------|---------|---------|
| `WORKOS_API_KEY` | WorkOS OAuth API key | (optional) |
| `WORKOS_CLIENT_ID` | WorkOS client ID | "" |
| `WORKOS_REDIRECT_URI` | OAuth callback URL | (optional) |

### Card Data
| Variable | Purpose | Default |
|----------|---------|---------|
| `CARDHEDGE_API_KEY` | CardHedge card catalog API | (optional) |
| `CARDHEDGE_BASE_URL` | CardHedge API base URL | https://api.cardhedger.com |
| `CARDHEDGE_HTTP_TIMEOUT_MS` | API timeout | 10000 |
| `CARDHEDGE_CACHE_TTL_SECONDS` | Cache duration | 3600 |

### Marketplace / Affiliate
| Variable | Purpose |
|----------|---------|
| `EBAY_CLIENT_ID` | eBay API credentials |
| `EBAY_CLIENT_SECRET` | eBay API secret |
| `EBAY_ENV` | "production" or sandbox |
| `EPN_CAMPID` | eBay Partner Network campaign ID |
| `EPN_CUSTOMID_PREFIX` | EPN custom ID prefix |
| `EPN_MKCID` | EPN marketing channel ID |
| `EPN_MKSID` | EPN marketing source ID |

### Security & Hashing
| Variable | Purpose | Default |
|----------|---------|---------|
| `GEO_SALT` | Geo data hashing | random if not set (fine for dev) |

### Geolocation
| Variable | Purpose | Default |
|----------|---------|---------|
| `IPINFO_TOKEN` | IPInfo API key | (optional) |
| `GEO_PROVIDER` | Geo service | "ipinfo" |
| `GEO_TIMEOUT_MS` | Lookup timeout | 3000 |

### Email
| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Resend email service API key |

### Social Media / Growth Agent
| Variable | Purpose | Default |
|----------|---------|---------|
| `SOCIAL_MEDIA_AGENT_ENABLED` | Enable autonomous Social Media Agent | "false" |
| `AGENT_DRY_RUN` | Queue posts but skip actual publishing | "false" |
| `AGENT_TIMEZONE` | Scheduler timezone | "America/New_York" |
| `AGENT_MIN_POSTS_PER_DAY` | Min posts per platform per day | 2 |
| `AGENT_MAX_POSTS_PER_DAY` | Max posts per platform per day | 4 |
| `AGENT_DAILY_QUEUE_BUILD_HOUR` | EST hour to build daily queue | 2 |
| `PACKPTS_SITE_URL` | Site URL for content CTAs | "https://PackPTS.com" |
| `OPENAI_API_KEY` | AI content generation (GPT-4o-mini) | (optional, fallback templates) |
| `TWITTER_API_KEY` | Twitter/X app key | (optional) |
| `TWITTER_API_SECRET` | Twitter/X app secret | (optional) |
| `TWITTER_ACCESS_TOKEN` | Twitter/X user access token | (optional) |
| `TWITTER_ACCESS_TOKEN_SECRET` | Twitter/X user access secret | (optional) |
| `TWITTER_BEARER_TOKEN` | Twitter/X bearer token | (optional) |
| `TIKTOK_CLIENT_KEY` | TikTok app client key | (optional) |
| `TIKTOK_CLIENT_SECRET` | TikTok app client secret | (optional) |
| `TIKTOK_ACCESS_TOKEN` | TikTok user access token | (optional) |
| `TIKTOK_REFRESH_TOKEN` | TikTok token refresh | (optional) |
| `GROWTH_TIKTOK_ENABLED` | Enable TikTok in Growth Agent plan gen | "true" |
| `GROWTH_INSTAGRAM_ENABLED` | Enable Instagram in Growth Agent plan gen | "false" |
| `GROWTH_X_ENABLED` | Enable X/Twitter in Growth Agent plan gen | "false" |
| `GROWTH_REDDIT_ENABLED` | Enable Reddit in Growth Agent plan gen | "false" |
| `AGENT_AB_TEST_MIN_IMPRESSIONS` | Min impressions before concluding A/B test | 100 |
| `AGENT_AB_TEST_MIN_DURATION_HOURS` | Min hours before concluding A/B test | 24 |
| `AGENT_AB_TEST_SIGNIFICANCE_THRESHOLD` | Relative diff threshold for A/B winner | 0.15 |

### Cloud Storage
| Variable | Purpose |
|----------|---------|
| `R2_ACCOUNT_ID` | Cloudflare R2 account |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | R2 bucket |
| `R2_PUBLIC_URL` | R2 public URL |

### Monitoring
| Variable | Purpose |
|----------|---------|
| `SENTRY_DSN` | Sentry error tracking |

### Feature Flags (env-based)
| Variable | Default | Purpose |
|----------|---------|---------|
| `RISK_PIPELINE_ENABLED` | true | Enable fraud detection pipeline |
| `IMAGE_VALIDATION_ENABLED` | true | Enable card image validation jobs |
| `CARD_POOL_REFRESH_ENABLED` | true | Background card pool refresh |
| `CARD_IMAGE_PROXY_ENABLED` | true | Image proxy for cards |
| `NEWSLETTER_ENABLED` | false | Newsletter service |
| `STALE_REDEMPTION_CLEANUP_ENABLED` | true | Clean stale redemption quotes |

### Application
| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 5000 | Server port |
| `NODE_ENV` | — | production / development / test |
| `ALLOWED_ORIGINS` | — | CORS whitelist (comma-separated) |
| `SITE_URL` | https://packpts.com | Canonical site URL |
| `DB_POOL_MAX` | 10 | Database connection pool max |

### Client-Side (Vite)
| Variable | Purpose |
|----------|---------|
| `VITE_DISCORD_INVITE_URL` | Discord community link |
| `VITE_CLIENT_SIDE_IMAGE_VALIDATION` | Enable/disable placeholder detection |

### ⚠️ NEVER expose actual secret values in code, logs, or client bundles. All `STRIPE_*`, `*_SECRET*`, `*_API_KEY`, `JWT_SECRET`, `SESSION_SECRET`, `DATABASE_URL` must remain server-side only.

---

## 21. API Surface

See Section 18 for the full route listing. Key endpoints grouped by domain:

### Authentication
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/auth/register | No | Create account |
| POST | /api/auth/local-login | No | Session login |
| POST | /api/auth/local-logout | Yes | Destroy session |
| POST | /api/auth/token | No | iOS JWT exchange |
| POST | /api/auth/refresh | No | iOS token rotation |
| POST | /api/auth/apple | No | Apple Sign In |
| POST | /api/auth/forgot-password | No | Initiate reset |
| POST | /api/auth/reset-password | No | Complete reset |
| GET | /api/auth/user | Yes | Current user |

### Gameplay
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/game/start | No* | Start solo session |
| POST | /api/game/answer | No* | Submit answer |
| POST | /api/game/next | No* | Next question |
| POST | /api/game/session/:id/replace-card | No* | Replace failed card |
| POST | /api/daily5/start | Yes | Start daily challenge |
| POST | /api/daily5/answer | Yes | Submit daily answer |
| GET | /api/daily5/leaderboard | No | Daily rankings |

*Solo games allow guest play (no auth), but points are only awarded to authenticated users.

### Economy
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /wallet | Yes | Balance + transactions |
| GET | /api/redemption/tiers | No | Redemption tier info |
| POST | /api/redemption/calculate | Yes | Estimate redemption value |
| POST | /api/redeem | Yes | Execute redemption |
| GET | /api/streak | Yes | Streak state |
| POST | /api/streak/buy-freeze | Yes | Purchase streak freeze |

### Marketplace
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/marketplace/search | No | Search listings |
| GET | /out/ebay/:listingId | No | Affiliate redirect |

### Social
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/lobby/create | Yes | Create match lobby |
| POST | /api/lobby/join | Yes | Join lobby |
| GET | /api/leaderboard | No | Global rankings |
| POST | /api/referrals/create | Yes | Create referral link |

### Admin (all require isAdmin)
40+ endpoints covering: dashboard metrics, user management, card management, redemption approval/rejection, streak config, product CRUD, access control, geo analytics, growth agent, panic switches, audit logs.

---

## 22. North-Star Metric and Admin Scorecard

### North-Star Metric
**Weekly Active Players who completed ≥1 match (WAP)**

Rationale: WAP captures both acquisition (new users) and the core engagement loop (actually playing). A user who signs up but never plays doesn't count. A user who plays contributes to matchmaking liquidity and potential affiliate conversions. This metric aligns the entire product — growth, retention, ELO system, bot fallback, and referral loop — toward a single measurable goal.

### Admin Weekly Scorecard
Endpoint: `GET /api/admin/scorecard` (admin-only)

Returns for the current week (Sun–Sat):
| Field | Source | Description |
|-------|--------|-------------|
| `northStar.value` | `matches WHERE status=FINISHED` | WAP — unique players with ≥1 finished match |
| `growth.newSignupsThisWeek` | `users` | Signups this week vs last week + WoW % |
| `retention.d7Pct` | `users + user_presence` | D7 return rate for last week's cohort |
| `revenue.revenueUsd` | `purchase_events` | Stripe checkout completions sum |
| `engagement.matchesPlayed` | `matches` | Total finished matches this week |
| `engagement.ptsAwarded` | `ledger_entries` | Total EARN ledger credits this week |
| `viral.referralSignups` | `referral_attributions` | Signups via referral link this week |

## 23. Data Integrity and Idempotency Rules

### Where Idempotency Is Required and Implemented

| Operation | Idempotency Key | Mechanism |
|-----------|-----------------|-----------|
| Ledger entries (wallet) | `ledgerEntries.idempotencyKey` | Unique constraint; duplicate insert → conflict → no-op |
| Points awards | `pointsAwards.idempotencyKey` | Unique constraint |
| Streak claims | `streakClaimLog.idempotencyKey` | Unique constraint |
| Match answers | `matchAnswers(matchId, userId, idx)` | Unique constraint |
| Stripe webhooks | `purchaseEvents.eventId` | Unique constraint; same event ID → ignored |
| Apple IAP | `appleTransactions.transactionId` | Unique constraint |
| Redemptions | `rewardRedemptions.ledgerIdempotencyKey` | Generated from userId + amount + clientKey |

### Race Condition Prevention
- `redemptionReservations` table with ACTIVE/RELEASED/CONSUMED status prevents concurrent redemptions from over-spending margin
- Wallet operations use database transactions with row-level locking
- Answer submission uses async mutex per game session
- `activeUserCounter` uses atomic increment for cap enforcement

### Double-Spend Prevention
- Wallet balance is updated in the same transaction as the ledger entry creation
- FIFO bucket `remainingAmount` is decremented atomically during spend allocation
- `balanceAfter` on ledger entries creates an audit chain

### What Must Be Maintained
- **Never** update wallet balance without creating a corresponding ledger entry
- **Never** process a Stripe webhook without checking `purchaseEvents` for duplicate `eventId`
- **Never** award points without a unique `idempotencyKey`
- **Never** complete a redemption without a reservation check
- Match conclusion must be idempotent (re-finishing an already-finished match = no-op)

---

## 23. Testing Strategy

### Existing Tests

**Vitest integration tests** (`server/tests/` — 14 test files, 223+ tests, most require a live PostgreSQL connection):
| File | Tests | What it covers |
|------|-------|---------------|
| `wallet.test.ts` | 23 | WalletService: credit/debit, idempotency, frozen-wallet guard, ledger balance consistency |
| `antiPruning.test.ts` | 19 | Anti-pruning logic for card exclusion |
| `card-image-pipeline.test.ts` | 7 | Card image validation pipeline |
| `baseballCardsLegacy.test.ts` | 5 | Legacy baseballCards fallback table decision (see Data Model section) |
| `contentFactory.test.ts` | 9 | Score card / streak badge generation, DB idempotency |
| `gameplayGating.test.ts` | 15 | Gameplay gate enforcement |
| `growthAgent.test.ts` | 4 | Growth agent: schema validation, deduplication, job tracking (OpenAI mocked) |
| `growthFlywheel.test.ts` | 8 | Growth flywheel logic |
| `masking.test.ts` | 33 | Sanitization, DEFAULT_MASK_REGIONS geometry, answer leak prevention |
| `purchaseFulfillment.test.ts` | 27 | Purchase fulfillment flow |
| `rewardEngine.test.ts` | 6 | Reward engine DB integration (frozen account, idempotency, caps) |
| `rewardEnginePure.test.ts` | 30 | Reward engine pure logic (no DB required) |
| `socialPublishing.test.ts` | 17 | Social publishing pipeline |
| `videoFactory.test.ts` | 20 | Video asset generation |

Run locally: `npx vitest run` (requires `DATABASE_URL` pointing to a local or dev Postgres instance).

**Playwright E2E** (`tests/e2e/` — 2 specs):
- `auth.spec.ts` — login/logout/session persistence
- `battle-session.spec.ts` — 1v1 battle session flow

Run via `npm run test:e2e`. Requires a running server and `TEST_BASE_URL`.

### CI — GitHub Actions (`.github/workflows/ci.yml`)

Runs on every push and PR to `main`. Steps:
1. `npm ci` — clean install (all platforms' optional rollup native binaries are in the lockfile)
2. `npm run check` — tsc type check (zero-error gate)
3. `npx drizzle-kit push` — set up fresh test schema (uses PostgreSQL service container)
4. `npx vitest run` — all 14 integration test files (223+ tests) against the CI postgres
5. `npm run build` — esbuild bundle (confirms the server builds without type or bundler errors)

PostgreSQL service: `postgres:16`, DB name `packpoints_test`, user/pass `postgres/postgres`. Node.js version: **24** (updated from 20 in June 2026; 20 is deprecated on GitHub-hosted runners).

Playwright E2E is **not yet wired** into CI (requires live server + real env). A stub `e2e-stub` job exists in the workflow with `if: false` as a placeholder.

**Known CI fixes applied (prompt 8):**
- `wallet.test.ts`: delete `packptsBucket` before `ledgerEntries` in cleanup (FK: `bucket.created_from_ledger_entry_id → ledger_entries.id`); call `seedRewardPolicy()` before `awardPoints` tests
- `walletService.ts`: pass `tx` to `createBucket` in `adjust()` and `purchaseCredit()` so bucket insert and ledger insert share the same transaction
- `growthFlywheel` / `shared/schema.ts`: added `uniqueIndex` on `(userId, dayKey)` to `userGrowthRollups` table (required for `onConflictDoUpdate`)
- `growthAgent.test.ts`: changed arrow function mock to `function()` so it can be called with `new OpenAI()`
- `contentFactory.test.ts`: changed `toEndWith(".png")` to `toMatch(/\.png$/)` (not a valid Vitest matcher)
- `card-image-pipeline.test.ts`: wrapped server-dependent describe blocks with `describe.skipIf(!process.env.TEST_BASE_URL)` so CI (no running server) skips them

**Known CI fixes applied (2026-06-15, post-Prompt-26 regression):**
- `walletService.ts`: `spend()` returned raw `userRiskState.reason` as error ("fraud test"); changed to always return `"Account frozen"` so `/frozen/i` test assertion passes
- `profitGuardrailService.ts`: `Cmax = (0.18 - 0.10) * 100` produces `8.000000000000002` (IEEE 754); added `Math.round(Cmax * 100) / 100` before returning to fix exact equality assertion
- `purchaseFulfillment.test.ts` (second describe block `beforeEach`): only cleared `purchaseEvents`, leaving wallet balance from previous test (500 pts) — added ledger and wallet balance reset to match first describe block pattern
- `purchaseFulfillment.test.ts` (second describe block `afterAll`): deleted `users` before `packpts_bucket`, violating FK constraint `packpts_bucket_user_id_users_id_fk` — added full cascade cleanup (spendAllocation → bucket → ledger → wallet → user)

### Required Tests (Proposed)

**Card Masking (Critical):**
- Verify no API response for a question includes the correct answer before submission
- Verify DOM inspection cannot reveal the player name
- Verify mask regions fully cover name text for each active card set
- Verify card replacement preserves masking

**Scoring:**
- Verify fame-based point calculation matches policy
- Verify vintage and rarity multipliers apply correctly
- Verify daily cap enforcement
- Verify per-match cap enforcement

**Wallet / Ledger:**
- Verify ledger idempotency (same key → no duplicate entry)
- Verify wallet balance matches sum of ledger entries
- Verify frozen wallet cannot earn or spend
- Verify FIFO bucket depletion order

**Payments:**
- Verify Stripe webhook idempotency (replay → no duplicate credit)
- Verify checkout session expiration handling
- Verify product guardrail enforcement (margin < threshold → block)

**Matchmaking:**
- Verify both players see identical questions
- Verify answer uniqueness constraint
- Verify disconnect grace period and auto-forfeit
- Verify battle session series tracking

**Marketplace:**
- Verify affiliate URL parameters are preserved
- Verify redemption margin calculation matches profit policy
- Verify minimum redemption enforcement
- Verify outbound click logging

**Fraud:**
- Verify rate limiting on answer submission
- Verify match token validation
- Verify minimum answer time enforcement (Daily 5)
- Verify frozen user cannot access game endpoints

---

## 24. Deployment and Local Development

### Local Development
```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env  # (or create .env with DATABASE_URL and SESSION_SECRET)

# Push schema to local PostgreSQL
npm run db:push

# Start development server (frontend + backend)
npm run dev
```

The dev server runs on `http://localhost:5000` by default. Vite proxies the frontend through Express.

### Package Scripts
| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `NODE_ENV=development tsx server` | Start dev server with hot reload |
| `build` | `npm run check && tsx script/build.ts` | Type-check (gate) then build for production (output: dist/) |
| `start` | `NODE_ENV=production node dist/index.cjs` | Run production build |
| `check` | `tsc` (with `noEmit: true` in tsconfig) | TypeScript type checking; required gate for `build` |
| `db:push` | `drizzle-kit push` | Sync schema to database |
| `test:e2e` | `playwright test` | Run end-to-end tests |
| `agent:social` | Social media posting service | Autonomous content generation |

**Build gate:** `npm run build` runs `tsc` first and refuses to bundle if there are any type errors. Railway invokes `npm run build` on every deploy, so a type error blocks production. Fix type errors at the root cause — do not cast to `any` or add `@ts-ignore`.

### Production Deployment (Railway)
- **Project:** `marvelous-freedom`
- **Auto-deploy:** `git push main` triggers Railway build and deploy
- **Railway CLI:** `/opt/homebrew/bin/railway` (authenticated)
- **Database:** PostgreSQL service on Railway, `DATABASE_URL` injected at runtime
- **Volume:** `packpoints-game-volume` mounted at `/app/data/masked-cards` (masked-card cache). Railway mounts volumes root-owned, and the app runs as non-root `packpts` — so `start.sh` boots as root, chowns the mount, then drops privileges via `su-exec` (the Dockerfile has no `USER` directive for this reason). Do NOT re-add `USER packpts` to the Dockerfile or set `RAILWAY_RUN_UID=0`; either breaks the chown-then-drop pattern. Before this fix (July 2026), every new masked-card write failed with EACCES in production.

### User-data retention (owner mandate — usernames, password hashes, PackPTS history must never be lost)

Three layers, all writing compressed `pg_dump` restore points (full DB: users, wallets, ledger, everything) to `/app/data/masked-cards/.db-backups/` on the persistent volume:
1. **Boot dumps** (`pre-push-*.dump`, `start.sh`): before every schema push; dump failure skips the push. Keep 14.
2. **Daily dumps** (`daily-*.dump`, `server/services/dbBackupService.ts`): scheduled every 24h plus a startup catch-up when no dump is fresher than 20h. Keep 30.
3. **Owner retrieval without CLI:** `GET /api/admin/backups` (list) and `GET /api/admin/backups/:name/download` (stream) — admin-only.

Restore procedure: download a `.dump`, then `pg_restore --clean --if-exists -d <DATABASE_PUBLIC_URL> <file>` from a machine with TCP egress (pg_restore v17+).

### Logout + admin-guard repairs (July 2026)

Logout: the real endpoint is `POST /api/auth/local-logout` (destroys session, clears cookie). All logout buttons call `useAuth().logout` which POSTs it then hard-navigates to `/`. A compat shim `GET /api/logout` (destroy + redirect `/`) exists for stale bundles and legacy-era links — previously that URL fell into the SPA catch-all and rendered the 404 page with the session still alive. `ProtectedRoute` gates admin routes on `user.isAdmin` (the API's real field); it briefly gated on a nonexistent `role` field, which bounced every authenticated user — including real admins — from all `/admin/*` routes to the homepage. Dead client targets `/api/login`, `/game`, `/play`, and the server redirect `/settings/accounts` were repointed to real routes; `/admin/set-of-week` is now routed and in the admin sidebar.

### Canonical host (July 2026)

`packpts.com` (apex) is the canonical host. The server 301-redirects `www.packpts.com` GET/HEAD page navigations to the apex (server/index.ts, before CORS middleware; `/api/*` and `/ws` are exempt so in-flight clients don't break). Session cookies are host-only, so one canonical host prevents the www/apex session split.

### Legacy-origin eviction (July 2026)

Browsers that visited the pre-Railway deployment of packpts.com can carry a foreign service worker that keeps serving the old app shell indefinitely (this app registers no SW of its own, and a failed SW update-fetch does NOT unregister an existing worker). Two-layer fix: self-destructing workers served at `/sw.js`, `/service-worker.js`, `/serviceworker.js` (client/public/ — install → clear caches → unregister → reload clients), plus a boot-time purge in `client/src/main.tsx` that unregisters any registration found and reloads once (sessionStorage-guarded). Do not remove these files even though this app has no service worker — they are the eviction mechanism. Also: `ALLOWED_ORIGINS` in Railway must list BOTH `https://packpts.com` and `https://www.packpts.com` (exact-match list; the WebSocket handshake hard-403s unlisted origins).

### ⚠️ Known infrastructure issue — apex domain points at a retired pre-Railway host
`packpts.com` (apex) DNS A record (`34.111.179.208`, name.com-hosted DNS) still points at a retired legacy deployment from before the Railway migration; it serves a stale build with no working API. `www.packpts.com` correctly points at Railway and is fully functional. Fix requires a DNS change at name.com (owner credential): replace the apex A record with an ANAME/ALIAS to `packpoints-game-production.up.railway.app`. Until then, use `www.packpts.com` for all production testing. Once DNS is corrected, the legacy deployment must also be deleted at its host.

### Running Migrations Against Production
```bash
# Get the public DB URL from Railway Postgres service
railway variables --service Postgres --json | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['DATABASE_PUBLIC_URL'])"

# Run a SQL migration file
/opt/homebrew/Cellar/libpq/18.1_1/bin/psql "<DATABASE_PUBLIC_URL>" -f migrations/<file>.sql

# Or push full schema via Drizzle
railway variables --service Postgres --json | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d['DATABASE_PUBLIC_URL'])" | \
  xargs -I{} sh -c 'DATABASE_URL="{}" npm run db:push'
```

**⚠️ Always run migrations immediately after pushing code that references new columns. The app will 500 on any query touching a column not yet in production.**

### API Version Canary

`GET /api/version` is the deploy verification canary. As of Prompt 7, the response includes a git commit SHA baked in at build time:

```json
{ "v": 14, "sha": "a1b2c3d", "deployed": "2026-06-14", "build": "prompt-7-sha-canary" }
```

**Deploy verification checklist** (run after every `git push main`):
1. Wait for Railway to show deployment status → **SUCCESS**
2. `curl -s https://www.packpts.com/api/version` — confirm `sha` matches `git rev-parse --short HEAD`
3. If `sha` is `"dev"`, the build did not inject correctly — check `script/build.ts` define block
4. If `v` is stale, Railway may still be deploying — wait 30s and retry

**How the SHA is injected:**
- `script/build.ts` calls `git rev-parse --short HEAD` at build time (Railway runs this during build)
- Falls back to `RAILWAY_GIT_COMMIT_SHA` env var (Railway injects this automatically)
- Final fallback: `"dev"` (local dev where git may not be available)
- esbuild `define` replaces `process.env.BUILD_COMMIT_SHA` with the literal SHA string in the bundle

---

## 25. Known Bugs, Gaps, and Risks

### Gameplay
- [x] ELO-based matchmaking with expanding band (Prompt 19): matchmaking_tickets.elo_rating column stores player ELO at queue-join time; pairing SQL uses ABS(elo1-elo2) <= LEAST(500, 100 + 50*floor(maxWaitSeconds/30)); starts at ±100, expands ±50 per 30s, caps at ±500 after ~4 min
- [x] AI fallback bot opponent (Prompt 20): after 60s in queue with no human match, dbQueue triggers createBotMatch(); bot accuracy scales with human ELO (1000→55%, 2200→92%); bot answers via scheduleBotAnswers() polling loop every 500ms, random delay 1.5–7s per question; anti-farm cap: 5 bot games per day per user (extras get bot_unavailable); users.is_bot column + seed bot user `packpts-bot-00000000-0000-0000-0000-000000000001`
- [ ] Wager match settlement is still in progress (confirmed not complete)
- [ ] Adaptive difficulty (personalized card selection) not implemented
- [ ] Tournament mode not implemented (UI shows "coming soon")

### Security & Fraud
- [ ] No automated risk scoring engine (event logging exists, scoring/auto-action does not)
- [x] Chargeback → wallet freeze + REVERSAL ledger entry wired (Prompt 13): `charge.dispute.created` → `handleChargeDispute()` now calls `walletService.reversal()` after freezing user, mirrors `handleChargeRefunded` pattern
- [x] Hold period on PURCHASED bucket points (Prompt 14): `packpts_bucket.redeemable_at` column + `packpts_expiration_policy.purchased_hold_days` config; `getUserOpenBuckets()` and `getUserOpenBucketsFIFO()` filter out buckets in hold; migration applied to prod
- [x] Full attribution loop instrumented (Prompt 15): card_views table + POST /api/attribution/card-view; attributed_purchases table + GET /api/webhooks/epn-postback resolves EPN customId → outbound_click → user; migration applied to prod
- [x] Admin retention cohort dashboard (Prompt 16): GET /api/admin/retention returns DAU/WAU/MAU (from user_presence.last_seen_at) + weekly D1/D7/D30 cohort retention rates (last 13 weeks); no new schema needed
- [x] First-session onboarding tutorial (Prompt 17): user_onboarding table; GET /api/onboarding/status, POST /api/onboarding/start (returns random playable guided card), POST /api/onboarding/complete (marks done, awards 50 PackPTS via idempotency key `onboarding_reward_${userId}`, returns nextAction hint); migration applied to prod
- [x] Web push + email re-engagement (Prompt 18): push_subscriptions table; GET /api/push/vapid-public-key, POST/DELETE /api/push/subscribe, POST /api/admin/push/send-test; pushNotificationService.ts handles streak_at_risk / daily5_live / match_invite via VAPID (env: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY); graceful no-op if VAPID unconfigured; web-push v3 package added
- [x] Viral loop hardened (Prompt 21): POST /api/share/generate returns referral code + referralUrl + share text variants (twitter/general/sms); reuses recent INVITE link (24h window); registration auto-attributes SIGNUP event when referredByCode present + calls grantReferralWelcomeBonus; all idempotent via unique constraint + ledger idempotency key
- [x] Set of the Week (Marketing Prompt 2, 2026-07-06): admin-selectable featured card set with configurable point multiplier (default 1.5x). New `set_of_week` table (setId FK to game_sets, multiplier, startsAt, endsAt). `getActiveSetOfWeek()` service with 60s cache. `awardDailyBaseForCorrectCard()` accepts optional `gameSetId` and applies multiplier to `finalPts` before daily-cap check. `gameSetId` propagated through `GameplayCard`, `storage.ts`, solo route, and match engine. Admin CRUD: GET/POST/DELETE `/api/admin/set-of-week`. Public: `GET /api/set-of-week/active`. Admin page at `/admin/set-of-week`. Home page shows dismissible banner when a set is active. GameCard shows "FEATURED Nx PTS" chip via `isSetOfWeek`/`setOfWeekMultiplier` props (wiring in game.tsx/daily5.tsx to follow). Migration required: `set_of_week` table.
- [x] Double-sided referral rewards (Marketing Prompt 1, 2026-07-06): grantReferralBonus() now credits BOTH the referrer (default 500 PackPTS, eventType "referral_first_match_referrer") AND the invited user (default 250 PackPTS, eventType "referral_first_match_referred") in a single atomic transaction on FIRST_MATCH. Amounts are admin-configurable via appConfig keys "referral_referrer_bonus_pts" and "referral_referred_bonus_pts". Legacy idempotency key guard prevents double-grants for any attributions processed by the old one-sided code. invite.tsx and friends.tsx updated to communicate the two-sided offer. friends.tsx adds a Refer & Earn card showing the user's shareable link with both bonus amounts.
- [ ] No multi-account detection automation
- [ ] No device-level banning
- [x] Default hash salts in code — `enforceProductionSecrets()` now fails fast in prod if defaults are present (Prompt 6, 2026-06-14)
- [x] `JWT_SECRET` dev fallback — `enforceProductionSecrets()` now fails fast in prod if JWT_SECRET equals the dev constant (Prompt 6, 2026-06-14)

### Payments
- [ ] Apple IAP receipt verification endpoint exists but full iOS payment flow untested in production
- [x] Subscription lifecycle webhooks verified and completed (Prompt 24): customer.subscription.deleted now explicitly calls storage.revokeEntitlement() instead of "expire naturally"; invoice.payment_failed added — sends dunning email on attempt 1, revokes entitlement after 3 failures; customer.subscription.created wired to handleSubscriptionUpdated
- [ ] No automated refund processing

### Marketplace
- [x] Listing price validation against CardHedge market data (Prompt 23): POST /api/marketplace/validate-price takes cardhedgeCardId + claimedPriceCents, compares to raw (ungraded) CardHedge price from cache or API; rejects if ratio > 2.5x; redemptionQuoteRequestSchema accepts optional cardhedgeCardId, redemption quote endpoint validates and rejects inflated prices before quote creation
- [ ] Goldin integration appears to use curated/manual listings vs. live API
- [ ] Redemption admin review queue exists but no notification system for pending reviews

### Data Model
- [x] baseballCards table decision (Prompt 25): KEEP as intentional fallback. playableCards is authoritative; baseballCards provides player-name options pool when playableCards is empty (cold-start / between imports). Decision documented in server/tests/baseballCardsLegacy.test.ts (5 tests). Deprecation criteria: 1) playableCards always ≥50 rows in prod, 2) matchService.initialize() refactored, 3) imageValidation.ts branch removed, 4) storage.ts seeding removed.
- [ ] Card masking regions must be configured per card set — new sets without masks will leak player names

### Testing
- [x] Unit test suite exists (Vitest): 14 test files, 223+ tests total — masking (33 tests), reward engine pure (30 tests), reward engine DB integration (6 tests), wallet (23 tests, strengthened Prompt 11: ledger invariant, frozen account, FIFO bucket depletion, EXPIRE reconciliation), purchase fulfillment (27 tests), and more
- [x] FIFO bucket expiration job is scheduled via pgJobQueue (`packpts_expiration`) and runs daily at `EXPIRATION_RUN_HOUR_UTC` (default 6 UTC). Inactivity expiration still runs only via manual trigger / standalone script.
- [x] Automated masking verification tests (server/tests/masking.test.ts — 33 tests, Prompt 9, extended June 2026)
- [ ] No load testing for WebSocket concurrent matches
- [ ] No payment webhook replay tests in CI

### Deployment
- [ ] Railway auto-deploy may not trigger reliably (see CLAUDE.md notes on webhook, manual redeploy)
- [ ] No staging environment documented
- [ ] No database backup/restore procedure documented

---

## 26. Non-Negotiable Product Rules

**Every future developer and AI agent must follow these rules. Violations can break the product, lose revenue, or enable fraud.**

- [ ] **NEVER leak the player name before answer submission** — in images, API responses, DOM, network, logs, filenames, alt text, or metadata
- [ ] **NEVER award points twice for the same event** — all point awards must use idempotency keys
- [ ] **NEVER process payment webhooks without idempotency** — check `purchaseEvents.eventId` before crediting
- [ ] **NEVER allow redemption of frozen or suspended wallet points** — check wallet status before any spend
- [ ] **NEVER break affiliate attribution** — outbound URLs must preserve EPN parameters; test after any change to marketplace routes
- [ ] **NEVER lower marketplace margin rules without explicit approval** — `profitPolicy.minMarginM` is a financial control
- [ ] **NEVER modify wallet logic without ledger-level accounting** — every balance change needs a ledger entry
- [ ] **NEVER assume card data is clean** — images may be broken, names may be wrong, masks may not cover properly
- [ ] **NEVER invent player or card metadata** — all card data comes from CardHedge or admin import
- [ ] **NEVER treat planned features as implemented** — check the codebase, not this document, for current state
- [ ] **NEVER use `await import()` for shared modules in server code** — static imports only (esbuild CJS breaks dynamic imports)
- [ ] **NEVER use static imports of native modules (sharp, ffmpeg) in route files** — lazy-import only to avoid server startup crashes
- [ ] **NEVER commit and push without `git pull --rebase` first** — prevents non-fast-forward rejections on Railway

---

## 27. Future Roadmap

### Immediate Fixes
- Wire ELO ratings to matchmaking queue (schema exists, needs logic)
- Implement automated chargeback → wallet freeze flow
- Add hold period on purchased points before redemption eligibility
- Ensure all production hash salts are non-default
- Expand unit test suite (masking, reward engine, wallet done — remaining: webhook idempotency, marketplace, ELO)

### Near-Term Product Improvements
- Tournament mode (brackets, entry fees, prize pools)
- Pack-opening card-reveal animation experience
- AI fallback opponent for empty matchmaking queue
- Adaptive difficulty (ELO-based card selection per user)
- Push notification system (streak reminders, match invites, daily challenge)
- Enhanced onboarding flow with tutorial game

### Marketplace Expansion
- Live Goldin API integration (replace manual curation)
- Additional affiliate partners beyond eBay and Goldin
- Marketplace listing price validation against market data
- Enhanced search and filtering (by player, year, grade, price range)
- Purchase confirmation flow with PackPTS credit application

### Fraud / Risk Maturity
- Automated risk scoring engine consuming rollup data
- Admin fraud review queue with risk context
- Multi-account detection (device fingerprint + IP clustering)
- Velocity-based alerts (many redemptions, sudden point spikes)
- Device-level banning
- Machine-learning anomaly detection on answer patterns

### Mobile / App Store Readiness
- iOS native app (SwiftUI, 22-24 week plan documented in `iOS-Adaptation-Plan.md`)
- Apple IAP (StoreKit 2) for digital goods
- Sign in with Apple (required if WorkOS OAuth is offered)
- Haptic feedback, push notifications, WidgetKit
- Android app (no current plan documented)

### Long-Term Vision
- Expand beyond baseball: basketball, football, hockey, soccer cards (multi-sport card sets already in schema)
- Battle pass / seasonal content
- Social features: guilds/teams, spectator mode, live tournaments
- Creator partnerships (card artists, athletes)
- Physical card marketplace (not just affiliate — direct sales)
- Targeting Fanatics ecosystem acquisition at $1B valuation

---

## 28. Acquisition-Readiness Assessment

This section documents what a potential acquirer would evaluate in technical and financial due diligence, what is already in place, and what would need to be addressed before a sale process.

### Ownership and IP

| Item | Status |
|---|---|
| Domain `packpts.com` | Owned — registered under dtmaloney@gmail.com |
| Codebase | Private GitHub repo, single owner |
| Brand / trademark | Not registered (risk item — register "PackPTS" before a process) |
| Card data | Licensed via eBay EPN affiliate + CardHedge API (neither grants IP ownership; player names/stats are not protectable) |
| User data | Owned by operator; governed by platform TOS |

### Revenue Infrastructure

| Item | Status |
|---|---|
| Payment processor | Stripe (live mode, test mode both wired) |
| Subscription tiers | Multiple tiers in `subscriptionProducts` table; lifecycle webhooks live |
| Affiliate revenue | eBay EPN (custom ID attribution, postback confirmed) |
| Revenue recognition | Stripe `invoice.paid` → `paymentEvents` ledger entry — auditable |
| Dunning | Implemented: email on attempt 1, entitlement revoke on attempt 3+ |
| Chargeback handling | `charge.disputed` → needs manual review; auto-freeze not yet implemented |

### Key Metrics a Buyer Will Request

These can all be derived from the production DB at the time of sale:

| Metric | How to Compute |
|---|---|
| Weekly Active Players (WAP) | Users with ≥1 finished match in last 7d — north-star metric |
| DAU / WAU / MAU | `user_presence.last_seen_at` window queries |
| D7 / D30 Retention | Cohort SQL on `users.createdAt` vs `user_presence.last_seen_at` |
| MRR | Sum of active `subscriptionProducts.priceCents` per billing cycle |
| ARPU | MRR ÷ MAU |
| Affiliate GMV | Sum of `attributedPurchases.salePriceCents` in trailing 90d |
| Signup conversion | `users` created → first match completed (funnel via `userOnboarding`) |

### Technical Diligence Checklist

| Item | Status | Notes |
|---|---|---|
| TypeScript strict mode | Pass | `tsc --noEmit` runs clean |
| Unit test coverage | 73 tests passing | Covers wallet, masking, rewards, fraud, legacy fallback |
| E2E test coverage | None | Playwright suite exists but empty — gap |
| Database migrations | Drizzle ORM, 19 migrations | All applied to prod |
| Secrets management | Railway env vars only | No secrets in git |
| Secret rotation process | Manual (Railway dashboard) | Not automated |
| Rate limiting | Per-route Express middleware | Login, checkout, game start, registration |
| Fraud controls | Risk pipeline live (auto-freeze on HIGH tier) | Chargeback auto-freeze not yet wired |
| Admin panel | Full admin routes (user mgmt, risk, wallet, content) | No dedicated admin UI — API only |
| Logging | Structured JSON request logger + error monitor | No centralized log aggregation (Railway logs only) |
| Monitoring | None | No APM, no uptime alerting, no error budget |
| GDPR / CCPA | No data deletion endpoint | Gap — must implement before scale |
| Terms of Service | Not verified present | Must confirm ToS and Privacy Policy pages exist |
| Accessibility | Not assessed | Gap for any regulated-market buyer |

### Technology Stack (for Buyer Diligence)

- **Runtime:** Node.js + Express, TypeScript end-to-end
- **Database:** PostgreSQL via Railway (Drizzle ORM, no raw SQL in app code)
- **Frontend:** React + Vite, Tailwind CSS
- **Auth:** WorkOS (SSO) + local username/password sessions
- **Payments:** Stripe (subscriptions + one-time purchases)
- **Hosting:** Railway (app + DB — single provider dependency)
- **CDN / Static:** None — Railway serves static assets directly
- **Push Notifications:** web-push (VAPID), no mobile push
- **AI / LLM:** OpenAI (social media content agent — optional, feature-flagged)

### Single-Provider Dependencies (Risk Items)

| Dependency | Risk | Mitigation |
|---|---|---|
| Railway (hosting + DB) | Single point of failure; vendor lock-in | Export DB and containerize to migrate; no Railway-specific APIs used |
| Stripe | Payment processor lock-in | Standard Stripe — portable to Stripe on any host |
| WorkOS | Auth provider | Sessions also support local auth; WorkOS is additive |
| CardHedge API | Card price data source | API keys in env; no proprietary integration |
| eBay EPN | Sole affiliate revenue source | Add secondary affiliate (Fanatics, PSA, COMC) to diversify |
| OpenAI | Social agent | Feature-flagged; disabling is a one-env-var change |

### What Must Be Resolved Before a Sale Process

1. **GDPR/CCPA data deletion** — implement `DELETE /api/account` that purges PII from all tables
2. **Chargeback auto-freeze** — `charge.disputed` webhook → instant wallet freeze + reversal ledger entry
3. **Trademark registration** — file "PackPTS" and the lightning-bolt logo before any LOI
4. **Uptime monitoring** — add Datadog / Sentry / Uptime Robot so a buyer sees SLA history
5. **E2E test suite** — at minimum a Playwright smoke test covering signup → game → marketplace
6. **ToS / Privacy Policy** — legal review to confirm COPPA, state gambling law compliance (trivia ≠ gambling, but document the analysis)
7. **Point-in-time DB backups** — verify Railway PITR is enabled and tested

### Acquirer Fit

| Buyer Profile | Rationale |
|---|---|
| **Fanatics / Topps** | Direct strategic fit — baseball cards + trivia + marketplace |
| **Penn Interactive / DraftKings** | Engaged user base with points economy — tuck-in for sports trivia vertical |
| **Collectors Universe / PSA** | Marketplace + card-valuation angle |
| **Candy Digital / Dapper Labs** | Web3 pivot: NFT-backed card ownership layer |
| **Private equity roll-up** | Sports memorabilia + gaming platforms are active roll-up targets |

Long-term stated target: **Fanatics ecosystem at $1B valuation.**

---

## 29. Making Layer — User-Created Sets

Shipped July 2026 across seven sequential PRs (see `MAKING_LAYER_PROMPTS.md` for the original specs). Lets any user build a playable set from photos of their own cards, share it, co-create with a friend, and surface purchase links to players.

### Schema

- `game_sets` gained: `created_by_user_id` (FK users, null for staff sets), `co_creator_user_id` (FK users, set by collab publish), `maker_note` (text, ≤140 chars enforced at API layer), `is_user_created` (boolean, indexed).
- New table `collaboration_sessions`: `host_user_id`, `guest_user_id` (null until joined), `status` (`waiting`/`active`/`published`/`abandoned`), `nominated_cards` + `approved_cards` (JSONB arrays), `set_name`, `maker_note`, `published_set_id` (FK game_sets), `created_at`.
- User-created `playable_cards` rows use `cardhedgeCardId: snap2set:<uuid>` (never a real Card Hedge id). They must carry `image_url` (uploaded card photo) and `category` (= set sport) or `getRandomCardsFromSet` in `server/storage.ts` filters them out of gameplay.
- New table `card_photos`: `data` (bytea, sharp-downscaled JPEG), `content_type`, `uploaded_by_user_id`, `created_at`.
- Migrations: `migrations/add_maker_fields_to_game_sets.sql`, `migrations/add_collab_sessions.sql`, `migrations/add_card_photos.sql`. **The production database is Railway Postgres** (see CLAUDE.md) — its schema is synced automatically at every deploy by `start.sh` running `drizzle-kit push --force`, so these SQL files are reference artifacts; the Supabase project holds a parallel copy the app never reads.

### Server routes

- `POST /api/sets/identify-card` (auth, 20/hr/user via `cardIdentifyLimiter`) — OpenAI gpt-4o vision via `server/services/snapToSet.ts`, runs `classifyCard()` playability check, then stores the photo (sharp-downscaled to ≤1024px JPEG q80) in the `card_photos` Postgres table and returns identified card + `imageUrl` pointing at `GET /api/card-photos/:id`. **Storage is the production Postgres (Railway) by owner directive — no external object store.**
- `GET /api/card-photos/:id` (public) — serves the stored photo with `Cache-Control: immutable` (1 year).
- `POST /api/sets/create` (auth) — 5–20 cards, creates `game_sets` row (`isUserCreated: true`) + `playable_cards` rows with `imageUrl` and `category`.
- `GET /api/sets` (public) — browse user-created sets ordered by play count; powers `/sets`.
- `GET /api/sets/:id` (public) — set metadata, maker + co-creator usernames, card count, play count.
- `GET /api/my-sets` (auth) — the user's sets with play counts (profile "My Sets" tab).
- `GET /api/sets/:setId/cards/:cardId/listings` (public) — top 3 cheapest marketplace listings for the card (player + year + brand query); always returns `{ listings: [] }` on failure, never errors.
- `POST /api/sets/:setId/cards/:cardId/log-click` — logs to `outbound_clicks` with `pagePath: 'set-reveal'` for commerce attribution.
- `server/routes/collab.ts` (mounted in routes.ts): `POST /api/collab/create`, `GET /api/collab/:id`, `POST /api/collab/:id/join`, `/nominate`, `/approve` (can't approve own nomination), `/publish` (host only, ≥5 approved cards; sets `coCreatorUserId`).
- Admin: `GET /api/admin/metrics/making-layer` — sets/day (30d), maker rate (creators ÷ MAU), set play depth, top-10 sets with outbound click counts.

### Play count convention

`game_sessions` has no `set_id` column. Play counts are derived with the JSONB query `(questions->0->'card'->>'gameSetId') = <setId> AND status = 'completed'`. Any change to how questions embed `gameSetId` breaks every play-count surface (set page, my-sets, admin metrics, maker digest).

### WebSocket (collab realtime)

`server/websocket.ts`: `collabConnections` map, `collab:join`/`collab:leave` client messages, `broadcastToCollab(collabId, message)` export used by the REST routes to push `collab:guest_joined`, `collab:card_nominated`, `collab:card_approved`, `collab:published`.

### Client pages

- `/make` — 3-step wizard (Upload → Review → Publish) + "Make it together" button that creates a collab session.
- `/sets` — community browse grid with search; also in mobile nav ("Browse") and home game-modes grid.
- `/sets/:id` — public set page; shows "by {maker} & {co-creator}".
- `/collab/:id` — host/guest co-creation with live updates.
- Profile "My Sets" tab; in-game maker note shown above the question for user-created sets; post-reveal "Find this card" listing tiles (correct answer + user-created set only).

### Maker digest email

One email per set per day (in-memory dedup `Set` keyed `${setId}:${date}` in routes.ts — resets on deploy), sent via `sendMakerDigestEmail` after a completed session on a user-created set.

### Known gaps

- **Legacy user sets:** sets published before the photo-storage fix (July 2026) have cards with no `image_url`/`category` and silently fall back to legacy cards during play.
- **Orphan photos:** `card_photos` rows are created at identify time; if the user abandons the wizard without publishing, the photo is never referenced. No cleanup job yet.
- **Maker digest dedup is in-memory** — a redeploy can cause a second same-day email.
- **Collab swap** (`collab:swap` in the original spec) was not implemented; approve-only flow shipped.
- The R2 upload path in `server/services/socialMedia/imageStorage.ts` remains for the social-media pipeline but is NOT used by the Making Layer (owner directive: no new third-party services).

---

## 30. Instructions for Future Claude Code Sessions

**Read this file before making any changes to PackPTS.**

1. **Read PACKPTS_PROJECT_CONTEXT.md first.** Understand the product, architecture, and constraints before touching code.

2. **Inspect the relevant code before editing.** This document describes intent and architecture. The codebase is the source of truth for current implementation.

3. **Update PACKPTS_PROJECT_CONTEXT.md whenever you change:**
   - Product behavior or game modes
   - Database schema (new tables, columns, or migrations)
   - API routes (new endpoints or changed contracts)
   - Environment variables
   - Payment or marketplace logic
   - Fraud controls or risk pipeline
   - Core assumptions documented here

4. **Do not rely on memory alone.** Re-read relevant sections of this file and the actual code before making assumptions.

5. **Do not rewrite large areas unnecessarily.** Follow the Surgical Changes principle in CLAUDE.md. Touch only what you must.

6. **Preserve non-negotiable rules (Section 26).** Before any change to card display, answer payloads, wallet operations, payment webhooks, marketplace links, or scoring, verify the relevant rules are maintained.

7. **Before changing gameplay, verify:**
   - Masking still works (player name not leaked in any channel)
   - Scoring matches the reward policy
   - Daily/per-match caps are enforced
   - Answer idempotency is preserved

8. **Before changing payments, verify:**
   - Webhook idempotency (duplicate event → no duplicate credit)
   - Product guardrails (margin check passes)
   - Checkout session lifecycle is correct

9. **Before changing marketplace logic, verify:**
   - Affiliate attribution parameters are preserved in outbound URLs
   - Margin calculations match `profitPolicy`
   - Redemption reservation prevents race conditions

10. **At the end of any meaningful change, ask yourself:** Does PACKPTS_PROJECT_CONTEXT.md need an update? If yes, update it in the same session.

11. **Use the API version canary** (`GET /api/version`) to confirm deploys before testing.

12. **Run `git pull --rebase` before committing and pushing.**

13. **PackPTS runs exclusively on Railway.** No other hosting platform may ever be used, referenced, or reintroduced. Any artifact from a pre-Railway host found in the codebase must be deleted on sight and the deletion logged in the commit message.

---

*This document was generated by deep inspection of the PackPTS codebase on 2026-05-26. It reflects the actual state of `shared/schema.ts`, all server routes, all client pages, all services, and all configuration files at that time. Sections marked "planned" or "not implemented" reflect intent from project documentation, not code.*
