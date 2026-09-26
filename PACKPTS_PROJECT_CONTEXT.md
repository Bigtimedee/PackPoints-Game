# PackPTS Project Context

> **Canonical project brain.** Every future Claude Code session, developer, agent, or AI tool working on PackPTS must read this file before making changes. If your work changes product behavior, architecture, schema, routes, environment variables, payments, fraud controls, marketplace logic, or core assumptions, update this file in the same session.

**Last verified against codebase:** 2026-09-26 (A live mask request for a card whose warm bake is waiting on the live gate promotes that bake, so it can take a slot and its deadline can start. The warmup job releases its pool client after the claim, before the set is baked. Solo replace-card writes only `questions[index]` and never `current_question_index`. Answer, advance, skip, Daily 5, and 1v1 session writes are field-scoped or row-locked. Replacement uses the shared deal filter, prefers a baked v4.5 JPEG, and tries three cold candidates before 404. A `{cardId}_v4.5.fail` sidecar returns 422 with no bake, and the client replaces instead of retrying. Boot enqueues a low-priority mask warmup (covers for 8 distinct players first, concurrency 2) when the mask version changed or a set is short of baked covers. Prefetch keeps N+1 and N+2 Image objects alive. A reveal whose image-cache row is bad still serves a real scan from the playable card URL. Prior: The mask-band guard is layout-aware and ships in report mode (`MASK_BAND_GUARD=report`, the default). A top band over 35% of the card or a bottom band over 55% would be `mask_band_oversized`. A full-width band that starts more than 3 points from the top and ends more than 3 points from the bottom would be `mask_band_misplaced`. Report mode logs one line per set and excludes nothing. `MASK_BAND_GUARD=enforce` excludes those cards. A clean bottom plaque at 46%, including 2024 Basketball and 2022 Chronicles, stays. `CURRENT_MASK_VERSION` stays `v4.5`. The player-name blocklist still enforces immediately. Prior: Named cards on the hardcoded blocklist stay out of new solo deals, Daily 5, 1v1, Beat-me, replace candidates, and /sets covers. A stored Daily 5 card on that list is swapped for the next eligible card before it is served. Prior: A /sets cover with no masked URLs keeps the cream card and draws the same solid plaque bar and gold seam as the fanned thumbs, with no PTS label and no photo. Prior: Name-plate masks are v4.5. The top and bottom bands follow the detected plate on that scan, with padding and a safety floor, so a tight 1989 Fleer crop cannot end the band through the name. A bottom plaque uses that name-sized band instead of the fixed ~45% slab. A post-bake check drops any card that still shows name text from solo, Daily 5, 1v1, Beat-me, and /sets covers, and records the reason on the mask sidecar. Set covers dedupe players and send a per-slot ETag. `npm run mask:sweep` reports pass/fail per active integrated set. Prior (2026-09-25): Fanned thumbs on /sets draw a solid name plaque with the gold seam and no label text. The short-shelf banner is not shown. An index title includes the set's brand when that brand is stored and missing from the set name: live "2024 Basketball" with brand Topps reads "2024 Topps Basketball". The year column is not written into the title. Prior: Public /sets covers are baked v4.4 masked JPEGs for cards that already have a mask-ready sidecar, or the cream placeholder when none is ready. GET /api/sets and GET /api/sets/:id do not return raw card photo URLs, player names, or card ids. Prior: SIGTERM stops new WebSocket upgrades, closes `/ws` clients with 1001 Going Away, and terminates any still open after 500ms so `server.close()` finishes when in-flight HTTP responses finish. The 5s hard cap and the schema-push process-group kill stay. A 1001 close reconnects and does not raise an error toast over the card. Prior: SIGTERM stops accepting immediately and exits within 5s, including the 2s close grace, because the masked-card volume keeps the next container from starting until this process exits. `PUT /api/admin/playable-sets/:id` drops mask-ready sidecars when it sets the set inactive. A successful send logs the Resend id, subject, and a masked recipient (`d***@domain`). A failed password reset logs the masked recipient and the error, never the token or the reset link. Prior: User-visible copy says PackPTS, including the email sender, subjects, headers, footers, and sign-offs. Player-facing em dashes and en dashes use the Design rewrites. A missing value hides the Sets point-range badge, the listing price, the receipt Created row, and a share-image score. A challenge share with no score also drops `points: the record to beat` and centers `Card experts only.` X hotfix QA notes (`CAPTIONS.md`, `SOCIAL_PNG_QA.md`, and `QA_PASS.txt`) live in `docs/x-hotfix-2026-09-13/`, not `client/public`. Prior: The process entry is `server/entry.ts`. It binds the port before the schema step. During that window it serves `/api/version`, a warm `/api/play/m/` JPEG that has a `{cardId}_v4.4.ok` sidecar, and SPA HTML for client routes. Other `/api/*` routes, and server routes outside `/api` (`/out/*`, `/p/*`, `/r/*`, `/auth/*`, `/wallet`, and every other non-`/api` route registered under `server/`), return 503 with `Retry-After: 2`. When the `shared/schema.ts` sha256 matches the last successful push and one catalog probe shows every table, column (compatible type), unique index, and primary key, boot logs `phase=fast_schema_ok` and opens DB routes without waiting. `drizzle-kit push --force` still runs on that boot, in the background, with `lock_timeout=3s`. A hash change or a failed probe logs `phase=fast_schema_fallback` and routes wait for the push, including `pg_dump` when the hash changed. A foreground push longer than 120s exits 1. A background push that fails or times out logs FATAL, clears `.schema-push-hash`, and does not exit. After routes are ready, a background walk writes missing `.ok` sidecars for cached `{cardId}_v4.4*.jpg` files the database still allows to serve masked (in playable_cards or baseball_cards, still playable, game set not inactive, not name-exposure or broken-image quarantined, same orientation checks as `/api/play/m/`). `invalidateMaskReadySidecar` deletes every `{cardId}_*.ok` when image quarantine, a bad cache status, name exposure, admin unplayable, set deactivation, or hard-delete makes the card ineligible, 50 files per tick. The masked route writes that sidecar when it serves a cached file that passed those checks. `pg_dump` is killed after 90s and the push is skipped. Storage setup longer than 60s logs and exits 1. Job workers start after routes are ready. `start.sh` chowns only the volume mount root, and skips that when `stat` already shows the packpts uid. SIGTERM/SIGINT call `server.close()` immediately so the process stops accepting, close idle keep-alives, let in-flight requests finish, and exit within 5s. `closeAllConnections` and the 2s close grace sit inside that cap. The pool closes on the way out. The schema push is its own process group, and SIGTERM kills that group. `railway.json` sets `healthcheckPath` `/api/version`, `healthcheckTimeout` 120, and `drainingSeconds` 30. `overlapSeconds` is not set while the masked-card volume is mounted; zero downtime needs that cache on a bucket. A masked `/api/play/m/` load and the version poll retry once after about 2s on 502, 503, or a network error. Unmasked `/api/images/card` and `/api/play/r/` are not retried before a successful submit. A missing `/assets` file logs one 404 line and no stack. A failed dynamic import reloads mid-session only when a no-store probe of that chunk is 404, or `/api/version` shows a different build id. A network error retries the import once and shows a bottom-band toast. An in-flight answer submit holds. A 1v1 lobby, countdown, or matchmaking wait is held the same as an active match. Solo Play Again writes the set and card count to `sessionStorage` before a deferred reload and auto-starts that game once after reload. Orientation OCR shares a 12s budget across 0°, 90°, and 270°, cheapest first, and stops on a confident hit. Budget exhaustion uses the unturned cover-both fallback and does not quarantine. `CURRENT_MASK_VERSION` stays `v4.4`. Prior: Game Complete PTS / Accuracy / Score values stay on one `font-mono` line. The size steps from 30px down to an 18px floor by character count (`statTileValueFontPx`) so `20/20`, `12/12`, `3500`, `100%`, `12500`, and `-` stay inside the tile at 360px. No wrap, clip, or ellipsis. The three tiles still stretch to equal height (`items-stretch`, `h-full`, shared `leading-9`, no fixed height, no `overflow-hidden`) on solo and on the Daily 5 results screen Beat-me shares. Share thumbs are one `/api/play/m/` image per scored question, 64×90 at 1080. Twelve stay on one 64×90 row. Fifteen is one row of 56×79. Twenty is two 64×90 rows. The thumb strip, score, pts line, pips, and tagline are one block centered between the SOLO/date row and the footer, with at least 36px between the strip and the score digits. PTS, Accuracy, and Score labels follow the tile content width on solo and Daily 5 from 320px to 430px. A container query on the tile uses 10px and normal tracking when the content box is under 76px, and 12px with wider tracking at 76px and above. Horizontal padding is `clamp(0px, (100% - 60px) / 2, 16px)` so the 18px value floor and ACCURACY stay inside the content box. One line, no ellipsis, equal tile height. The glow band moves with the strip and stays the score-card radial, not a flat bar. A cold thumb load is retried once. Prior: Unmasked `GET /api/images/card/:id` is per player. No login and no HttpOnly anon cookie is 403 even after someone else answered that card, including today's shared Daily 5, and even if the request sends `x-packpts-fp`. The logged-in session or anon cookie must have an accepted answer for that card in solo, Daily 5, or 1v1. Admins still receive the scan. Unmasked responses stay `private, no-store` and also send CDN `no-store` plus `Vary: Cookie`, with no `X-Card-Id`. `/api/play/r/...` stays the post-submit reveal. Masked `/api/play/m/` stays `public, max-age=86400` with the v4.4 ETag. Beat-me is a score share and does not serve card scans. Prior: A landscape-aspect scan with no rotation hint is OCR'd at 0°, 90°, and 270°. 0° is kept only when that last-name hit is strictly more confident. An OCR miss does not turn the file; it paints the name band for every orientation in place and does not quarantine. `cardOrientation: "landscape"` on the set mask profile is the explicit landscape flag. No schema change. `CURRENT_MASK_VERSION` stays `v4.4`, so today's Daily 5 JPEGs stay byte-identical. The client aspect check uses the served image's dimensions and does not apply `imageRotation`. Prior: Game Complete share thumbs sit on the score-card radial glow. The strip band is not a flat `#0b0f16` bar. Prior: A visible tab polls `GET /api/version?t=<ms>` every 60s with `cache: 'no-store'`, and again on focus, visibility (including when the tab becomes hidden), pageshow, and online, because a background timer can be frozen. React Query is not used for that poll (`staleTime: Infinity`, `refetchInterval: false`, `refetchOnWindowFocus: false` would pin an old id). `/api/version`, `/`, and SPA HTML are `private, no-store` with no `ETag` or `Last-Modified`, so a conditional request cannot 304 an old document. Only Vite content-hashed build files (Rollup's 8-character base64url hash, e.g. `index-C5vKUtP0.js`) are `public, max-age=31536000, immutable`. Every other file under `/assets`, including the 14 `/assets/play-sets/*` design exports, `/assets/brand/*`, and `/assets/x-hotfix-2026-09-13/*.png` (QA markdown and `QA_PASS.txt` are in `docs/x-hotfix-2026-09-13/`, not public), stays `public, max-age=0` and revalidates. A new `buildId` calls `location.reload()` only when the player leaves the play session — a route change off that surface, or solo Play Again after Game Complete — or when the tab is idle, including a hidden tab with no session. It does not reload on Solo Next Question, when the Game Complete or Daily 5 results screen appears, between Daily 5 cards, or on a live 1v1 `next_question`. `sessionStorage` allows one reload per build id per tab. A dynamic-import failure reloads once even mid-session, because that module is gone and the page cannot render. Prior: 1v1 during the match shows correct-answer counts (`You N` / `Opp N`) from `participant.correctAnswers`, not points. Match-end point totals stay. Prior: A selected answer turns the MaskPlaque seam brand gold until deselect or submit. Game Complete share images add a client row of masked card thumbnails and do not use unmasked or reveal URLs. Prior: Per-question earnings are hidden during play. Dave, 2026-09-25, on a solo 1987 Topps Eddie Murray card: the post-answer block (`+N pts`, `Player:` fame tier, `Base: N pts`) is deleted in solo, Daily 5, 1v1, and Beat-me. Solo and Daily 5 headers no longer show a running session point total. The session total stays on Game Complete. 1v1 in-play standing is correct-answer counts (`You N` / `Opp N` from `participant.correctAnswers`), not points. Match-end point totals stay. Scoring, the ledger, and the no-earnings-toast rule are unchanged. Prior: Mask bakes rotate a sideways portrait scan upright before painting the name band, and OCR has an 8s kill that falls back to the profile band without quarantining. `CURRENT_MASK_VERSION` stays `v4.4`; rotated cards use a `_r90` / `_r180` / `_r270` filename suffix. Prior: In-game earnings toasts are removed. Solo no longer fires score-threshold, streak, or daily-cap toasts during play, including "You've earned N PackPTS this game". Error toasts on `/game/*`, `/match/*`, `/daily5`, and `/daily` sit in a bottom band above the mobile nav so they do not cover the card on a 390px screen. The points ledger is unchanged. Prior: Solo replace either swaps the masked card or, on failure, an empty body, or a 7s cap, shows retry/skip with no spinner. Submit stays disabled while that replace is in flight and while the honest error is up. A reveal URL clears the error and paints `/api/play/r/`. A card-shaped sideways scan (aspect about 1.40) is not a false reject. Checklist, team, league-leader, and non-player record-breaker cards are excluded from deals and distractors by `isNonPlayerCard`. Prior: Boot `ensureExpirationPolicy()` inserts one enabled `packpts_expiration_policy` when none is currently effective: earned 365 days, bonus 90 days, purchased null so purchased points never expire, adjustments never expire. Existing buckets with null `expires_at` are not backfilled. Admin `PUT /api/admin/expiration/policy` upserts. Scheduled dry-run and live summaries append `policy`, `nullExpiryOpen`, and `nextExpiresAt`. `EXPIRATION_MODE` stays `dry_run`. Prior: Unmasked card scans are gated. `GET /api/images/card/:id` is 403 `Cache-Control: private, no-store` with no `X-Card-Id` unless the caller is admin or that card was already answered in their solo, Daily 5, Beat-me, or 1v1 session. Guessing uses `/api/play/m/:scope/:sessionId/:index/:hmac` (no raw card id). After an accepted answer the ACK returns `/api/play/r/...` (HMAC, 10 minutes, bound to session + card). `GET /api/cardhedge/card/:id`, `/api/cardhedge/gameplay-image/:id`, and `/api/images/proxy` are admin-only. Legacy `/api/cards/:id/masked-image` still serves the name-covered JPEG and is not used in new deal payloads. Prefetch stays masked-only until the ACK reveal URL. Prior: `job_queue`, `promotions`, `user_attribution`, `creator_applications`, `partner_inquiries`, and `user_feedback` are in `shared/schema.ts`, so `drizzle-kit push --force` creates them instead of dropping them. Recurring jobs no-op with one `[JobQueue] FATAL` line if `job_queue` is missing. `packpts_expiration` defaults to `EXPIRATION_MODE=dry_run` and, in `live`, applies `gracePeriodDays` plus `EXPIRATION_MAX_BUCKETS_PER_RUN` (default 500). `stale_redemption_cleanup` defaults to `STALE_REDEMPTION_CLEANUP_MODE=dry_run`; live skips APPROVED intents that already have an outbound click, EPN postback, or purchase evidence and caps mutations at `STALE_REDEMPTION_MAX_PER_RUN` (default 50). `server/startup/ensureSchema.ts` is removed. Prior: Price capture joins `game_sets` for `year` and `sport` — `playable_cards` has no year column — and writes `player_key` with `normalizePlayerKey(player, sport || "baseball")` so prices join attention. `Dockerfile` declares `ARG`/`ENV RAILWAY_GIT_COMMIT_SHA` before `npm run build` so the Docker image, which has no `.git`, bakes the commit sha into `buildId`. Prior: Open tabs pick up a new deploy without a banner. The client build inlines `__PACKPTS_BUILD_ID__` and the same id is written into `index.html`. `GET /api/version` returns `{ buildId }` with `Cache-Control: no-store`; production reads that id from the served index so it matches the bundle. Focus, becoming visible, and client navigations compare ids (focus/visibility at most once per 60s). A full reload runs on the next navigation, or on focus when the player is not in `/game/*`, a 1v1 `/match/*`, or Daily 5 play, and never during an answer submit. `sessionStorage` allows one reload per build id. `vite:preloadError` and a failed dynamic import reload once. Gameplay, scoring, masking, and card prefetch are unchanged. Prior: Admin Playable Sets hard-delete toast craft maps Design SoR `docs/design/ADMIN_SET_DELETE_TOAST.md`: success `Set deleted` + `"[Set]" and [N] stored cards are gone.`; blocked `Can't delete yet` + Eng 409/constraint/import one-liner — never opaque `Delete failed`. Confirm modal says honest `stored cards` count. #107 cascade/honesty unchanged. Prior: Home no longer advertises the register welcome credit. Guest hero and the mid-page account card dropped `New players get 250 free PackPTS on signup`, `Claim 250 Free PackPTS`, and `Start with 250 Free PackPTS`. Quiet copy: create a free account, or play a round first. `POST /api/auth/register` still credits 250. Gate plaque, signup-modal quiet path, `OnboardingModal` quiet path, and `/invite` rewards are unchanged. Prior: First-visit `OnboardingModal` on home does not advertise `Get 250 Bonus Points Free` or a signup credit. Quiet close: create a free account, or play first. Welcome credit on `POST /api/auth/register`, gate plaque copy, the signup-modal quiet path, and `/invite` rewards were unchanged by that pass. Prior: Signup form opened from the registration gate reuses the locked headlines. No `Save Your Points!` / `+250 bonus PackPTS` banner on `SignupModal`. Welcome bonus still posts on register; `/invite` referral copy is separate. Prior: Anonymous play is capped — §5 Guest registration gate. HttpOnly `packpts_anon` plus a fingerprint hint; escrow on `anon_players` until register/sign-in/WorkOS claim writes the wallet. Soft prompt after 1 completed guest round; hard stop on a third start or the next America/Chicago day. `registeredUsersNonStaff` is still non-staff non-bot `users` only — anon rows are not users. Conversion is dashboard `anonConversion`. Copy: `docs/design/ANON_REGISTRATION_GATE.md`. Prior 2026-09-20: eBay/Goldin checkout is never rewritten — #95/#96 honesty stands. Marketplace apply now completes as **post-purchase PackPTS rebate**: wallet debit → buy at partner price via `/out/ebay|goldin` → EPN postback or confirm+evidence → USD `wallets.rebate_balance_cents` + Design receipt plaque at `/redemptions/:id`. Receipt SoR: `shared/receiptContract.ts` — chip = `intent.status` (no `UNDER_REVIEW`); `CREATED` → PENDING chip; `RECEIPT_LIST_STATUSES` includes `CREATED` so `/redemptions` list shows PENDING-chip receipts (Design GREEN soft follow-up — fixture `ea928e8b-f972-4d63-990b-20d1fd71536d` was deep-link/PNG-ok but omitted from the list); labels Partner price / Post-purchase rebate / Partner checkout unchanged; wallet header is `rebateBalanceCents`; grantMethod quiet labels on CREDIT_GRANTED; 1080 PNG via DejaVu. Design receipt re-QA fixtures: admin `POST /api/admin/qa/seed-receipt-fixtures` (default user `designqa`, listingId prefix `qa-receipt-`) upserts CREDIT_GRANTED / PURCHASE_CONFIRMED / CREATED / APPROVED / DENIED. Plan: `docs/audits/REDEEM_REAL_VALUE_PLAN_2026-09-20.md`. Product UI SoR: must not claim apply-at-checkout, eBay price cuts, or real eBay gift cards — `server/tests/ebayApplyCopyHonesty.test.ts`. Brand SoR: **B masked-P** = app/PWA/favicon/header/receipt footer; **A masked-card** = OG/social only. Admin registered-user count is non-staff + non-bot — cite `GET /api/admin/dashboard` `overview.registeredUsersNonStaff`; do not invent a number.)
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
4. After signup, the user lands on the home page and can immediately play a solo game. Home does not show Total Games Played / Cards Guessed until `totalGames ≥ 500` (or staff flag `home.show_play_vanity`). Founders FOMO is not on home. The first home visit opens `OnboardingModal` once (`packpts_onboarded`). That tour does not advertise a signup bonus. Home itself does not advertise the 250 welcome credit either; `POST /api/auth/register` still credits it.

### First Game
1. User selects a game mode (Solo is the default entry point).
2. Chooses a card set (e.g., 1987 Topps Baseball) and number of cards (5, 10, 15, or 20).
3. A card is displayed with the player name masked (blurred/pixelated regions on the card image).
4. Four answer choices are presented.
5. User selects an answer. Correct = PackPTS awarded (animated breakdown showing fame, vintage multiplier, rarity multiplier). Incorrect = 0 points.
6. After all cards, a results screen shows score, accuracy, streak milestones, a primary **Play Again** CTA (same mode + set + card count), then share / marketplace. Registered users can replay. Guests can start a second round the same America/Chicago day; a third start is refused until they register.
7. If unauthenticated, a signup modal prompts the user to keep their PackPTS. After the first finished guest round the modal is a soft prompt (secondary **Continue once more**). Create free account and Sign in open the account form with those same headlines and `PackPTS held` — no signup-bonus banner. After the hard gate there is no skip and no Play Again. An in-progress round is not interrupted.

### Ongoing Engagement
- **Daily 5 Challenge:** Same 5 cards for all users each day, with a daily leaderboard.
- **1v1 Friend Match:** Create a lobby with a 6-character join code, share with a friend, compete in real-time via WebSocket.
- **1v1 Random Match:** Join a matchmaking queue, get paired with a random opponent.
- **Streaks:** Daily play maintains a streak; milestones grant bonus points; freeze tokens protect streaks.
- **Leaderboard:** Global all-time and daily rankings.
- **Marketplace:** Browse eBay/Goldin listings contextually matched to gameplay. PackPTS apply/redeem is internal wallet spend — it does **not** reduce the eBay checkout price (audit: `docs/audits/APPLY_PACKPTS_EBAY_2026-09-20.md`).
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
  Play Again (primary) / Share / Rematch / Marketplace / Home
```

**Key invariants:**
- The player name is never visible before the answer is submitted.
- After a **successful** answer submit, the mask is removed so the full card (printed name) is visible; the next card starts masked. Helper: `shared/playCardImage.ts` `resolvePlayCardSrc`. Audit: `docs/audits/MASK_REVEAL_AFTER_SUBMIT_2026-09-16.md`.
- Points are calculated server-side using the reward engine (fame score, vintage multiplier, rarity multiplier, policy caps).
- Each answer submission is idempotent (unique constraint on matchId + userId + questionIndex).
- Daily and per-match point caps are enforced server-side.

---

## 5. Game Modes

### Solo Play
- **Status:** Implemented
- **Flow:** Select card set → select card count (5/10/15/20) → play through cards → results screen. A duplicate `POST /api/game/answer` for a question that is already stored returns that result (`idempotent: true`) and does not award points again. The client retries that POST once after `Retry-After` on 502 or 503. Game Complete **Play Again** starts a new solo session with the same set and card count (from session state / first-card `gameSetId`) when the server allows the start. If that tap is also a deploy reload, the set, card count, and mode are written to `sessionStorage` (`packpts_solo_play_again`, reason `play-again`) before the reload, and the new solo game auto-starts once after load. A later refresh does not start another game. Registered users always can. Guests get one more start the same CT day after the first finished round, then Play Again is replaced by register. Home solo and `/sets` play share that cap (both are `POST /api/game/start`). Home remains secondary. If the chosen set has fewer eligible cards than the requested count, the session deals that eligible stack and `totalQuestions` is the dealt length.
- **Scoring:** Server-side reward engine; base points inversely proportional to player fame; vintage and rarity multipliers applied; per-match cap of 1,000 pts; daily cap of 5,000 pts (configurable via `rewardPolicy` table)
- **Fairness:** Answer options are generated server-side from the card set's player pool; 4 choices per question
- **Known gaps:** No adaptive difficulty (ELO-based card selection is planned, not implemented)

### Guest registration gate
- **Status:** Implemented (2026-09-21). Stops unlimited anonymous solo/`/sets` play. Policy: `shared/anonGate.ts`. Server: `server/services/anonIdentity.ts`, `server/services/anonDaily5.ts`. Copy: `docs/design/ANON_REGISTRATION_GATE.md`.
- **Identity:** HttpOnly cookie `packpts_anon` (400 days, SameSite=Lax, Secure outside dev). The value is 32-byte hex; the database stores `sha256(SESSION_SECRET:token:value)`. Header `x-packpts-fp` (localStorage id + timezone + language + screen) is a lookup hint only — the client does not choose the id. A claimed row is never reused. Clearing both the cookie and localStorage can mint a new guest; that is the practical limit.
- **Allowance:** Counts Game Complete only (Daily 5, `/sets`, home solo). Abandon, preview, and `/make` add 0. Soft sheet once after the first completion (dismiss does not spend the remaining round). Hard when completed games ≥ 2, or the next America/Chicago day after the first completion. Same hard copy either way. In-progress Daily 5 resume is still allowed. Play Again stays on Game Complete until the hard wall.
- **Escrow:** Points sit on `anon_players` (`anon_game_credits` id `play:<sessionId>` or `daily5:<runId>`). Register, local login, and WorkOS callback call `claimAnonForUser`, which `walletService.earn`s `anon_escrow:<anonPlayerId>` and `updateUserStats`. Fast Daily 5 finishes (&lt;15s) escrow 0 and still count as a round. Guest scores are not on the public Daily 5 leaderboard until claim. The account form (`SignupModal`, including the optional path) shows `PackPTS held` and the locked gate headlines. It does not show `Save Your Points!` or a `+250 bonus PackPTS` banner. The 250 welcome credit on `POST /api/auth/register` is unchanged and is not advertised on this form. `/invite` referral rewards stay on that page.
- **Metrics:** `registeredUsersNonStaff` stays `FROM users` with `is_admin` / `is_bot` filters. Do not add `anon_players`. Dashboard sibling `anonConversion` is played-guest → claimed (`claimedPlayed / anonPlayed`).

### Daily 5 Challenge
- **Status:** Implemented
- **Flow:** Once per day, players get the same 5 cards. Guests may start Daily 5 inside the registration-gate allowance (`anon_daily_runs`); claim copies a finished run into `daily_challenge_entries` (no second ledger credit). Beat-me stays signed-in only. Play, submit scores, see daily leaderboard. Game Complete primary CTA **Beat me.** (gold) calls `POST /api/daily5/beat-me` and opens the share sheet with `https://packpts.com/daily?utm_source=share&utm_medium=beatme&utm_campaign=daily5&challenge={token}` plus the challenge PNG (visual CTA `packpts.com/daily` only; never bare `/daily`). Secondary **Share** / **Save** are the session score card. Recipient: active banner `Beat {name}. They went {score}/5 today` (no name → `a collector`; dismiss hides the bar). Stale CT day: `Challenge expired. Play today's five.` with no live yesterday score. Invalid token: no banner. After the recipient finishes an active challenge: `You went X/5. They went Y/5.` / `Tied at N/5.` / `They led, Y/5 to your X/5.` Optional **Browse sets** → `/sets`. No Maker Rate and no `/make` publish. Always today’s cards. Contract: `docs/DAILY_BEAT_ME.md`. Same-day replay is forbidden (`Already completed`); Game Complete does **not** label a CTA Play Again. Next play is honest: **Play Solo** (`/game/solo`) and **Browse Sets** (`/sets`), plus Home / Leaderboard. Copy: “Today's Daily 5 is done. Come back tomorrow for a new five.”
- **Resume:** `GET /api/daily5/status` and `POST /api/daily5/start` return the existing entry, including 1-indexed `answers[]` (schema `position` 1–5). The client rebuilds play state via `resolveDaily5Resume` (`client/src/lib/daily5Resume.ts`) and lands on the **next unanswered** position — never hardcoded card 1. If all 5 are answered or `completedAt` is set, show Game Complete (auto-`POST /api/daily5/finish` when answers exist but the entry was never closed). Do not offer Submit on an already-answered position.
- **Scoring:** Same reward engine; max 250 pts per Daily 5 session (configurable via `DAILY5_MAX_POINTS`); minimum answer time of 15s enforced to prevent botting. Beat-me score is the real completed-entry correct-count only — no invented scores or streaks.
- **Day key:** **America/Chicago (CT)** — shared with streak and Beat-me `puzzle_day` via `shared/packptsDay.ts`. Daily 5 challenge window is CT midnight → next CT midnight (`getDailyStartEnd` / `packptsMidnightUtc`). Stale check is `token.puzzle_day === getPackptsDayKey()`. Do not use America/New_York or UTC dates for this identity.
- **Window reconcile:** Existing `daily_challenges` rows created with UTC-midnight `startsAt`/`endsAt` are rewritten on load (any get-by-date) and by `updateChallengeStatuses`. If stored windows differ by >1s from CT midnights, or `status` disagrees with now, the row is UPDATEd to CT `startsAt`/`endsAt` and `ACTIVE` / `SCHEDULED` / `CLOSED`. The activate-SCHEDULED path cannot leave a CT-correct window stuck as SCHEDULED after start time.
- **Fairness:** Same cards for everyone; new-account detection (accounts < 7 days old may have restrictions). Daily 5 **never** calls solo `POST /api/game/session/:id/replace-card`.
- **Image errors (fixed 2026-09-16):** Daily 5 mounts `GameCard` with `allowClientImageReject={false}`, `key={cardId}`, and `setKey={challenge.setId}`. If the JPEG still fails (404 / `onError`), overlay copy is honest (“Card image didn’t load. You can still answer.”) — never “Finding a replacement card…”. Submit stays usable. Solo/1v1 still run the canvas detector, which now requires low unique colors **and** a near-flat histogram (dominant >50% alone is not a silhouette; that false-positive hung CT 2026-09-15 card 1). Share PNG footer is `packpts.com/daily` only when `mode === "daily5"`. Solo skip is not a silent 9-pip story: scored `6/9` stays, dealt 10 + `1 skipped` paint on the 1080 card. Full chain: `docs/audits/DAILY5_STUCK_REPLACEMENT_2026-09-16.md`.

### 1v1 Friend Match
- **Status:** Implemented
- **Flow:** Host creates lobby → gets 6-char join code → shares with friend → friend joins → host starts match → both play same cards in real-time via WebSocket → results
- **Scoring:** Both players see the same questions. Points are awarded per correct answer. Winner determined by score (or correct count as tiebreaker).
- **Real-time:** WebSocket messages: `start_match`, `submit_answer`, `ready_next`, `match_resync`, `rematch_vote`
- **Battle Sessions:** Multiple consecutive matches tracked as a series (wins/losses/ties across rematches). Match complete **Play Again** is rematch (battle session or `rematch_vote`). If the opponent declines, the fallback is **Play Solo** (`/game/solo`) — not a fake rematch.
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
| isActive | boolean | Whether set is available for play (PUT can deactivate; admin DELETE hard-removes the row) |
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
- **Card blocklist** (`CARD_BLOCKLIST` in `server/lib/cardBlocklist.ts`) drops a card when `game_set_id` matches and the player field contains the listed name (case-insensitive). Current rows: 2024 Basketball (`229f0379` prefix) Antetokounmpo, 1987 Topps Football (`91cfdf3f-a620-4e73-adc8-22b8df221716`) Record Breakers Todd Christensen, Dave Jennings, Charlie Joiner, Steve Largent, Dan Marino, Donnie Shell, Phil Simms, plus Mark Duper, 1989 Fleer (`aea515e2` prefix) Kevin Johnson. Name matches also drop those players' base cards in that set. The same 1987 set drops a card whose `number` normalizes (strip `#`, whitespace, leading zeros) to 2–8, and a card whose `variant` or `description` matches `/record\s*breaker|\bRB\b/i`. Checklist sources: Cardboard Connection and Dean's Cards (cards 2–8, same seven names); PSA CardFacts states Record Breakers are cards 2–8. Mark Duper is base #236 and 1000 Yard Club #9 on Cardboard Connection, not a Record Breaker number, and stays name-blocked because the live cover showed his full name. Boot logs `[blocklist] set=91cfdf3f recordBreakerNumbers=2,3,4,5,6,7,8 players=Todd Christensen,Dave Jennings,Charlie Joiner,Steve Largent,Dan Marino,Donnie Shell,Phil Simms,Mark Duper`. Multi-player cards are excluded on every set by the same predicate: text on `player`, `variant`, or `description` for All-Stars (plural), Team Leaders, Leaders, League Leaders, Checklist, Combo, Tandem, Duo, Trio, Super Bowl, Record Breaker, Highlights, and `vs.`; All-Star (singular), Future Stars, Rookie Stars, and Prospects only when the player field names more than one person; and a player field with `/`, ` & `, ` and `, ` - ` between names, or a comma between multi-word names. `Last, First` and suffixes (`Jr.`, `Sr.`, `III`) and hyphenated surnames stay eligible. Vintage multi-player numbers (team cards, league leaders, checklists, All-Star combos) are blocked by normalized `number` for `aea515e2`, `37fd025d`, `352b33d1`, `a09b2fe7`, and `91cfdf3f`. Boot logs `[blocklist] set=<8> multiPlayerNumbers=<list> textRules=on` for each of those sets. The predicate sits in `eligibleDealFilter` and in the Daily 5, 1v1, and replace queries that do not use that filter. Covers skip a blocked card and keep filling distinct players. A stored Daily 5 row for today that still points at a blocked card is rewritten to the next eligible card in that set before the hand or the masked image is served.
- **Mask band guard** (`server/masking/maskBandLimit.ts`, env `MASK_BAND_GUARD`): `report` (default) or `enforce`. Production sets `MASK_BAND_GUARD=enforce`. Placement is the edge the baker painted on that card, not the set profile. A full-width band (width at least 90%) that starts within 3 percentage points of the top is a top plate and fails above 35% of card height. One that ends within 3 points of the bottom is a bottom plaque and fails above 55%. The 3-point window sits above the baker's 2.5% pad floor in `fitNamePlateBand` and inside its 4% edge snap, so a real bake that sits on the card edge passes, and a band that starts 19% down and runs 77% (ends at 96%) fails as `mask_band_misplaced`. A bottom band at 46% passes. A top band at 36% or a bottom band at 56% would be `mask_band_oversized`. Each full-width band is checked on its own. Report mode reads `{cardId}_v4.5.json` on boot (`startMaskBandGuardScan`, batches of 20, concurrency 4) and logs `[mask-band-guard] set=<8-char id> title=<set name> eligibleNow=<n> wouldDrop=<n> oversized=<n> misplaced=<n> eligibleAfter=<n>` plus `set=all title=all` for the total. It writes nothing and excludes nothing. Enforce mode writes the fail marker, drops `.ok`, sets `blocked_reason`, and `eligibleDealFilter` drops both reasons. Covers fall through. A stored Daily 5 card for today is swapped before it is served. The player-name blocklist is not behind this flag. `CURRENT_MASK_VERSION` stays `v4.5`. No image is re-encoded.
- **Non-player cards** are excluded at deal time and from answer choices by `isNonPlayerCard(name, title?)` in `shared/nonPlayerCard.ts`. That covers checklist labels (`Checklist`, `Checklist 1-132`, `CL`, `Team Checklist`, `Checklist Card`, any case), team cards, league-leader cards, and record-breaker or multi-player cards whose name is not one player. A Record Breaker card whose name is a single player stays in. Used by solo (`getRandomCardsFromSet` / legacy `baseballCards`), Daily 5, 1v1, and replace-card, plus the distractor name pool. Mask profiles are not part of this filter. `scripts/count-non-player-cards.ts` prints how many `playable_cards` rows match. It does not write.

### Planned Fields (not yet in schema)
- Explicit difficulty score per card
- Machine-learning-derived masking difficulty rating
- Card condition/grade metadata

---

## 7. Name Masking and Anti-Spoiler Rules

### ⚠️ MISSION CRITICAL — READ THIS SECTION BEFORE TOUCHING CARD DISPLAY CODE ⚠️

The entire game depends on the player not knowing who is on the card before submitting their answer. Any leak — visual, textual, or metadata — destroys the gameplay experience.

### How Masking Works Today
- **Intelligent name localization (v4.3 fill, 2026-09-21; geometry from v4.2):** Masking finds where the **player name** lives on that card, then covers that region. It is not a universal bottom wipe. Chain: PSA/slab layout (center-column red header + white cert plate, or dark-holder frame fallback, or OCR `PSA`/`GEM`/`MINT`/`BGS`/`SGC` in the top third) → OCR name/jersey tokens (Tesseract, last-name + fuzzy match) → known layout profile (`server/masking/maskProfiles.ts`, e.g. 1986–1990 Fleer Basketball top name plate) → known layout profile. An unmatched profile with no OCR name hit bakes the default bottom 46% plaque (`BOTTOM_PLAQUE`), the same pixels as a v4.4 bake. TODO: UNKNOWN exclusion is deferred until every active set has a registered profile. Unmatched deals log `[MaskProfile] default profile used set=<gameSetId> count=<n>` at most once per set per process per 10 minutes. v4.0 fixed Dave’s 1989 Fleer Spud Webb leak (top name plate). v4.1 added a full-width row-mean slab detector; Design QA recheck on Clemens `c6e890d5-015d-4e33-868a-77a69ca320ef` showed `?v=v4.1` **byte-identical** to `?v=v4.0` (handler ignores `?v=`, so both URLs are the same file) with **ROGER CLEMENS** still on the top PSA label. v4.2 uses center-column + holder-frame detection, expands cert OCR tokens, bakes `?v=v4.2` (new object; CDN cannot keep v4.1 bytes), and unions a full-width top ~22% cert band with the set plaque. Raw Fleer top-name is unchanged. Helper: `server/masking/slabLayout.ts`. Fixture: `server/tests/fixtures/clemens-psa-slab.jpg`. v4.3 keeps that geometry and changes the bake fill. v4.2 composited `{ r:10, g:14, b:22, alpha:0.94 }` then blurred the overlay rectangle (not the card). Design re-QA after the v4.2 cache rebuild still read **ROGER CLEMENS** / **MINT 9** on `c6e890d5-015d-4e33-868a-77a69ca320ef` and 1989 Fleer top-plate names (A.C. Green, Dantley, English) through that window. The bake is an opaque RGB rect (no alpha, no overlay blur) since v4.3. **v4.4** (`?v=v4.4`) keeps that fill and stops keying geometry on year+brand alone. `getMaskProfile` checks `gameSetId` first, then `sport|year|brand`. 1987 Topps Football (`91cfdf3f-a620-4e73-adc8-22b8df221716`, profile `1987-topps-football`) is `TOP_PLATE` (opaque top 24%). 1987 Topps baseball stays the bottom 46% plaque. 1994 Topps Football (`a09b2fe7-728e-431b-9df8-bbf2652aa3b2`) was audited as Finest with the name on the bottom bar: `BOTTOM_PLAQUE` 28%, not a top plate. `assertOpaqueIdentityCover` runs before the JPEG is stored; a failed assert returns 422 `mask_name_uncovered` and quarantines the card instead of serving a readable name. Rebuild: `docs/MASK_CACHE_REBUILD.md`.
- **Client plaque:** `GameCard` draws one opaque `MaskPlaque` from the per-card `maskPlan`. If the plan is null, it falls back to set regions from `/api/card-sets/:setKey/mask` (`overlayMaskRegions`). UUID `setKey` values still resolve through `game_sets`. The plaque is chrome only (solid `#0A0E16`, no blur, no gradient, no second overlay). The baked JPEG hides the name. Daily 5 `allowClientImageReject={false}` is unchanged. A failed masked image uses the dark honest state and does not show card number or team before reveal. A `/api/play/m/` load that gets 502, 503, or a network error is probed and retried once after about 2s, still inside the solo replace flow (one replace, 7s cap) and without starting that replace spinner during the wait. Unmasked `/api/images/card` and `/api/play/r/` are not prefetched or retried before a successful submit.
- **Server JPEG:** `maskingService.ts` + `maskCardImage.ts` bake solid RGB name-region overlays (`#0a0e16`, no alpha). Gameplay serves `/api/play/m/...?v=v4.5`. Cache: `card_image_mask_cache.maskVersion` + filename `{cardId}_v4.5.jpg` plus sidecar `{cardId}_v4.5.json` written on the next natural bake (a cold cache). Nullable `layout_class` and `regions` columns store the same plan. `CURRENT_MASK_VERSION` is `v4.5`. v4.4 JPEGs are not served. The band is fitted to the detected plate so a tight crop cannot end mid-letter. A bottom plaque uses that name-sized band instead of the fixed ~45% slab. A failed post-bake check quarantines the card. Warm hits peek the file and skip DB/OCR (`X-Mask-Cache: hit`). HTTP `ETag` / `X-Mask-Version` follow the bake id; `Cache-Control` is `public, max-age=86400, stale-while-revalidate=604800`. The route ignores `?v=` for file lookup. Gameplay URLs must bump `CURRENT_MASK_VERSION` so CDNs fetch a new object. A bake that fails `assertOpaqueIdentityCover` is not written; the route returns 422 `mask_name_uncovered` and the card is quarantined. Rebuild: `POST /api/admin/masks/rebuild` `{ "setId": "…" }`. See `docs/MASK_CACHE_REBUILD.md`. Per-card slab labels are covered by the baked JPEG. A cold bake downloads the source scan with a 9s abort (`AbortController`, body included) and a 20s job deadline. That deadline always frees the bake slot (two slots, release-once guard) even if download, OCR, or sharp never settles, and drops the in-flight dedupe entry so the next request retries. A fetch, OCR, or bake timeout logs `[MaskBake] timeout stage=<fetch|ocr|bake> card=<id> ms=<n>` on the server only and does not quarantine or mark the card unplayable. Quarantine stays limited to a real `assertOpaqueIdentityCover` failure. The masked-image HTTP handler then returns 503 with `Retry-After` and `Cache-Control: private, no-store`, and does not echo the card id or the source URL. The client image-error path handles that response.
- **Upright bake (2026-09-25, files are v4.5):** The mask is painted in the card's upright orientation, then that JPEG is what gameplay serves. `imageRotation` 90/180/270 is applied with sharp first. A landscape file (aspect > 1.3) for a portrait set with no rotation is probed by OCR at 0°, 90°, and 270°. The last-name hit with the higher confidence wins, and 0° wins only when that confidence is strictly better, in which case the file stays as-is and only that name band is painted. A profile sets the explicit landscape flag with `cardOrientation: "landscape"` (no schema column). That flag keeps the file landscape and paints the profile band only. No production set sets it yet. If OCR cannot locate the last name (a miss on every candidate, a probe timeout before any hit, or OCR skipped), the file is not turned. The bake paints the profile name band and the same band mapped through 90° and 270° (bottom 54/46 also paints the left and right 46% full-height strips; a top plate also paints its side strips) so neither a horizontal name nor a sideways name has a gap through it. Over-covering is acceptable. That bake logs `[MaskBake] orientation ambiguous cover=both card=<id>`, stores `coverBoth` on `{cardId}_v4.5.orient.json` with rotation 0, keeps the profile `layoutClass`, and does not quarantine. A note that already records a quarter-turn plus `coverBoth` still uses that turn, so a file baked before this change is not rewritten. `assertOpaqueIdentityCover` samples the photo in the gap between full-width bands when the usual photo probe sits inside a mask. `CURRENT_MASK_VERSION` is `v4.5`, so v4.4 Daily 5 JPEGs are not served. `maskPlan` regions are percentages of that upright image. `/api/play/r/` applies the same turn (from the bake's orient note) so the held-frame crossfade lines up. GameCard does not CSS-rotate the masked frame. Warm upright files are `{cardId}_v4.5.jpg`. A rotated bake is `{cardId}_v4.5_r90.jpg` (or `_r180` / `_r270`) plus `{cardId}_v4.5.orient.json`. v4.4 files are not served. The three orientation passes share one 12s budget (`ORIENTATION_OCR_BUDGET_MS`), in order 0°, then 90°, then 270°. A pass is not started with under 250ms left. It stops early when the last name sits in the anchor band at confidence 70 or higher. The bake path shrinks that budget by time already spent plus a 1.5s reserve so a 9s fetch plus orientation stays inside the 20s slot. Exhausting the budget uses the same unturned cover-both fallback and does not quarantine. Each `recognize` still has its own 8s deadline: the tesseract worker is terminated (worker thread `terminate`, or SIGKILL when a child pid is exposed) and `recognize` is not left running. Timeout or error continues the bake with the set profile (both orientations, unturned, when that timeout is the orientation probe), or the default bottom 46% plaque for an unmatched portrait file. It logs `[MaskBake] ocr-timeout fallback=profile card=<id> ms=<n>` and skips OCR for that card for one hour. An OCR timeout, error, or miss does not call `quarantineUncoveredName` and does not set `isPlayable` false. Quarantine stays a real `assertOpaqueIdentityCover` failure. The 20s slot deadline and the 9s source-fetch abort are unchanged.
- **Play session writes and mask warmup (2026-09-26):** `replaceGameSessionQuestion` updates one JSONB element. Advance is a compare-and-swap on `current_question_index`. Answer and complete write score fields and, for an answer, that question element only. Daily 5 submit and 1v1 question writes take `SELECT ... FOR UPDATE`. A `{cardId}_v4.5.fail` marker short-circuits `/api/play/m/` to 422 before any bake. The client treats 422 as a refusal and requests a replacement. The replacement pool uses `eligibleDealFilter` (player blocklist included), drops a band-guard failure and fail markers, serves baked cards first, and cold-bakes at most three candidates. After routes are ready, `startMaskWarmup` queues one `mask_warmup` job per active set that still needs covers, or every active set when `CURRENT_MASK_VERSION` changed. Workers bake at concurrency 2 with `priority: "warm"`, which waits while a live bake is in flight. A live request for that same card promotes the waiting warm bake so the live gate cannot park it forever. `runNextPendingJob` releases the claim connection before the handler, so one set's warmup does not hold a pool client across card batches. Eight distinct-player covers are first. Progress logs `[MaskWarmup] set=...`. Prefetch retains the Image objects for the current card and the next two masked URLs, and adds `<link rel="preload">` for N+1 and N+2. It still never requests `/api/images/card` or `/api/play/r/` before a successful submit. If the image cache says bad, the reveal fetches the playable card scan, and a real JPEG is served and remembered as ok.
- **Between-card lag (2026-09-19):** Guessing used to fetch the next masked JPEG only when that card mounted. Daily 5 and 1v1 had no prefetch; solo prefetched only N+1 via `card.imageUrl`. `preMaskCards()` was unused, so the first GET of each card could cold-bake (download + OCR). Now: client `prefetchMaskedPlayCards` loads remaining **masked** `/api/play/m/...` URLs as soon as the deal is known (1v1 gets `upcomingMaskedUrls` — opaque paths, no card ids or names). The reveal URL `/api/play/r/...` is prefetched only after a successful submit ACK. Server `kickPreMask` fires on solo start/replace, Daily 5 create/start, and 1v1 start/replace — background, not on the start-response path. It logs completion even when some bakes time out: `[PreMask] <reason> warmed <hits>/<n> timedOut=<n> in <ms>ms`. Solo Next paints the next known card from session state immediately, then reconciles `/api/game/next` (submit stays blocked until ACK). GameCard skips the spinner when that URL is already decoded. Volume-cold after mask rebuild or a new Daily 5 day: first request still bakes; document in `docs/MASK_CACHE_REBUILD.md`.
- **Image validation:** Canvas-based analysis checks color diversity and dominant color percentage to detect blank/silhouette placeholder images that shouldn't be served.
- **Card replacement:** If an image fails to load or is detected as a placeholder, solo requests one replacement (`POST /api/game/session/:id/replace-card`, 7s cap). Success writes that question index (the opaque `/api/play/m/...` token resolves to the new card) and clears the spinner. Failure, an empty body, or the cap shows retry/skip and does not leave "Finding a replacement card...". Answer choices and Submit are disabled while the replace is in flight and while that honest error is up. A reveal URL (`/api/play/r/`) clears `imageError` and paints the reveal image; the validity check does not run again on that reveal. The GameCard mount key is `gameCardMountKey(session, index, masked URL)` (1v1 also adds seed version and retry count), so a same-index replacement remounts. Reveal does not change that key. GameCard clears `imageError` / `imageLoaded` when `imageUrl` changes. A trading-card-shaped scan passes, including a sideways file near aspect 1.40 (the old `> 1.3` rule rejected 1987 Topps portraits stored that way). Wider non-card images still fail. The client aspect check uses the loaded image's width and height and does not apply `imageRotation`, because the bake and the reveal are already upright. An upright slab with a stored rotation of 90 or 270 is judged on that served aspect and is not rejected for the source-file rotation. The client logs width, height, and aspect. The baked plaque color is left out of the silhouette histogram. Daily 5 does not call replace-card. Bad-image reports use `POST /api/play/report` with scope, session, and question index (optional mask token). The server resolves the card and the response does not include the card id.
- **Post-submit full-card reveal (2026-09-16, held frame 2026-09-25):** Dave's rule: mask stays until a **successful** answer submit (correct or wrong), then the **full** card is shown; the next card starts masked. Guessing keeps the opaque bake (`/api/play/m/:scope/:sessionId/:index/:hmac?v=v4.5`) plus `MaskPlaque`. After ACK, parents pass the short-lived `/api/play/r/...` URL as `revealUrl` only. The bake image stays in the slot until that reveal image `onLoad`, then a 240ms opacity crossfade (instant when reduced motion is on). A reveal `onError` leaves the bake up, shows "Full card image didn't load.", and does not call `onImageError` or replace/skip. `GET /api/images/card/:id` is not a public reveal URL. Solo sets `isRevealed` in submit `onSuccess` only (not on Submit click). Daily 5 `onSuccess`. 1v1 `answerResult !== null`. Do not prefetch the reveal before ACK. Audit: `docs/audits/MASK_REVEAL_AFTER_SUBMIT_2026-09-16.md`. **2026-09-24:** The reveal stays in that same in-flow slot (`data-testid="solo-card-slot"`). There is no reveal dialog and no click-to-enlarge. Revealed answer buttons stay `disabled` but use `disabled:opacity-100` so the correct/incorrect row is not painted at half opacity. Do not wrap the card in a modal on submit.
- **Solo / 1v1 per-card "pts" badge removed (2026-09-24):** Solo rendered `Worth {question.pointValue} pts`. Playable-set deals set `pointValue` from `computeReward({ playerName, sport: "baseball" })` with no year and no rarity (`generateQuestionFromPlayableCard` stores `year: 0`). A missing fame row is 0.5, and the default policy maps that to exactly 175, so every such card showed the same number. Authenticated credit is `awardDailyBaseForCorrectCard` (`deltaPts` after Set of the Week and the daily cap), not that badge. A flat default is not a per-card price, so the badge is gone. After ACK, solo used to show `+N pts`, a `Player:` fame tier, and `Base: N pts` under the answers from server `pointsEarned` (no bounce, no blur, no overlay on the card). Dave (2026-09-25, solo 1987 Topps Eddie Murray) removed that block in every mode. Play does not render `+N pts`, `Base:`, or `Player:` between the answers and the next control, and solo / Daily 5 headers do not show a running session point total. The session total stays on Game Complete. 1v1 in-play `text-my-score` / `text-opponent-score` are correct-answer counts (`You N` / `Opp N` from `participant.correctAnswers`), not points. Match-end point totals stay. `battle-series-tally` stays series wins. Scoring math, server awarding, and the ledger are unchanged. A missing `pointsEarned` does not invent a number. Score-threshold toasts (500/1000/2000/5000), streak toasts (3/5/10), and the daily-cap toasts that used to fire on a correct answer stay gone. Do not put an earnings toast back in place of the row. Daily 5 and 1v1 never had those toasts. Error toasts (submit, session, network) remain, and on play routes the viewport is the bottom band above the tab bar (`playToastViewport.ts`), not over the card. Daily 5 never rendered a per-card worth label (it credits a flat `pointValue: 100`). 1v1 credits `question.pointValue`, but playable cards are stamped `popularity: 50`, so the `{pointValue} pts` badge was a constant 300; that badge is removed too. Do not put a client-invented number back.

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

- Vintage Topps **baseball** cards (1987 Topps baseball, etc.) have a team-color band occupying roughly **yPct:54–92**. The player's name sits in this band at ~yPct:65–80. 1987 Topps **football** is a different set: the name is in the top plate (`1987-topps-football`), not this default.
- The old `yPct:82` mask only covered the very bottom edge — the name was fully visible in the orange/colored band above it.
- The new `yPct:54` mask covers the entire team-color band and the name.

**Never reduce `yPct` below 54 or `hPct` below 46 in `DEFAULT_MASK_REGIONS` without verifying the player name is still covered on all active bottom-plaque sets.** Top-name sets (1989 Fleer Basketball, etc.) must use a **set profile**, not a smaller default.

The test `"DEFAULT_MASK_REGIONS is a single bottom band at yPct:54, hPct:46"` in `server/tests/masking.test.ts` enforces this. It will fail CI if the values regress. Top-name geometry is covered in `server/tests/nameMasking.test.ts`.

### "WHO IS THIS PLAYER?" Band Is Unconditional — DO NOT Drop It When Regions Change

The play card draws one opaque `MaskPlaque` from the per-card bake plan (`maskPlan` on solo, Daily 5, and 1v1 payloads). Test ids stay `mask-name-band` (primary) and `mask-region-{i}`. The plaque is chrome. The baked JPEG is what hides the name.

**Plaque plan (2026-09-26):** `CURRENT_MASK_VERSION` is `v4.5`. Warm `{cardId}_v4.4.jpg` files are stale and are not served. A v4.5 bake fits the name band to the detected plate on that image. A card that had to be rotated upright is a different file (`{cardId}_v4.5_r90.jpg` and the other quarter-turns), and its plan regions are in that upright image. Each successful bake also writes `layoutClass` + `regions` onto `card_image_mask_cache` (nullable columns) and a sidecar `data/masked-cards/{cardId}_v4.5.json`. Play payloads attach `maskPlan` from that sidecar or `null` when the bake is cold; the client then uses set regions. The wire plan never includes player name, card number, or team. Year+brand profiles (`1987 topps` and the other baseball named keys) apply when sport is baseball or absent. `MLB` maps to baseball (case-insensitive). A sportless legacy `baseballCards` row is baseball. `1987 Topps Football` stays `TOP_PLATE` by `gameSetId`. An unmatched profile with no OCR name hit bakes the default bottom 46% plaque. It is not `UNKNOWN` and it is not dropped from solo, Daily 5, 1v1, replace-card, or the legacy fallback. TODO: UNKNOWN exclusion is deferred until every active set has a registered profile. Unmatched deals and bakes log `[MaskProfile] default profile used set=<gameSetId> count=<n>`. Daily 5 still has no replacement copy. Reveal stays the #116 token URL, mounted only after ACK, and a reveal `onError` does not call `onImageError`. Selecting an answer before submit turns the MaskPlaque seam brand gold (`--plaque-seam-armed`, `#F5C518`); clearing the selection or submitting returns the idle seam (`--plaque-seam`). After submit the plaque still hides once the reveal image loads, and correct/wrong stay on the answer buttons. Game Complete share PNGs composite a row of that session's masked `/api/play/m/` thumbnails on the client (plaque look, session order, omit a tile that fails or taints the canvas). Unmasked `/api/images/card` and reveal `/api/play/r/` URLs are not used. Mode label, date, scored denominator, and footer stay the server card.

**v4.4 geometry:** The band is **not** hardcoded to `bottom: 0, height: 46%`. Lookup is `gameSetId` then `sport|year|brand`. If the bake plan is missing, the client falls back to set regions via `overlayMaskRegions()` (`DEFAULT_MASK_REGIONS` when empty). Never re-hardcode a bottom-only band. Never paint a translucent or blurred plaque while guessing.

### Chrome backdropFilter + maskImage Compositing Bug — DO NOT USE

**Never combine `backdropFilter` and `mask-image` (or `WebkitMaskImage`) on the same DOM element in the card overlay.** Chrome's compositor fails to render `backgroundColor` when both are present, causing the underlying card art (which may be vivid orange/red for certain team-color cards) to bleed through even an opaque `rgba` background. The fix is a simple solid `backgroundColor: "#0a0e16"` with no `backdropFilter` at all. This was debugged across multiple deploys in June 2026.

Files affected: `client/src/components/GameCard.tsx` and `client/src/components/MaskedCardImage.tsx`.

### Automated Masking Tests (`server/tests/masking.test.ts` + `nameMasking.test.ts`)

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
Configurable in `packptsExpirationPolicy`. The table used to stay empty (nothing inserted a row, and admin PUT only updated an existing row), so `createBucket` left `expires_at` null and the daily job found nothing to expire.

On boot, after the database is ready, `ensureExpirationPolicy()` in `server/services/bucketService.ts` takes a transaction advisory lock (`pg_advisory_xact_lock`) and, only when no enabled policy is already effective, inserts one from `DEFAULT_EXPIRATION_POLICY`:
- Earned points: 365 days
- Bonus points: 90 days
- Purchased points: null (never expire). Paid value is not given an expiry.
- Adjustments: never expire (hardcoded in `calculateExpirationDate`, not a policy column)
- Grace period: 7 days
- Inactivity clawback: disabled by default (configurable)

If a policy row is already effective, boot does not change it and logs `[Expiration] policy=<id> earned=<d> bonus=<d> purchased=<d|never>`. If ensure cannot leave an active policy, boot logs `[Expiration] WARNING: no active policy, buckets will not expire`. `createBucket` logs that same warning when it has no policy. Existing buckets with null `expires_at` are not backfilled. `EXPIRATION_MODE` stays `dry_run`.

Admin `PUT /api/admin/expiration/policy` is an upsert: it updates the current effective policy, or inserts one (same defaults, purchased null) when none exists. It stays admin-only.

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
| FIFO bucket expiration | ✅ Implemented + scheduled. `server/services/expirationEngine.ts` (`runExpirationJob()` and `runInactivityExpiration()`); admin endpoint `POST /api/admin/expiration/run`; standalone script `server/jobs/runExpiration.ts`. Daily date-based run wired into pgJobQueue via `scheduleRecurringJob('packpts_expiration', …)` in `server/index.ts`, runs at `EXPIRATION_RUN_HOUR_UTC` (default 6 UTC = 1 AM EST). Set `EXPIRATION_ENABLED=false` to disable. The scheduled job defaults to `EXPIRATION_MODE=dry_run` (logs counts, writes nothing). `live` expires only when `expires_at + gracePeriodDays <= now` and processes at most `EXPIRATION_MAX_BUCKETS_PER_RUN` (default 500) per run. Dry-run and live summary lines include `policy=<id|none> nullExpiryOpen=<count> nextExpiresAt=<iso|none>`. Admin `POST /api/admin/expiration/run` is unchanged and does not apply that cap. Boot `ensureExpirationPolicy()` inserts the default policy when none is effective (purchased points never expire) and does not backfill existing null-expiry buckets. Admin `PUT /api/admin/expiration/policy` upserts. Inactivity expiration is not yet on a recurring schedule. |
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
The PackPTS Marketplace lets users browse live eBay (and curated Goldin) listings and spend PackPTS toward a **PackPTS-funded cashback** after they buy at full partner price. Outbound clicks are EPN-attributed. **This is not an eBay checkout discount.** eBay/Goldin still charge the full listing price. Audits: `docs/audits/APPLY_PACKPTS_EBAY_2026-09-20.md`, `docs/audits/REDEEM_REAL_VALUE_PLAN_2026-09-20.md`.

### How It Works
1. User plays games → earns PackPTS → visits `/marketplace`.
2. Marketplace shows listings from eBay and Goldin, contextually matched to the user's recent gameplay (card sets, players, teams, years).
3. User selects a listing → system calculates maximum redeemable PackPTS based on profit policy.
4. `externalPurchaseIntent` is created with: listing price, computed max redemption (`computedRmax`), requested PackPTS spend, optional listing title.
5. On apply, PackPTS are deducted from the wallet and a `redemptionCredit` row is created (`PENDING`) plus a treasury reservation. This is **not** an eBay coupon, gift card, or price rewrite. UI tells the user to buy at full price, then claim cashback.
6. User clicks **Buy on eBay/Goldin** (`/out/ebay/:listingId` or `/out/goldin/:listingId`) and pays **full price**.
7. **Grant (real USD liability):**
   - eBay: `GET /api/webhooks/epn-postback` matches `customid` → outbound click → APPROVED/held intent and **auto-grants** (partner-verified; no $25 hold).
   - Goldin / EPN gaps: user **I’ve purchased — claim rebate** on `/redemptions/:id` with order id / note / receipt URL. Under $25 auto-grants; ≥$25 holds at `PURCHASE_CONFIRMED` for admin (`POST /api/admin/redemption/intents/:id/grant` or deny).
8. Grant consumes the treasury reservation, increments `wallets.rebate_balance_cents`, writes `rebate_ledger` (`GRANT`, idempotent key `rebate-grant:{intentId}`), sets `CREDIT_GRANTED` / `GRANTED`, emails a receipt (`sendRebateReceiptEmail`), and shows `/redemptions/:id`.
9. User can request withdrawal (`POST /api/rebate/payout-request`). Admin marks paid after sending USD, or denies (refunds the rebate balance). Stripe Connect is **not** wired.
10. Unused APPROVED applies still auto-refund PackPTS after 72 hours (`staleRedemptionCleanup`). PURCHASE_CONFIRMED / GRANTED are not cleaned. Listing IDs prefixed `qa-receipt-` are excluded so Design QA fixtures are not auto-canceled.
11. Redeem-tab `POST /api/redeem` hex tokens remain an internal catalog — not a payout rail; UI says so.
12. **Ops/QA seed (not product UI):** `POST /api/admin/qa/seed-receipt-fixtures` (`requireAdmin`, optional `{ username }` default `designqa`) idempotently upserts live receipt rows by `listingId` prefix `qa-receipt-`: CREDIT_GRANTED ($12.50 / 2500 PackPTS / USER_CONFIRM + rebate ledger GRANT), PURCHASE_CONFIRMED (≥$25 PENDING credit + evidence order id), CREATED (PENDING chip), APPROVED (reserved / buy-then-claim), DENIED. Returns `{ userId, intents: [{ id, status, url: /redemptions/:id }] }`. Fails 404 if the username is missing. Service: `server/services/seedReceiptFixtures.ts`. `rebateService.listReceipts` (`GET /api/marketplace/redemption/receipts`) uses `RECEIPT_LIST_STATUSES` including `CREATED` so the PENDING-chip fixture appears on `/redemptions` (not only `/redemptions/:id`). Admin `listAdminIntents` default queue stays APPROVED / PURCHASE_CONFIRMED / CREDIT_GRANTED.

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
Two parallel systems (do not conflate):

**A. Listing apply + cashback** (`POST /api/marketplace/redemption/quote` + `apply` + confirm or EPN): wallet debit + PENDING credit, then USD rebate grant. eBay/Goldin price unchanged. Receipt: `GET /api/marketplace/redemption/receipts/:intentId` (flattened `grantMethod` + `plaque` per `shared/receiptContract.ts`). Share PNG: `GET /api/marketplace/redemption/receipts/:intentId/png` (1080, DejaVu outlined). Tests: `server/tests/rebateGrant.test.ts`, `client/src/lib/__tests__/receiptContract.test.ts`, `server/tests/receiptPng.test.ts`.

**B. Tier redeem** (`POST /api/redemption/calculate` + `POST /api/redeem`): minimum 1,000 PackPTS; admin review if USD value ≥ threshold; hex `creditToken` shown in UI. `POST /api/redemption/validate-token` / `consume-token` exist but are not called by eBay or any PackPTS checkout UI. Redeem-tab cards are labeled **PackPTS Credit Token** (`server/storage.ts` `REDEMPTION_OPTIONS`) — internal hex tokens, not eBay/Goldin gift cards. Product copy must not call them gift cards or promise they change partner checkout.

### ⚠️ Affiliate Attribution Warning
Affiliate redirect URLs and marketplace links MUST preserve tracking parameters. Any change to outbound URL construction, the `/out/ebay/:listingId` route, or the EPN parameter assembly must be tested to confirm affiliate attribution is not broken. Lost attribution = lost revenue.

### Attribution Loop (Prompt 15 — complete)
Full funnel instrumented: card_view → outbound_click → affiliate postback → attributed_purchase.
- **card_views** table: logged via `POST /api/attribution/card-view`. Captures userId, cardId, cardSetId, sessionId, ipHash, userAgent, pagePath, viewDurationMs.
- **outbound_clicks** table: existing, written on `/out/ebay/:listingId` redirect with EPN customId.
- **attributed_purchases** table: written by `GET /api/webhooks/epn-postback` when eBay EPN sends conversion confirmation. Links `customId` → `outbound_clicks.id` → `users.id`. Idempotent via unique constraint on `transaction_id`. The same handler calls `processEpnPostback` → `rebateService.grantFromEpnPostback` so a matching apply is granted (not status-only).
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
- Session cookies (`server/auth/session.ts`): `httpOnly`, `secure` in non-development, **`sameSite: "lax"`** in all environments. Production is a first-party SPA on packpts.com (host-only cookies; www → apex). WorkOS/TikTok OAuth callbacks are top-level GET navigations to apex, which send Lax cookies. `sameSite: "none"` is not used — it would allow credentialed cross-site POSTs against cookie-auth `/api/*`.
- Session management: Passport.js with local strategy
- Canonical guard: `server/auth/middleware.ts:isAuthenticated` returns `{ message: "Unauthorized" }` on 401 (no internals)
- Session inspector: `GET /api/auth/user` — no per-request `[Auth Debug]` logging in production (removed)

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
- Password reset via email token (`passwordResetTokens` table, expiring). A failed send logs the masked recipient and the error, never the reset link or token. A successful send logs the Resend message id, subject, and masked recipient.
- Identity linking audit trail (`identityLinkAudit` table)
- Access audit log (`accessAuditLog` table) tracks every activation, invite, and abuse event

---

## 14. Admin, Operations, and Content Management

### Admin Dashboard
All admin routes require `isAdmin: true`. Admin UI lives at `/admin/*` with 20+ pages.

**Implemented Admin Features:**
- **Dashboard:** KPIs (registered users non-staff, games played, points awarded, card stats), top players chart. User headline is `overview.registeredUsersNonStaff` (`users.is_admin = false` AND `users.is_bot = false`). Legacy `totalUsers` aliases that honest count. Breakdown: `staffUsers`, `botUsers`, `allUserRows`. 7d signups are the same exclusion. **Do not cite all-rows `COUNT(*)` as registered users. Do not invent a public figure — read the live admin metric. Do not add `anon_players` or bots into that headline.** SQL: `server/services/userCounts.ts` (`REGISTERED_USERS_NON_STAFF_SQL`). Sibling `anonConversion` (not a user count): anon identities, guests who finished a round, and how many of those claimed an account. **Do not cite** public `GET /api/access/cap` `currentActive` (founders-cap counter; live 2026-09-20 read `3`, includes staff) or `/api/leaderboard` length (wallet balance > 0, includes staff/test).
- **User Management:** Search/filter users by status, view detailed analytics per user, adjust wallet, freeze/unfreeze accounts, approve waitlisted users
- **Card Management:** Import card sets from CardHedge, configure mask regions, review reported cards, view card telemetry (wrong-answer rates), manage quarantine status, rotate images
- **Card Sets:** Create/edit game sets, configure CardHedge import queries, manage active/inactive sets. `/admin/playable-sets` Actions include **Delete** (Trash2): confirmation names the set and shows honest stored-card count (`COUNT(*)` playable_cards), then `DELETE /api/admin/game-sets/:id` with credentials; success invalidates `["/api/admin/game-sets"]`. That endpoint **hard-deletes** the `game_sets` row (auth: `isAuthenticated` + `requireAdmin`; `{ success: true }` or 404). There is no Active-status guard. Soft-deactivate (`isActive=false`) used to leave inactive junk on `GET /api/admin/game-sets` / `/admin/playable-sets`. `hardDeleteGameSet` locks the `game_sets` row `FOR UPDATE` first, then deletes dependents in application order: `daily_challenge_cards` and `card_image_reports` for the set's cards, then `playable_cards`, `cardhedge_import_runs`, `user_active_sets`, `match_context_log`, `set_of_week`; nullable FKs on `collaboration_sessions.published_set_id` and `daily_challenges.set_id` are set null. No `ON DELETE CASCADE` schema change. The lock is required because CardHedge import commits each `playable_cards` insert on its own (that insert takes `FOR KEY SHARE` on `game_sets`). Without the lock, delete removes the cards it sees and then hits `23503` `playable_cards_game_set_id_game_sets_id_fk` when the next page commits. That is the 2026-09-22 failure on Active **Panini 2018 Panini Prizm Basketball** (`80996291-d3d2-4541-aa0e-4460b8c6e18b`): production logs show the set created with `cardsImportedCount: 0` and `lastImportAt: null`, then CardHedge pages still inserting when `DELETE` ran. `GET /api/admin/game-sets` `cardsImportedCount` is `COUNT(*)` of `playable_cards` for that set (the rows behind `playable_cards_game_set_id_game_sets_id_fk`), not the gameplay filter. The list also returns `latestImportStatus`. Content → Cards shows "Import in progress" or "Cards stored, import not finished" instead of "Never" when a run is open or rows exist with `lastImportAt` still null. Opening the delete confirm refetches that count (`staleTime: 0`). `lastImportAt` is still written only when the import request finishes, and the default `apiRequest` timeout (15s) used to abort the browser wait while the server loop continued. Import and purge-reimport now use a 10-minute client timeout. If a dependent row still blocks the delete, the handler returns **409** (or 500 for a non-FK error) with `error` set to the Postgres constraint/table or the server message — not a generic `Failed to delete game set`. Design toast craft (`docs/design/ADMIN_SET_DELETE_TOAST.md`, `client/src/lib/gameSetDeleteToast.ts`): success title `Set deleted` + `"[Set]" and [N] stored cards are gone.`; blocked title `Can't delete yet` + Eng 409/import/constraint one-liner (never opaque `Delete failed` / `Something went wrong` / `Failed to delete game set` as title); confirm body uses "stored cards". An in-flight import whose next insert loses the FK after the set is gone returns 409 `Import stopped because this game set was deleted.` Public play still uses `isActive`; this does not change which sets product UI deletes.
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
**Marketing SoR (2026-09-16):** Auto X posts are **Daily 5 announcement/recap only**. Copy kit: `docs/x-hotfix-2026-09-13/CAPTIONS.md` post2. Organic reference: https://x.com/PlayPackPTS/status/2100232354249728403. Signup-bonus / “250 free PackPTS” / FOMO acquisition copy is **hard-rejected** at preflight (`marketingSor.ts` + `preflight.ts`) and is not emitted by `contentGenerator.ts`. Sparse hashtags only (`#PackPTS` `#Daily5`, max 2). Re-enabling `SOCIAL_MEDIA_AGENT_ENABLED` is safe under this lock. Immediate kill is still the env flag. Manual Growth-queue “mark posted” (operator pastes to X) is unchanged.

**Purpose:** Autonomous Daily 5 ritual posts, image composition, A/B testing, publishing, analytics, and prompt evolution (Daily 5 CHALLENGE variants only)

Startup (`index.ts`):
1. Verify DB connectivity (hard fail)
2. Verify CardHedge API (soft fail — per-post degradation)
3. Verify Twitter credentials (soft fail)
4. Verify TikTok credentials (soft fail)
5. Seed campaign rewards if empty (**never SIGNUP_BONUS**); deactivate existing SIGNUP_BONUS rows and FOMO evolved variants
6. Recover stuck PUBLISHING posts to QUEUED
7. Audit and block orphaned QUEUED posts missing media **or violating Marketing SoR**
8. Start all 4 scheduler loops

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
| Prompt Evolution | 5 min check | 1 AM CT (daily) | Read A/B test winners → OpenAI → next-gen **Daily 5** copy only (FOMO variants dropped) |
| Daily Queue Builder | 5 min check | 2 AM CT (daily) | Queue **two** posts per platform: 8 AM CT announcement + 9 PM CT recap (`daily5-ritual-v1`) |
| Publisher | 60 sec | Continuous | Pick up QUEUED posts with scheduledAt <= now, **SoR preflight**, publish to Twitter/TikTok |
| Analytics Fetcher | 6 hours | Continuous | Fetch post metrics, trigger A/B test analysis |

**Content Generation (`contentGenerator.ts`):**
- Auto drafts are always `CHALLENGE` Daily 5 ritual copy (`marketingSor.buildDaily5Copy`), regardless of requested type. `NEW_USER_ACQUISITION` / `REWARD_ANNOUNCEMENT` are not auto-generated.
- Hashtags: `#PackPTS` `#Daily5` only (max 2)
- Evolved variants are used only when they pass SoR; otherwise CAPTIONS-aligned templates
- Fallback templates are Daily 5 only (never “250 free PackPTS on signup”)

**Publishers:**
- Twitter (`publisher/twitter.ts`): Full auto-publish with image upload via twitter-api-v2. Live X handle is `@PlayPackPTS` (app name stays PackPTS).
- TikTok (`publisher/tiktok.ts`): Photo post via TikTok Content Publishing API, token auto-refresh
- Discord: **Not implemented** (webhook URL env var defined in docs but no publisher code)
- Reddit: **Not implemented** (env vars defined in strategy docs but no publisher code)
- Instagram: **Not implemented** (env var defined but no publisher code)

Weekday / scheduled X publish uses the Social Media Agent publisher path only (`publisher/twitter.ts` via the agent scheduler). The temporary D5-2 token-gated `POST /api/admin/social-agent/one-shot-tweet` route and `ONE_SHOT_PUBLISH_*` env vars were removed (token-header gate was not session-admin; leftover after D5 prove).

**Safety Systems:**
- Fact Checker (`factChecker.ts`): Verifies user counts, match counts, scores, streaks, reward values against DB. Auto-corrects claims >10% off actual values.
- Preflight Validator (`preflight.ts`): Blocks (1) **Marketing SoR FOMO** — signup bonus / 250 free / acquisition FOMO / hashtag dumps; (2) visual copy without attached media. Runs at queue-insert, publisher tick, and startup audit.
- Startup Audit: Blocks orphaned QUEUED posts missing media or violating SoR.
- Crash Recovery: Resets PUBLISHING posts to QUEUED on startup.
- Rate Limit Tracking: Twitter publisher tracks remaining rate limit.
- Retry Logic: 3 attempts per post with 30-minute backoff.
- A/B Test Timeout: Marks inconclusive after 7 days.
- Publishers cap appended hashtags at 2.

**Prompt Evolution (`promptEvolution.ts`):**
- Reads concluded A/B tests from last 30 days
- Loads `prompt_program.md` (human-editable research direction file)
- Calls OpenAI to generate next-generation copy variants
- Writes to `evolved_copy_variants` table
- `contentGenerator` loads active evolved variants in preference to hardcoded copy
- Each generation learns from the prior generation's winners

**Campaigns:**
- Auto queue uses `daily5-ritual-v1` only (8 AM CT announcement, 9 PM CT recap).
- `newUserAcquisition.ts` / `retention.ts` rotations are Daily 5 `CHALLENGE` only (dead campaign IDs kept for old A/B rows).
- `campaign_rewards.SIGNUP_BONUS` is deactivated on agent start and is never re-seeded. In-product welcome bonus (`POST /api/auth/register` 250 PackPTS) is unchanged.

**Image Composition:**
- `imageComposer.ts` → `gameImageRenderer.ts`: Renders @PlayPackPTS social PNGs (pure-SVG stats cards + CardHedge overlay types). Labels are outlined Inter paths via `contentFactory/fonts.ts` (`textToPath`) plus `@font-face` base64 — Railway Alpine has no system fonts, so `<text font-family="sans-serif">` produced tofu on live shares. Daily 5 / Beat-me user cards stay in `generateScoreCard.ts`. `composePostImage` prefers a Design-baked PNG from `packpts-design/social/exports/` (or `client/public/assets/social/`) when that file exists — copy-only, no invented creatives. Prevention gate: `docs/design/SOCIAL_PNG_QA.md` (`assertShareFontsPresent` fails `npm run build` / CI if Inter or DejaVu is missing; Alpine `font-dejavu` + Ubuntu `fonts-dejavu-core`).
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
4. **Daily 5 auto announcements (2026-09-16):** Agent queue posts 8 AM CT announcement + 9 PM CT recap aligned with Marketing CAPTIONS post2. SoR preflight rejects signup-bonus FOMO.
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
│   │   ├── tiktokSandbox.routes.ts
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
- **Layout:** `AppShell` wraps all pages with Header and MobileNav (hidden on fullscreen game/match routes and `/review/*`)
- **Stale bundle:** `client/src/lib/staleBuildClient.ts` compares the inlined build id with `GET /api/version?t=<ms>` (`cache: 'no-store'`). The poll is a 60s interval plus focus, visibility (including when the tab hides), pageshow, and online. That poll retries once after about 2s on 502, 503, or a network error. A live solo session, Game Complete, Daily 5 (including between cards and the results screen), a live or just-ended 1v1, a 1v1 lobby that is still open (waiting for an opponent), and matchmaking while searching, connecting, or matched do not reload. Reload waits until the player leaves that surface (a route change, or solo Play Again) or the tab is idle with no session, including a hidden tab (`shared/buildVersion.ts`). One reload per build id per tab. A failed dynamic import reloads mid-session only when a `cache: 'no-store'` HEAD (GET if HEAD is 405/501) of that chunk URL is 404, or `/api/version` shows a different build id. A network error retries the import once, then shows the bottom-band toast "Couldn't load that screen". An in-flight answer submit holds even if the chunk 404s.

### Pages (30+)
Public: `/`, `/game/:mode`, `/lobby`, `/match/:matchId`, `/queue`, `/daily5`, `/leaderboard`, `/marketplace`, `/redemptions`, `/redemptions/:id`, `/store`, `/auth`, `/waitlist`, `/invite`, `/redeem`, `/forgot-password`, `/reset-password`, `/privacy-policy`, `/terms-of-service`, `/creators`, `/partners`, `/roadmap`, `/review/tiktok-sandbox` (TikTok App Review sandbox — not in nav)

Protected: `/profile`, `/friends`

Admin (20+): `/admin/dashboard`, `/admin/users`, `/admin/users/:userId`, `/admin/metrics` (weekly D1/D7/D30 + Maker Rate, admin-only), `/admin/audit-log`, `/admin/redemptions`, `/admin/tiers`, `/admin/streaks`, `/admin/daily5`, `/admin/products`, `/admin/subscriptions`, `/admin/access`, `/admin/geo`, `/admin/playable-sets`, `/admin/card-sets`, `/admin/cardhedge-card`, `/admin/card-search`, `/admin/card-reports`, `/admin/card-telemetry`, `/admin/package-guardrails`, `/admin/growth`

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

### Brand marks (two-role SoR — 2026-09-20)

Design lock is **two roles**, not one mark everywhere:

| Role | Mark | Ships on |
|---|---|---|
| **B — masked-P** | White P + gold `#F5C518` bar on `#0b0f16`. Master `client/public/packpts-mark.svg` (same path as score-card / maker-share / play-sets footers). Rasters: `favicon.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `icon-1024.png`. | App / PWA / favicon / apple-touch / manifest / client header |
| **A — masked-card** | Marketing scene (card / Daily 5 tease). `og-image.png` + play-sets / social kit PNGs. | OG, social, share kits only |

**Kill:** glossy 3-card shield (`packpts-logo.png`, deleted from header), three-square / orange tiles, yellow-P-on-white, PackPoints spelling on product chrome, using B as a social hero, mixing A into app thumbnails.

**X avatar (stable URL):** `https://packpts.com/assets/brand/playpackpts-avatar-masked-p-1024.png` (B at 1024). Manifest includes `icon-512-maskable.png` with `purpose: maskable`. Header `img-logo` is Design’s B companion PNG `client/src/assets/packpts-logo.png` (394×128 masked-P + PackPTS wordmark; Vite `/assets/packpts-logo-*.png`). Not the glossy shield.

`packpts-design/` is gitignored and was not on disk in this workspace. Live packpts.com B/A rasters already byte-match `client/public/` (verified 2026-09-20). Do not invent replacements.

---

## 18. Backend Architecture

### Express App Structure
Entry point: `server/entry.ts` (production bundle `dist/index.cjs`). `server/index.ts` exports `bootAfterListen` and is imported after the port is bound.

**Startup sequence:**
1. Environment validation (DATABASE_URL, SESSION_SECRET required), then listen. During the schema window, production serves `/api/version`, a warm `/api/play/m/` JPEG, and SPA HTML/assets for client routes (`mountSchemaWindowSpa`). Other `/api/*` routes get 503 `Retry-After: 2` until the schema step finishes (`server/startup/schemaGate.ts`). A `GET /api/play/m/...` is served from disk only when the HMAC matches a warm JPEG and that card has a `{cardId}_v4.5.ok` sidecar. A successful bake writes it (`bakeMaskedCardFromUrl`). After routes are ready, `startMaskBandGuardScan` reads stored v4.5 plan sidecars. With `MASK_BAND_GUARD=report` (the default) it logs per-set counts and excludes nothing. `enforce` writes `mask_band_oversized` or `mask_band_misplaced` markers. `CURRENT_MASK_VERSION` stays `v4.5`. `startWarmSidecarBackfill` walks the masked-card directory and writes a missing sidecar only when that card is still eligible to serve masked: in `playable_cards` or `baseball_cards`, still playable, game set not inactive, not quarantined for name exposure (`blocked_reason = mask_name_uncovered`) or a broken image (`card_image_quarantine` or `card_image_cache.status = bad`), and the same orientation check as the DB-backed route (`warmMaskedFileAllowed`, including landscape). The walk is 50 files per tick and deletes a sidecar whose card is no longer eligible. The normal `/api/play/m/` route writes the sidecar when it serves a cached file that passed those checks. A JPEG with no sidecar stays 503 during the window. `invalidateMaskReadySidecar` deletes every `{cardId}_*.ok` from image quarantine, `markImageBad`, name exposure, admin unplayable, set deactivation (`PUT /api/admin/game-sets/:id` and `PUT /api/admin/playable-sets/:id`), purge, and hard-delete. A set-sized invalidation scans the masked-card directory once. `/api/play/r/` and `/api/images/card` stay 503 until the schema step finishes. Server GET/POST routes outside `/api` (`/out/*`, `/p/*`, `/r/*`, `/auth/*`, `/wallet`, `/health`, `/internal/*`, `/generated/*`, `/webhooks/*`) also return 503 `Retry-After: 2` during the window, not `index.html`.
2. In production, `runProductionSchemaBoot` (`server/startup/schemaBoot.ts`). If `shared/schema.ts` sha256 matches `.schema-push-hash` and `verifyLiveSchema` passes (one query: `information_schema.columns` plus unique indexes and primary keys), it logs `phase=fast_schema_ok` and returns so routes can open while `drizzle-kit push --force` continues in the background (`lock_timeout=3s`, no `exit(1)` if that push fails or times out). If the hash differs or the probe fails, it logs `phase=fast_schema_fallback` and waits for `runBootSchema` (`server/startup/bootSchema.ts`). `pg_dump` runs only when the hash differs. Dump failure skips the push. Dev skips this (`PACKPTS_SKIP_BOOT_SCHEMA=1` also skips it). The push still runs on every production boot and still drops tables that are not in `shared/schema.ts`.
3. CORS middleware with `ALLOWED_ORIGINS`
4. JSON body parsing (with raw body capture for Stripe webhooks)
5. Request ID injection + structured logging (PII sanitized)
6. Static file serving
7. Auth setup (express-session → PostgreSQL store, Passport)
8. Route registration (game, match, lobby, daily5, wallet, admin, marketplace, friends, referrals, CardHedge, iOS, health, growth)
9. WebSocket server setup on `/ws`
10. Route registration finishes, then production mounts the SPA catch-all (`serveStatic`) last. `markSchemaReady()` opens DB routes and logs `phase=routes_ready`. The early window handler then calls `next()` for every path. Boot logs also stamp `listen`, `fast_schema_ok` or `fast_schema_fallback`, `pg_dump_start` / `pg_dump_end` (or `pg_dump_skipped`), and `drizzle_push_start` / `drizzle_push_end` (`[Startup] phase=<name> ts=<iso>`). Missing `/assets/*` files log `[Static] 404 METHOD path` and do not print an ENOENT stack. `pg_dump` is killed after 90s and the push is skipped. A foreground `drizzle-kit push` is killed after 120s and the process exits 1. A background push that fails or times out logs FATAL, clears the schema marker, and stays up. `storage.initialize()` is killed after 60s and the process exits 1. A normal storage error stays non-fatal. Production then starts the warm sidecar backfill.
11. Background jobs start after routes are ready (on the fast path that overlaps the background schema push): risk pipeline, image validation (6h), card pool refresh (12h), session cleanup (1h), match cleanup (1h), redemption cleanup (1h). SIGTERM/SIGINT stop accepting immediately, close idle keep-alives, stop new WebSocket upgrades, send close code 1001 to every `/ws` client, terminate any still open after 500ms, and close the WebSocketServer so upgraded sockets do not hold `server.close()`. In-flight HTTP responses still finish. The process then exits, with `closeAllConnections` and the 2s close grace inside the 5s hard cap. Shutdown hooks still run at the signal (kill the schema push process group, stop the sidecar walk, stop jobs, close sockets), then the pool closes. Railway's `drainingSeconds` stays 30, and the volume still blocks the next container until this process exits, so a longer in-process drain widens the 502 gap. Clients treat 1001 as a restart and reconnect without an error toast.

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
- **Admin:** `/api/admin/*` — 40+ endpoints for dashboard, users, cards, redemptions, streaks, products, access, geo, growth, panic. All `/api/admin/*` mutating routes require session auth + `requireAdmin` (the temporary D5-2 token-gated one-shot tweet route was removed). `DELETE /api/admin/game-sets/:id` hard-deletes the set row via `hardDeleteGameSet` (`server/services/gameSetDelete.ts`), which locks the set row before removing FK dependents so an in-flight import cannot insert `playable_cards` mid-delete. A remaining FK block returns 409 with `error` from `describeGameSetDeleteError` (`server/services/gameSetDeleteError.ts`) naming the constraint. `PUT` remains the path to toggle `isActive`. The `/admin/playable-sets` Game Sets table is the admin UI for that DELETE (not store/product delete). `POST /api/admin/qa/seed-receipt-fixtures` upserts Design receipt re-QA rows for `designqa` (optional `{ username }`).
- **Friends:** Friend list management, match invites
- **Referrals:** `/api/referrals/*` — create, attribute, stats, leaderboard
- **Share cards:** `GET /api/content-assets/latest`, `POST /api/content-assets/retry` — score-card PNG lookup + regenerate (`matchId` / `challengeId`) and maker-share PNG lookup + regenerate (`setId`). Files live on the Railway volume at `/app/data/masked-cards/generated/share/` (the non-root `packpts` user cannot write `/app/public`). Public URL prefix `/generated/share/` is mounted from that directory in production and from `public/generated/share` in local/CI. Inter TTFs ship in `server/contentFactory/assets/fonts/` and are outlined into SVG paths at generate time — Railway Alpine has no system fonts, so `<text font-family="sans-serif">` produced tofu on the live 1080 card. Maker share contract: `docs/MAKER_SHARE_CONTRACT.md` (1080 square, v1 compose = set name + mixtape + masked card grid + masked-P footer + `packpts.com/sets/{slug}`; JPEG/WebP thumbs from `/make` identify; cream + black bar per missing mask; never stock fans). Tokens: `server/contentFactory/makerShareAssets.ts`. Daily 5 Game Complete **Beat me** is a signed challenge token (not a PNG/caption): `POST /api/daily5/beat-me`, `GET /api/daily5/beat-me?challenge=` — see `docs/DAILY_BEAT_ME.md`. The 1080 card still ships as the share image (live `X/5`, optional real streak, SCORE_CARD_CONTRACT **§3b** `{MON} {D} · TODAY'S FIVE` + mini masked-strip, palette `#0b0f16` / `#F5C518` / `#22C55E` / `#F0F2F5` / `#8F96A3`, masked-P). Visual footer is `packpts.com/daily` only when `mode === "daily5"` (solo/1v1 print `packpts.com`); Daily 5 Beat-me href is the token URL. Day key is America/Chicago via `shared/packptsDay.ts`.
- **Card of the Day:** `GET /api/card-of-the-day` is **retired**. Returns `200 { "card": null }`. The old handler 500’d in production (verified 2026-09-08: `{"message":"Failed to get card of the day"}`) because it queried `card_of_the_day` + `game_answers` and `playable_cards.player_name/set_name/year/is_active` — none of those match Railway schema. Home widget removed. Daily 5 is the daily ICP product.
- **Health:** `/api/health`, `/api/version` (`buildId` matches the served client; `Cache-Control: private, no-store`; no ETag, so no 304)

### WebSocket Server
- Upgrade path: `/ws` (`WebSocketServer` in `noServer` mode). SIGTERM stops new upgrades, closes clients with 1001, terminates stragglers after 500ms, and closes the WebSocketServer. The socket close during that shutdown does not cancel the match or broadcast `participant_disconnected`.
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

The database has **144+ tables** defined in `shared/schema.ts` using Drizzle ORM. Production boot still runs `drizzle-kit push --force` from `server/startup/bootSchema.ts` on every boot. When the schema file hash matches the last successful push and the catalog probe passes, DB routes open first and that push runs in the background. Otherwise it finishes before any DB-dependent route serves traffic. That push drops tables that are not in `shared/schema.ts`. `job_queue`, `promotions`, `user_attribution`, `creator_applications`, `partner_inquiries`, and `user_feedback` are declared there for that reason. `refresh_tokens`, `apns_tokens`, and `apple_transactions` were already declared. Below are the major domain groups with key tables.

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
| `anonPlayers` | Guest identity (hashed cookie). Not a `users` row. Escrow points until claim |
| `anonGameCredits` | One escrow credit per finished guest round |
| `anonDailyRuns` | Guest Daily 5 progress until claim copies `daily_challenge_entries` |
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
| `wallets` | User PackPTS balance, USD `rebate_balance_cents` cashback, status |
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
| `redemptionCredit` | Issued store credits / cashback grant row |
| `rebateLedger` | Append-only USD cashback ledger (GRANT / PAYOUT / PAYOUT_REFUND) |
| `rebatePayoutRequests` | User withdrawal requests (REQUESTED / PAID / DENIED) |
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
| `PRICE_CAPTURE_MAX_FETCH` | Max cards the daily price capture considers per run (CardHedge calls are at most this many; default keeps volume ≤200/day) | 200 |

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
| `SOCIAL_MEDIA_AGENT_ENABLED` | Enable autonomous Social Media Agent (Daily 5 ritual only; SoR preflight rejects FOMO) | "false" |
| `AGENT_DRY_RUN` | Queue posts but skip actual publishing | "false" |
| `AGENT_TIMEZONE` | Documented scheduler timezone (Daily 5 slots are hard-locked to America/Chicago) | "America/New_York" |
| `AGENT_MIN_POSTS_PER_DAY` | Unused for auto queue (fixed 2 Daily 5 slots) | 2 |
| `AGENT_MAX_POSTS_PER_DAY` | Unused for auto queue (fixed 2 Daily 5 slots) | 4 |
| `AGENT_DAILY_QUEUE_BUILD_HOUR` | CT hour to build daily queue | 2 |
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
| `STALE_REDEMPTION_CLEANUP_ENABLED` | true | Schedule stale redemption cleanup |
| `STALE_REDEMPTION_CLEANUP_MODE` | `dry_run` | `dry_run` logs APPROVED/CREATED candidates and writes nothing. `live` cancels them, capped by `STALE_REDEMPTION_MAX_PER_RUN`, and skips APPROVED intents that already have an outbound click, EPN postback, or purchase evidence |
| `STALE_REDEMPTION_MAX_PER_RUN` | 50 | Live-mode cap on stale redemption mutations per run |
| `EXPIRATION_MODE` | `dry_run` | Scheduled `packpts_expiration` only. `dry_run` logs the catch-up and writes nothing. `live` honors grace and the per-run bucket cap. Not flipped to live in code |
| `EXPIRATION_MAX_BUCKETS_PER_RUN` | 500 | Live-mode cap for the scheduled expiration job |
| `EXPIRATION_ENABLED` | true | Set `false` to skip scheduling `packpts_expiration` |
| `EXPIRATION_RUN_HOUR_UTC` | 6 | Hour (UTC) the hourly expiration check actually runs |

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
| POST | /api/game/start | No* | Start solo session. Guests: 403 `ANON_GATE` when the registration gate is hard |
| POST | /api/game/answer | No* | Submit answer |
| POST | /api/game/next | No* | Next question. Finishing a guest round escrows points (`anonGate` on the response) |
| POST | /api/game/session/:id/replace-card | No* | Replace failed card |
| GET | /api/anon/status | No | Guest gate phase for the current cookie. Registered callers get `anonymous: false` |
| POST | /api/daily5/start | No* | Start daily challenge. Guests inside the gate; hard gate is 403 `ANON_GATE`. In-progress resume is allowed |
| POST | /api/daily5/answer | No* | Submit daily answer |
| POST | /api/daily5/finish | No* | Finish Daily 5. Guests escrow; registered users credit as before |
| GET | /api/daily5/status | No* | Today’s challenge + existing entry (`answers[]`, score) plus `anonGate` for guests. Client resumes from this. |
| GET | /api/daily5/leaderboard | No | Daily rankings (claimed / registered entries) |

*Guests may play solo, `/sets`, and Daily 5 until the registration gate (§5). Points earned while anonymous sit in escrow and move to the wallet on register, local login, or WorkOS claim. 1v1 still requires auth. Beat-me still requires auth.

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
| GET | /api/marketplace/redemption/receipts | Yes | Receipt list + `rebateBalanceCents` |
| GET | /api/marketplace/redemption/receipts/:intentId | Yes | Live receipt + `grantMethod` + plaque |
| GET | /api/marketplace/redemption/receipts/:intentId/png | Yes | 1080 PackPTS receipt PNG (DejaVu) |
| GET | /out/ebay/:listingId | No | Affiliate redirect |

### Social
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/lobby/create | Yes | Create match lobby |
| POST | /api/lobby/join | Yes | Join lobby |
| GET | /api/leaderboard | No | Global rankings |
| POST | /api/referrals/create | Yes | Create referral link. Daily 5 Beat-me sets `destinationPath` to `/daily?utm_source=share&utm_medium=beatme&utm_campaign=daily5&challenge={token}` |
| POST | /api/daily5/beat-me | Yes | Sign today’s CT Daily 5 session into a Beat-me token (real X/5 only) |
| GET | /api/daily5/beat-me | No | Resolve token: `active` / `stale` / `invalid` against today’s CT day key |
| GET | /api/card-of-the-day | No | Retired. Always `200 { "card": null }` (was a production 500) |
| GET | /api/content-assets/latest | Yes | Latest score card (`matchId` / `challengeId`) or maker share (`setId`); repairs missing PNGs |
| POST | /api/content-assets/retry | Yes | Force-regenerate a score card or maker-share PNG |
| GET | /api/share/play-sets | No | Marketing play-sets share JSON: destination (`/sets` or `/sets/{slug}` + locked play_sets UTMs), `imageKind` `runtime`\|`kit`, `kitUrl`, `storyUrl`, OG fields. Query: `surface` (`beat_me` / `beat-me` / `beat_me_from_a_set` → C), `set` or `slug` (UUID or public slug; URLs cleaned), `asset`, `format=square\|story` |
| GET | /api/share/play-sets/image | No | PNG — kit template, Design story crop (1080×1920), or runtime cover/crop for a known set |
| GET | /api/share/play-sets/og.png | No | 1200×630 letterbox of the same image for crawlers |
| GET | /api/auth/tiktok/sandbox/start | No | TikTok Login Kit OAuth start (sandbox review). Redirect URI `https://packpts.com/auth/tiktok/callback`. Scopes: `user.info.basic`, `video.publish`, `video.upload` |
| GET | /auth/tiktok/callback | No | TikTok Login Kit callback (portal-registered). Exchanges code, stores tokens on the session, redirects to `/review/tiktok-sandbox` |
| GET | /api/review/tiktok-sandbox/session | No | Sandbox session status (configured / connected / granted scopes). Soft-fails if `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` missing |
| POST | /api/review/tiktok-sandbox/publish | Session | Content Posting photo init (`MEDIA_UPLOAD` or `DIRECT_POST`, PHOTO, PULL_FROM_URL `https://packpts.com/og-image.png`) |
| GET | /api/review/tiktok-sandbox/status | Session | Poll `publish_id` until `PUBLISH_COMPLETE` / `SEND_TO_USER_INBOX` / `FAILED` |

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
| `growth.newSignupsThisWeek` | `users` | Signups this week vs last week + WoW % — `is_admin` and `is_bot` excluded |
| `retention.d7Pct` | `event_log` first-active cohort | Latest mature D7 (same definition as `/api/admin/retention`) |
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

**Vitest integration tests** (`server/tests/` — 15 test files, 230+ tests, most require a live PostgreSQL connection):
| File | Tests | What it covers |
|------|-------|---------------|
| `wallet.test.ts` | 23 | WalletService: credit/debit, idempotency, frozen-wallet guard, ledger balance consistency |
| `antiPruning.test.ts` | 19 | Anti-pruning logic for card exclusion |
| `card-image-pipeline.test.ts` | 7 | Card image validation pipeline |
| `baseballCardsLegacy.test.ts` | 5 | Legacy baseballCards fallback table decision (see Data Model section) |
| `contentFactory.test.ts` | 14 | Score card / streak badge generation, 1080 contract, DB idempotency, missing-PNG repair |
| `scoreCardRender.test.ts` | 8 | Bundled Inter, pip fill, Beat-me palette/streak, §3b today identity, masked-strip, outlined 3/5 PNG pixels (no DB) |
| `gameImageRender.test.ts` | 7 | Social PNG tofu guard + SOCIAL_PNG_QA: no `<text>` / sans-serif, outlined Inter, painted regions, Inter+DejaVu gate, Design-bake prefer (no DB) |
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
| `dev` | `NODE_ENV=development tsx --env-file .env server/entry.ts` | Start dev server with hot reload |
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
- **Volume:** `packpoints-game-volume` mounted at `/app/data/masked-cards` (masked-card cache). Railway mounts volumes root-owned, and the app runs as non-root `packpts` — so `start.sh` boots as root, chowns the mount root only when `stat` shows a different uid, then drops privileges via `su-exec` and `exec`s Node so SIGTERM reaches the drain handler (the Dockerfile has no `USER` directive for this reason). A recursive chown of the cache is not used. Do NOT re-add `USER packpts` to the Dockerfile or set `RAILWAY_RUN_UID=0`; either breaks the chown-then-drop pattern. Before this fix (July 2026), every new masked-card write failed with EACCES in production. The volume still stops the old container before the new one starts, so `railway.json` does not set `overlapSeconds`. It does set `healthcheckPath` `/api/version`, `healthcheckTimeout` 120, and `drainingSeconds` 30. The Dockerfile `HEALTHCHECK` is ignored by Railway. True zero downtime needs the masked-card cache moved to a bucket.

### User-data retention (owner mandate — usernames, password hashes, PackPTS history must never be lost)

Three layers, all writing compressed `pg_dump` restore points (full DB: users, wallets, ledger, everything) to `/app/data/masked-cards/.db-backups/` on the persistent volume:
1. **Boot dumps** (`pre-push-*.dump`, `server/startup/bootSchema.ts`): after listen, before a schema push when `shared/schema.ts` sha256 differs from `/app/data/masked-cards/.schema-push-hash` (written only after a successful push, on the volume). `drizzle-kit push --force` still runs on every production boot before DB routes open. Dump failure still skips the push and does not update the marker. A `pg_dump` that is still running after 90s is killed and treated as a failed dump (push skipped, marker unchanged). A `drizzle-kit push` still running after 120s is killed, logged, and the process exits 1 so Railway fails the deploy and keeps the previous one. `storage.initialize()` has the same exit on a 60s timeout. Keep 14.
2. **Daily dumps** (`daily-*.dump`, `server/services/dbBackupService.ts`): scheduled every 24h plus a startup catch-up when no dump is fresher than 20h. Keep 30.
3. **Owner retrieval without CLI:** `GET /api/admin/backups` (list) and `GET /api/admin/backups/:name/download` (stream) — admin-only.

Restore procedure: download a `.dump`, then `pg_restore --clean --if-exists -d <DATABASE_PUBLIC_URL> <file>` from a machine with TCP egress (pg_restore v17+).

### Logout + admin-guard repairs (July 2026)

Logout: the real endpoint is `POST /api/auth/local-logout` (destroys session, clears cookie). All logout buttons call `useAuth().logout` which POSTs it then hard-navigates to `/`. A compat shim `GET /api/logout` (destroy + redirect `/`) exists for stale bundles and legacy-era links — previously that URL fell into the SPA catch-all and rendered the 404 page with the session still alive. `ProtectedRoute` gates admin routes on `user.isAdmin` (the API's real field); it briefly gated on a nonexistent `role` field, which bounced every authenticated user — including real admins — from all `/admin/*` routes to the homepage. Dead client targets `/api/login`, `/game`, `/play`, and the server redirect `/settings/accounts` were repointed to real routes; `/admin/set-of-week` is now routed and in the admin sidebar.

### Collector Intelligence — analytics event spine (July 2026, Prompt 1 of ANALYTICS_PROMPTS.md)

The strategic data asset (see `ANALYTICS_PROMPTS.md`). Append-only, PII-free demand-signal capture:
- `analytics_events` — one row per high-signal action (`answer_submitted` with outcome+latency, `listing_click`, `set_started`, `set_published`, …), dimensioned by `player_key`/`game_set_id`/`year`/`sport`, keyed on `user_hash` (HMAC-SHA256, never raw id), with `is_clean` (false for flagged/frozen users, refreshed from `user_risk_state`).
- Written ONLY via `server/services/analytics/track.ts` — fire-and-forget, batched, never blocks or throws into the request path. Do not query risk state per-event; the flagged-user set is cached and refreshed.
- `card_price_history` — daily CardHedge price snapshots (`server/services/analytics/priceCaptureWorker.ts`, hourly-safe, idempotent per day/player/year). **Captures NOW because the Attention Alpha correlation (Prompt 6) needs price history that cannot be backfilled.** Candidates are cards played in the last 30 days: clean `analytics_events` with `event_type='answer_submitted'`, grouped by card and ordered by play count. `analytics_events.card_id` is `playable_cards.id` for current solo and 1v1 questions (a CardHedge id is also accepted) and is resolved through `playable_cards` → `game_sets` for `cardhedge_card_id`, `gs.year`, and `gs.sport`. `playable_cards` has no `year` column. Legacy `baseball_cards` rows have no CardHedge id and are skipped. If that window has no clean answer events, the run falls back to `is_playable` cards in active `game_sets`. A `card_details_cache` row with `raw_images_only=false` and `fetched_at` within 24 hours is reused; otherwise the worker calls `fetchCardDetailsNormalized` (concurrency 2, ~250ms spacing), upserts that cache row the same way as `GET /api/cardhedge/card/:cardId`, and inserts `card_price_history` with `onConflictDoNothing`. The public card endpoint is unchanged. Cap: `PRICE_CAPTURE_MAX_FETCH` (default 200), so CardHedge volume stays ≤200 calls/day. One log line when `CARDHEDGE_API_KEY` is unset. Summary: `[PriceCapture] candidates=N cacheHits=H fetched=F noPrice=X failed=Y captured=C for <day>`, plus the first error when any row fails. `player_key` is `rewardEngine.normalizePlayerKey(player, sport || "baseball")`, the same key `answer_submitted` writes, so `card_price_history.player_key` joins `card_attention_daily.player_key`. Guard: `server/tests/priceCapture.test.ts`.
- Admin: `GET /api/admin/analytics/events/summary` (health/verify), `POST /api/admin/analytics/backfill` (one-time reconstruction from completed sessions, events flagged `{backfill:true}`).
- Instrumentation must never break gameplay — every `track()` call is wrapped/guarded. This is the foundation; the indices (Prompts 3–6) are derived views, never the source of truth.

### ⚠️ TikTok App Review — brand-name consistency (MISSION CRITICAL for social publishing)

TikTok App Review rejects the app unless the **app name matches everything else exactly**. The canonical product name is **PackPTS** (matches the domain `packpts.com`). App-facing names below MUST stay `PackPTS`. The X/Twitter handle is a separate string (`@PlayPackPTS`) and is not a product rename:

1. **TikTok app name** (developer portal, Basic Information) = `PackPTS`. Do not set the TikTok app name to `PlayPackPTS` — that is the X/Twitter handle only (`@PlayPackPTS`), not the product name. `PlayPackPTS` as an app name would imply a `playpackpts.com` domain, which we will never buy.
2. **Website `<title>`** (browser tab, `client/index.html`) = exactly `PackPTS`. Do NOT re-add a marketing tagline here without renaming the TikTok app to match.
3. **Domain** = `packpts.com` (root `packpts` == `PackPTS`).
4. **ToS page** displayed title/H1 = `PackPTS Terms of Service`; **Privacy page** H1 = `PackPTS Privacy Policy` (both also set `document.title` accordingly).
5. **Both policy bodies must name the app** (`PackPTS`) — they do.
6. **TikTok portal fields**: Website URL `https://packpts.com`, Redirect domain `packpts.com`, ToS `https://packpts.com/terms-of-service`, Privacy `https://packpts.com/privacy-policy`.
7. **X/Twitter handle** in raw HTML (`<meta name="twitter:site">` and `twitter:creator` in `client/index.html`) = `@PlayPackPTS`. This is the PackPTS X account only — the product/app name stays `PackPTS`. Do not use `@packptsapp` or `@packpoints`. PR #54 pointed `twitter:site` at `@packptsapp`; that was wrong.
8. **URL-prefix verification** (PULL_FROM_URL): keep `client/public/tiktokpiy5SPhPPkFUI7E2p74deskh9egj0WbS.txt` so `https://packpts.com/tiktokpiy5SPhPPkFUI7E2p74deskh9egj0WbS.txt` stays publicly reachable. Do not delete.

### TikTok App Review sandbox demo (2026-09-05)

Review-only PackPTS shell for Design to screen-record Login Kit + Content Posting. Not marketed in nav.

- **Live URL:** `https://packpts.com/review/tiktok-sandbox`
- **Page:** honest PackPTS dark UI (`#0b0f16`), masked-P mark only, Daily 5 / masked-card copy. No fake TikTok chrome. No PackPoints / three-square mark.
- **OAuth:** `GET /api/auth/tiktok/sandbox/start` → TikTok Login Kit (`https://www.tiktok.com/v2/auth/authorize/`) requesting `user.info.basic`, `video.publish`, `video.upload`. Callback is the portal-registered `https://packpts.com/auth/tiktok/callback`. Tokens stay on the Express session (not the growth-agent `TIKTOK_ACCESS_TOKEN`).
- **Publish:** `POST /api/review/tiktok-sandbox/publish` calls `open.tiktokapis.com/v2/post/publish/content/init/` with `media_type: PHOTO`, `source: PULL_FROM_URL`, `photo_images: [https://packpts.com/og-image.png]`, `post_mode: MEDIA_UPLOAD` or `DIRECT_POST`. Unaudited Direct Post uses `SELF_ONLY`. Status poll: `GET /api/review/tiktok-sandbox/status?publish_id=`.
- **Soft-fail:** missing `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`, missing session token, or missing granted scopes return a visible error. Never silent-fail.
- **Env:** uses existing Railway `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`. No new third-party service.
- **Code:** `server/services/tiktokSandbox.ts`, `server/routes/tiktokSandbox.routes.ts`, `client/src/pages/tiktok-sandbox.tsx`.

Also: ToS/Privacy links must be in the RAW homepage HTML (a static `#static-legal-footer` outside React's `#root` in `client/index.html`) so TikTok's crawler sees them without JS. The apex domain must serve the Railway app (not the retired host) or every link check fails — see the DNS note below.

**No TikTok API exists for app-review resubmission** — the final Return-to-Draft → set fields → Resubmit is a developer-portal action requiring the owner's TikTok login; it cannot be automated from this environment. Everything on the website side is automatable and must be made correct first.

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

`GET /api/version` is the deploy verification canary. The response includes the short git SHA (`sha`) and the client build id (`buildId`). `Cache-Control` is `private, no-store` (also `CDN-Cache-Control: no-store`). The handler strips `If-None-Match` / `If-Modified-Since` and does not emit `ETag` or `Last-Modified`, so the edge and the browser cannot reuse an old body via 304. `/` and other SPA HTML use the same no-store policy. Only Vite content-hashed files under `/assets` (8-character content hash) are `public, max-age=31536000, immutable`. Other `/assets` files, including `/assets/play-sets/integrated-shelf.png`, stay `public, max-age=0` and revalidate.

```json
{ "buildId": "<railway sha, git HEAD, or t<ms>>", "v": 34, "sha": "a1b2c3d", "deployed": "2026-06-15", "build": "prompt-26-auto-risk-scoring" }
```

**Deploy verification checklist** (run after every `git push main`):
1. Wait for Railway to show deployment status → **SUCCESS**
2. `curl -s https://www.packpts.com/api/version` — confirm `sha` matches `git rev-parse --short HEAD`
3. Confirm `buildId` is present, `Cache-Control` contains `no-store`, and there is no `ETag`. A tab opened before this deploy polls every 60s and on focus/visibility/online, and retries that poll once after about 2s on 502/503. It reloads when the player leaves a play session, or when the tab is idle (including hidden with no session). It does not reload mid-question, on Next Question, when Game Complete appears, between Daily 5 cards, during a live 1v1, while a 1v1 lobby is waiting or counting down, during matchmaking, or twice for the same id. A chunk-load error reloads only when that chunk 404s or the build id changed. A network blip retries the import once and toasts.
4. If `sha` is `"dev"`, the build did not inject correctly — check `script/build.ts` define block
5. If `v` is stale, Railway may still be deploying — wait 30s and retry

**How the ids are injected:**
- `sha`: `script/build.ts` calls `git rev-parse --short HEAD` at build time (Railway runs this during build), then `RAILWAY_GIT_COMMIT_SHA` (first 7 chars), then a timestamp. esbuild `define` replaces `process.env.BUILD_COMMIT_SHA`.
- `buildId`: `RAILWAY_GIT_COMMIT_SHA`, else full `git rev-parse HEAD`, else `t<ms>`. Vite `define` inlines `__PACKPTS_BUILD_ID__` and writes `<meta name="packpts-build-id">` into `dist/public/index.html`. In production, `/api/version` reads that meta so the JSON matches the bundle being served. The same value is also inlined as `process.env.PACKPTS_BUILD_ID` for the fallback. Decision logic: `shared/buildVersion.ts`.
- Docker: `railway.json` builds with the Dockerfile, and `.dockerignore` excludes `.git`. Railway passes `RAILWAY_GIT_COMMIT_SHA` into the image only when the Dockerfile declares `ARG RAILWAY_GIT_COMMIT_SHA`. That ARG plus `ENV RAILWAY_GIT_COMMIT_SHA` sits immediately before `RUN npm run build`, so both `buildId` and the `sha` canary see the merge commit instead of a `t<ms>` timestamp.

---

## 25. Known Bugs, Gaps, and Risks

### Gameplay
- [x] Brand mark dual-logo (2026-09-20): header shipped the glossy 3-card shield (`packpts-logo.png`) into app thumbnails. Two-role SoR: **B masked-P** on header/favicon/PWA/manifest; **A masked-card** on OG/social only. Header `img-logo` is Design’s 394×128 B wordmark companion (same filename `packpts-logo.png` so Vite hashes `/assets/packpts-logo-*.png`). Manifest lists `icon-512-maskable.png`. X avatar `/assets/brand/playpackpts-avatar-masked-p-1024.png` matches attached B 1024 (`icon-1024.png` bytes).
- [x] Product copy honesty — no eBay checkout discount / gift card claims (2026-09-20): live UI (home FAQ, partners, roadmap Done item, store, marketplace apply dialog, Redeem-tab catalog, meta/OG, `/api/redeem` success message) no longer claims Apply PackPTS reduces the eBay price or that PackPTS issues real eBay gift cards. Honest sentence: browse live listings; partner checkout stays full price; PackPTS may pay cashback after a confirmed purchase. Guard: `server/tests/ebayApplyCopyHonesty.test.ts`. Audits: `docs/audits/APPLY_PACKPTS_EBAY_2026-09-20.md`, `docs/audits/REDEEM_REAL_VALUE_PLAN_2026-09-20.md`.
- [x] Marketplace cashback fulfillment (2026-09-20): apply → tracked outbound → EPN postback or confirm+evidence → `wallets.rebate_balance_cents` + `/redemptions` receipt + email. Admin grant/deny + payout queue. Fake gift-card SKUs stay labeled tokens. Ops: fund treasury; configure EPN postback URL; pay withdrawal requests.
- [x] Receipt plaque Design contract (2026-09-20): `/redemptions` + `/redemptions/:id` use `shared/receiptContract.ts` chip map (`CREATED`→`PENDING`, `PURCHASE_CONFIRMED` + “Credit pending review” for ≥$25, never `UNDER_REVIEW`). Partner price / Post-purchase rebate / Partner checkout unchanged. Wallet header = `rebateBalanceCents`. CREDIT_GRANTED shows quiet `grantMethod` (`Affiliate confirm` / `You confirmed` / `PackPTS review`). Footer B masked-P (`/packpts-mark.svg`). Optional 1080 PNG: `GET .../receipts/:id/png` + `generateReceiptPng.ts` (DejaVu, SOCIAL_PNG_QA). Guards: `receiptContract.test.ts`, `receiptPng.test.ts`.
- [x] Design GREEN soft — CREATED on `/redemptions` list (2026-09-20): `listReceipts` omitted `CREATED`, so Designqa fixture `ea928e8b-f972-4d63-990b-20d1fd71536d` deep-linked and PNG’d but was missing from the list. `RECEIPT_LIST_STATUSES` now includes `CREATED`. Chip map unchanged (`CREATED`→`PENDING`). Guards: `receiptContract.test.ts`, `rebateGrant.test.ts` (`listReceipts includes CREATED`).
- [x] Design receipt re-QA seed (2026-09-20): `POST /api/admin/qa/seed-receipt-fixtures` upserts `qa-receipt-*` intents for user `designqa` (CREDIT_GRANTED, PURCHASE_CONFIRMED, CREATED→PENDING chip, APPROVED, DENIED). Idempotent rebate GRANT. Stale cleanup skips `qa-receipt-%`. Guard: `server/tests/seedReceiptFixtures.test.ts`. No Design UI invented.
- [x] Admin user-count honesty (2026-09-20): `/admin/dashboard` “Total Users” was `users.length` (staff + bots included). Headline is now `registeredUsersNonStaff` (`is_admin = false` AND `is_bot = false`). 7d signups and scorecard weekly signups use the same exclusion. Cite the live admin field; do not invent a number. SQL: `server/services/userCounts.ts`.
- [x] Game Complete / Daily 5 score card PNG (2026-09-05): generation wrote to `/app/public/generated/share`, which the non-root `packpts` process cannot mkdir (`EACCES`). Confirmed in production deploy logs. Cards now write to the persistent volume `/app/data/masked-cards/generated/share/` and are served at `/generated/share/`. Failed rows (insert-then-EACCES) are repaired on `GET /api/content-assets/latest` and via `POST /api/content-assets/retry`. Finish handlers await generation up to 1.5s and return `shareImageUrl` so the 1080×1080 card can appear within ~2s on Safari. Locked Design contract: `docs/SCORE_CARD_CONTRACT.md` (1080 square, actual X/5, five `#22C55E` pips, “N locked. M open.”, masked-P + PackPTS, packpts.com/daily visual CTA, **§3b today identity** `{MON} {D} · TODAY'S FIVE` on the America/Chicago CT day key plus mini cream/gold masked-strip) and `docs/EMPTY_STATE.md` (no broken-image glyph; “Score card didn’t load.” + Retry `#2B6CEE` + Share without card). `/daily` is an alias for `/daily5`. Elevated OG lives at `client/public/og-image.png`; Daily 5 masked tease v2 at `client/public/daily5-masked-1080-v2.png`.
- [x] Daily 5 Beat-me product loop (2026-09-08): Game Complete **Beat me** issues `POST /api/daily5/beat-me` (real completed-entry X/5 + CT `puzzle_day`) and shares `https://packpts.com/daily?utm_source=share&utm_medium=beatme&utm_campaign=daily5&challenge={token}`. Recipient: `Beat {name}. They went {score}/5 today`. Stale CT day: `Challenge expired. Play today's five.` Day key shared with Daily 5 + streak: `America/Chicago` (`shared/packptsDay.ts`). Contract: `docs/DAILY_BEAT_ME.md`.
- [x] Daily 5 Beat-me craft (2026-09-24): Fanatics #1 chrome. Killed `points on PackPTS` challenge copy in `game.tsx`. Game Complete **Beat me.** is the gold primary and shares the signed URL plus challenge PNG (`buildChallengeShareSvg`: CT today identity, mini strip, honest X/5, `Beat me.`, masked-P). Landing banners are a quiet `#161B24` bar with a gold edge. Active / stale / invalid, quiet compare, and **Browse sets** → `/sets` follow `docs/DAILY_BEAT_ME.md`. No Maker Rate and no `/make` publish from Beat-me.
- [x] Daily 5 resume desync (2026-09-08): in-progress reload showed card 1 + Submit; server returned `Position 1 already answered`. Root cause: `daily5.tsx` `startMutation` reset `currentPosition` to 1 / score to 0 and ignored `entry.answers`. Client now hydrates via `resolveDaily5Resume`. Blocks Design §3b Game Complete QA until deployed.
- [x] `/api/card-of-the-day` production 500 (2026-09-08): live curl returned `{"message":"Failed to get card of the day"}`. Root cause verified in code: handler joined `card_of_the_day` (not in drizzle schema), `game_answers` (table does not exist), and `playable_cards.player_name/set_name/year/is_active` (actual columns are `player`/`set`/`is_playable`; no `year`). Not on the Daily 5 ICP path. Endpoint now returns `200 { "card": null }`; home widget removed.
- [x] Maker share v2 (2026-09-08): Surface A — after `/make` publish succeeds, default share art is a runtime 1080 PNG of that set’s masked cards (Daily 5 `WHO IS THIS PLAYER?` language) + set name + mixtape + `packpts.com/sets/{setSlug}`. v1 compose (no Design polish block): name + mixtape (Inter/DejaVu) + **card grid** (3–8, card-aspect crop) + masked-P footer. Inputs = `/make` identify JPEG/WebP. Mask failure → cream + black redaction bar per card; never `maker-set-1080.png`. Design tokens in `makerShareAssets.ts`. Sets Made optional after ≥10 non-staff sets; no Maker Rate. Contract: `docs/MAKER_SHARE_CONTRACT.md`. Collab templates stay.
- [x] Maker-supply instrument (2026-09-08): `event_log` funnel `/make` start → identify success/fail → name/mixtape → publish success/fail → share generated → share opened → `/sets/:id` view. Admin Making Layer panel shows `publishedSetsNonStaff` / 10 gate + 7d/30d conversion + top drop-off + MAKE_FRICTION KPIs (identify fail rate, time-to-publish, name/mixtape drop-off, share open rate). Staff exclusion = `users.is_admin`. Identify 15s abort raised to 45s (OpenAI 40s). Empty `/make` first-pass CTA no longer swallowed during auth load; failed identify has New photo. No public Maker Rate / volume claims.
- [x] `/make` empty-state + identify-retry (2026-09-08): no-draft chrome is Design EMPTY_STATE (`docs/design/EMPTY_STATE.md`, mock `make-empty-state-1080.png`) — SNAP-TO-SET / Photo the stack / 5-card DESK example fan / EXAMPLE · NOT YOUR PC / Take photo + Choose from library. Soft auth: `Sign in to photo your stack.` MAKE_FLOW auth-before-upload unchanged. Draft row is Design IDENTIFY_RETRY (`docs/design/IDENTIFY_RETRY.md`, mock `make-identify-retry-1080.png`): `Identifying your stack` + Sequential board; failed slot `Couldn't identify` + **Try again** + Skip, gold-40% border, no alarm red or toast-per-failure. Handoff: `docs/design/ENG_HANDOFF.md`. Empty chrome is not Surface A share art.
- [x] Staff QA identify-fail (2026-09-08): admin/staff on `/make?qaIdentifyFail=1` or `?qa=identify-fail` (or one-shot `packpts:make:qaIdentifyFail` storage) injects one Failed draft slot without calling identify, so Design can screenshot retry chrome without the file picker. Non-admin: param ignored silently. Try again on the stub stays Failed (no API). Skip removes the slot. Production identify pipeline unchanged.
- [x] `/sets` no-cover fallback (2026-09-26): an empty `coverCardUrls` stack keeps the cream card and reuses the fanned-thumb `MaskPlaque` (`chrome="bar"`): `data-plaque-chrome="bar"` and the gold seam, no PTS label, no photo URL. In-game plaque, mask bake, and reveal are unchanged.
- [x] `/sets` index polish (2026-09-25): fanned thumbs paint a solid plaque with the gold seam and no "WHO IS THIS PLAYER?" label. The short-shelf banner is removed (it undersold a 7-set shelf). Index titles insert a stored brand the set name omitted. Live set `229f0379-aa56-40a8-abe3-1af217a397e8` is setName `2024 Basketball`, brand `Topps`, year `2025`; the heading is `2024 Topps Basketball`. The year column is not substituted. In-game plaque, mask bake, and reveal are unchanged.
- [x] `/sets` index lists integrated playable sets (2026-09-25): `GET /api/sets` no longer selects user-created rows. The shelf is active integrated sets with at least 5 eligible cards, same deal predicate and name/year/sport dedupe as `GET /api/playable-sets`. `cardCount` on the index and on `GET /api/sets/:id` is that eligible count. Integrated pages omit maker, date, and AUTHORED. Index Play is **Play this set**.
- [x] `/sets` Goldin-quiet polish (2026-09-08): index + detail match `docs/SETS_POLISH.md` (play shelf, Surface A cover else masked stack, honest `{n} cards`, short-shelf banner below the ≥10 gate, no Times Played / Maker Rate / currency chrome). Play uses the set’s real card count (5–20), not a hardcoded 10, and resumes that session on `/game/solo?session=` so the setup picker is skipped. Authored `{MON D}` on index and detail is the same America/Chicago day (`formatPackptsMonDay` / `shared/packptsDay.ts`); `GET /api/sets` serializes `createdAt` as ISO UTC so it matches drizzle on `GET /api/sets/:id` (Design QA on #73: naive browse `2026-09-08 17:38:58` vs detail ISO showed SEP 9 vs SEP 8).
- [x] Product lock — dark `/make` UGC publish (2026-09-08): users never create cards; they play sets already integrated into PackPTS. Public nav / home / `/sets` / set pages / profile no longer link to Snap-to-Set. **Superseded for the route gate (2026-09-22):** non-staff may open `/make` again as catalog-match only. See the Snap-to-Set catalog-match item. `POST /api/collab/create` and `POST /api/collab/:id/publish` stay admin. Daily 5, Beat-me, and `/sets` play stay.
- [x] Snap-to-Set catalog match (2026-09-22): `/make` reopens for guests and non-staff as photo → identify → match an **existing integrated** playable set → **Play this set** → `/sets/{slug}`. Quiet no-match goes to `/sets` (Browse sets + Try another photo). No name, mixtape, Publish set, Surface A, or collab entry on this route. `POST /api/make/identify` and `GET /api/make/match` are read-only (no insert of `playable_cards`, `game_sets`, or `card_photos`). `POST /api/sets/create` returns **410** for every caller, including staff. Match scoring drops `is_user_created` and inactive sets. Copy: `Snap a card. Find its set.` Contract: Design `CATALOG_MATCH_MAKE_SOR`. Helpers: `shared/catalogMatch.ts`, `server/services/catalogMatch.ts`.
- [x] Home vanity quarantine (2026-09-08): home omits **Total Games Played** + **Cards Guessed** until `totalGames ≥ HOME_PLAY_VANITY_MIN_GAMES` (500) or staff flag `home.show_play_vanity`. Below the gate (including while `/api/home-stats` is loading) the rows are absent — no `"—"`, zeros, or Coming soon. Founders FOMO / “Limited Founder spots” progress bar is **not** mounted on home; `GET /api/access/cap` stays for auth / waitlist / admin. `POST /api/auth/register` still `walletService.earn(..., 250, ..., welcome_bonus:{userId})`. Spelling is PackPTS. Contract: `docs/design/HOME_VANITY_QUARANTINE.md`. Helper: `shared/homePlayVanity.ts`. **Superseded for home ads (2026-09-22):** the 250 signup promo is not mounted on home.
- [x] Play-integrated set share kit (2026-09-11): Marketing surfaces A Play this set · B Integrated shelf · C Beat me from a set. Destinations are only `/sets` or `/sets/{slug}` with `utm_source=share&utm_medium=play_sets&utm_campaign=integrated`. Share/OG/`/sets` heroes prefer the set’s runtime cover (existing `maker_set_*` PNG or a server-rendered play-sets crop) when present; kit templates at `/assets/play-sets/*.png` are cold-post placeholders only and never replace a real set cover. No `/make` publish CTA. Surface C is a marketing creative, not a new Beat-me token. Contract: `docs/PLAY_SETS_SHARE.md`. Helpers: `shared/playSetsShare.ts`.
- [x] Play-sets Design QA follow-up (2026-09-11): `surface=beat_me` / `beat-me` / `beat_me_from_a_set` map to C (not integrated_shelf). `set` or `slug` (UUID, `name-a1b2c3d4`, or a `/sets/{slug}` URL) resolves the integrated set, prefers runtime cover, and destinations stay `/sets/{slug}` + locked UTMs. Design export map: `play-set-1080.png` → `play-this-set.png`, `play-shelf-1080.png` → `integrated-shelf.png`, `play-beatme-1080.png` → `beat-me-from-a-set.png`, plus `*-story.png`. Copy-only from `packpts-design/play-sets/exports/` — no invented art. JSON `storyUrl` + `format=story`.
- [x] Play-sets CDN short-name trap (Design QA 2026-09-16): live `integrated-shelf.png` and `*-story.png` were real PNGs; `integrated-set.png`, `integrated-beatme.png`, `play-shelf.png`, `play-set-1080.png`, `play-shelf-1080.png`, `play-beatme-1080.png`, `set-1080.png`, `beatme-1080.png` returned SPA HTML. React does not request those paths; app/API `kitUrl` is `play-this-set.png` / `integrated-shelf.png` / `beat-me-from-a-set.png`. Both naming schemes are hosted from Design `play-*-1080.png` exports (`PLAY_SETS_DESIGN_EXPORT_MAP` multi-dest + `PLAY_SETS_CDN_ALIASES`). Do not invent extra short names.
- [x] Score card tofu / blank type (2026-09-05 follow-up): after the EACCES fix, production PNGs wrote and served but Inter was not in the Alpine image. `sans-serif` text became tofu; X/5, headline, PackPTS, and `packpts.com/daily` were unreadable; pips could look empty when metadata counts failed to coerce. Generator now bundles Inter TTFs, embeds them as `@font-face` data URIs, and outlines every label to SVG paths so Sharp never asks fontconfig for a face.
- [x] @PlayPackPTS social PNG tofu (2026-09-14): `gameImageRenderer.ts` (scheduler → `composePostImage`) still used `<text font-family="sans-serif">`. Same Alpine/fontconfig miss as the score card. All seven social composers now outline Inter (Inter Regular/Bold; no italic face) so Railway PNGs cannot tofu. Pixel guard: `server/tests/gameImageRender.test.ts`. SOCIAL_PNG_QA (`docs/design/SOCIAL_PNG_QA.md`): Inter + DejaVu required (`assertShareFontsPresent` in `script/build.ts` + CI); Alpine `font-dejavu` / Ubuntu `fonts-dejavu-core`; Design-baked social exports preferred when present. Video-factory frame SVGs still use system-ui `<text>` (not this share-PNG path).
- [x] ELO-based matchmaking with expanding band (Prompt 19): matchmaking_tickets.elo_rating column stores player ELO at queue-join time; pairing SQL uses ABS(elo1-elo2) <= LEAST(500, 100 + 50*floor(maxWaitSeconds/30)); starts at ±100, expands ±50 per 30s, caps at ±500 after ~4 min
- [x] AI fallback bot opponent (Prompt 20): after 60s in queue with no human match, dbQueue triggers createBotMatch(); bot accuracy scales with human ELO (1000→55%, 2200→92%); bot answers via scheduleBotAnswers() polling loop every 500ms, random delay 1.5–7s per question; anti-farm cap: 5 bot games per day per user (extras get bot_unavailable); users.is_bot column + seed bot user `packpts-bot-00000000-0000-0000-0000-000000000001`
- [x] Game Complete stranded with no obvious replay (2026-09-16): Solo Play Again is the primary CTA (above share) and immediately restarts the same set + card count for guests and auth users; guest signup modal Skip is Play Again (`client/src/lib/playAgain.ts`). Daily 5 cannot re-run today’s five; complete offers Play Solo / Browse Sets, labeled honestly. 1v1 keeps rematch Play Again and falls back to Play Solo if rematch is declined. Share/download score-card flows from #85 are unchanged. **Superseded for guests (2026-09-21):** Play Again is not unlimited. See the registration-gate item below.
- [x] Anonymous play registration gate (2026-09-21): Stable `anon_players` row (HttpOnly `packpts_anon` + fingerprint hint). Soft prompt after 1 completed Daily 5 or play round; hard stop before a third start or on a next CT-day return. Escrow until register/login/WorkOS claim (`walletService.earn` `anon_escrow:<id>`). `registeredUsersNonStaff` does not count anon. The registration gate does not send people to `/make`. Copy: `docs/design/ANON_REGISTRATION_GATE.md`. `/make` itself reopened 2026-09-22 as catalog-match only.
- [x] Registration-gate account form FOMO (2026-09-21): `SignupModal` Create free account / Sign in reuse `ANON_GATE_COPY` and `PackPTS held`. Removed `Save Your Points!`, `+250 bonus PackPTS`, `250 free PackPTS`, and Claim Points CTAs from that modal and the Game Complete fallback button. Welcome bonus on register is unchanged. `/invite` referral copy is unchanged. Guard: `client/src/lib/__tests__/signupModalCopy.test.ts`. Next Chicago day: `server/tests/anonGate.test.ts`.
- [x] First-visit onboarding bonus FOMO (2026-09-21): `OnboardingModal` step 4 no longer says `Get 250 Bonus Points Free`, `250 PackPTS` / credited on signup, or `Claim Bonus`. Quiet close is create a free account or play first. `POST /api/auth/register` welcome credit, gate plaque, signup-modal copy, and `/invite` rewards are unchanged. Guard: `client/src/lib/__tests__/onboardingModalCopy.test.ts`. **Superseded for home ads (2026-09-22):** the separate home 250 promo is gone.
- [x] Home vanity 250 ads (2026-09-22): guest hero and the mid-page account card no longer say `New players get 250 free PackPTS on signup`, `Claim 250 Free PackPTS`, `Start with 250 Free PackPTS`, or `we'll credit 250 PackPTS`. Quiet copy: create a free account, or play a round first. Play-vanity rows stay behind `HOME_PLAY_VANITY_MIN_GAMES`. Welcome credit on `POST /api/auth/register` stays. Gate plaque, signup-modal quiet path, `OnboardingModal` quiet path, and `/invite` referral rewards are unchanged. Guard: `client/src/lib/__tests__/homePlayVanity.test.ts`.
- [x] Daily 5 card-1 hang “Finding a replacement card…” (2026-09-16): `GameCard.isPlaceholderImage` dominant-color >50% rejected a live HTTP 200 Topps Chrome JPEG; Daily 5 has no replace path so the overlay never clears. Fix: honest overlay when no replace/skip/`onImageError`; Daily 5 `allowClientImageReject={false}`; tighter silhouette test (low unique colors AND near-flat histogram); `key={cardId}` + `setKey`; score-card / solo subtitle branding follows `mode === "daily5"` not `total === 5`; solo share footer is `packpts.com`; skip is painted (dealt pips + `1 skipped`) instead of a silent `10−1=9` pip row. Solo replace stamps `imageFailure` on the failed card index and looks up sport via `gameSetId`. Audit: `docs/audits/DAILY5_STUCK_REPLACEMENT_2026-09-16.md`. Do not wire Daily 5 into solo `replace-card`. Design target: Dave’s `/game/solo` Game Complete screenshot (1994 Topps Football, 1050 / 67% / 6 of 9, 1 card skipped, SOLO 6/9 share card).
- [x] Unmasked image gate (2026-09-24, tightened 2026-09-25): guessing payloads and masked URLs no longer carry the raw card id, card number, team, or year+set. `GET /api/images/card/:id` is 403 unless the caller is an admin or that same user / HttpOnly anon cookie has an accepted answer for that card (solo `game_sessions`, Daily 5 entry or anon run, 1v1 `match_answers`). Another player's answer does not unlock it. `x-packpts-fp` does not. `/api/play/r/...` still requires a valid reveal token for that session's accepted answer. Unmasked responses are `private, no-store` plus `CDN-Cache-Control: no-store`, `Surrogate-Control: no-store`, and `Vary: Cookie`, with no `X-Card-Id`. 1v1 `question_replaced` does not send `correctAnswer` or the card id. Image-error overlay hides card number and team until the card is revealed. `GET /api/daily5/status` omits the deal `seed` (it selects today's five). Set-catalog pages still list named cards; they are not the in-play question payload. Masked `/api/play/m/` stays publicly cacheable (`max-age=86400`, ETag v4.4).
- [x] Solo replacement stuck on “Image Failed to Load” (2026-09-25, after #116): a landscape scan (aspect > 1.3) still calls replace-card, and the server rewrite was fine (new index token, 200 JPEG). The solo GameCard key had become `session-index-revealed|masked` and no longer changed when the masked URL changed, so `imageError` stayed true over the replacement. Key is now the opaque masked URL (`gameCardMountKey`); reveal does not remount. GameCard resets image state when `imageUrl` changes. Daily 5 and 1v1 use the same key shape (1v1 still adds seed version and retry count). Automatic bad-image reports no longer need `cardId`: `POST /api/play/report` takes scope, session, and question index (optional mask token). The server resolves the card, including a solo `replacedFromIds` match, and the response does not include the card id. Daily 5 still has no replace path and `allowClientImageReject={false}`.
- [x] Post-submit full-card reveal (Dave, 2026-09-16): after a successful answer submit the overlay drops **and** `img src` swaps to the ACK reveal URL (`/api/play/r/...`); guessing stays the masked bake + overlay. Solo `setIsRevealed(true)` is ACK-only. 1v1 replace uses `maskedCardImageUrl`. WS passes `gameSetId`. Helper `shared/playCardImage.ts`. Audit: `docs/audits/MASK_REVEAL_AFTER_SUBMIT_2026-09-16.md`. Do not regress #85 / #86 / #87. **2026-09-24:** Reveal stays in the in-flow card slot. No dialog, no zoom. Revealed choices use `disabled:opacity-100`.
- [x] Static “Worth 175 pts” (Dave, 2026-09-24): solo badge removed. Playable-set `pointValue` is `computeReward` with no year/rarity; default fame 0.5 → 175 on the default policy, and auth credit is `awardDailyBaseForCorrectCard` (set bonus + daily cap), not the badge. 1v1’s `{pointValue} pts` badge removed for the same reason (`popularity: 50` → constant 300). Daily 5 has no per-card worth label. Post-ACK `+points` under the answers was removed 2026-09-25. Game Complete still shows the session total. 1v1 in-play standing is correct-answer counts (`You N` / `Opp N`). Match-end point totals stay.
- [x] Per-question score block removed (Dave, 2026-09-25, 1987 Topps Eddie Murray): solo `PointsQuiet` (`+N pts`, `Player:` tier, `Base:`) is deleted, not hidden. Solo `badge-score` and Daily 5 `text-d5-score` running totals are gone during play. Next Question sits under the answers (`pt-2` only, no min-height slot). Game Complete `text-final-score` / `text-d5-final-score` stay. 1v1 `text-my-score` / `text-opponent-score` show correct-answer counts (`You N` / `Opp N` from `correctAnswers`). Match-end point totals stay. `battle-series-tally` stays series wins. No earnings toasts. Mask/reveal, mount keys, replace/retry, and report are unchanged.
- [x] 1v1 in-match standing is correct counts (Dave, 2026-09-25): during the match, `text-my-score` / `text-opponent-score` read `You N` / `Opp N` from `participant.correctAnswers` (incremented only when the answer is correct). Same header position and `text-lg font-bold font-mono`. No `pts`. `battle-series-tally` stays series wins. Match-end `text-my-final-score` / `text-opponent-final-score` stay point totals. `participant_answered` includes `correctAnswers` so the count is not taken from `score`.
- [x] MaskPlaque seam + share thumbs (Design QA #119, 2026-09-25): a selected answer, before submit, paints the plaque seam with `--plaque-seam-armed` (`#F5C518`) in addition to the blue selected answer. Deselect and submit drop back to `--plaque-seam`. Reveal still crossfades the plaque off and leaves correct/wrong on the answers. The Game Complete share PNG composites the session's masked `/api/play/m/` thumbs (plaque look, session order) in `ShareAssetCard` for solo and Daily 5. A load failure or a tainted canvas omits that tile. Never `/api/images/card` or `/api/play/r/`. Mode label, date, scored denominator, and footer stay on the server PNG (`packpts.com/daily` only for Daily 5; solo and 1v1 stay `packpts.com`). 1v1 match end still shares text to `https://packpts.com` and does not mount the score PNG.
- [x] Share-strip glow (2026-09-25): the client thumb band is the same `#0b0f16` canvas and top-right radial glow as `buildScoreCardSvg` (`#1e3a5f` at 55% opacity, center 85%/12%, radius 55%). No flat dark rectangle. Masked `/api/play/m/` only. Solo footer stays `packpts.com`; Daily 5 stays `packpts.com/daily`.
- [x] Game Complete tiles + share thumb size (2026-09-25): at 390px, `4 of 5` in `text-3xl font-mono` wrapped to three lines and the Score tile was taller than PTS and Accuracy. Solo and Daily 5 / Beat-me now render `{correct}/{scored}` (`4/5`) with `whitespace-nowrap`, and the three tiles use `items-stretch` + `h-full` (no fixed height, no `overflow-hidden`). Share strip: one thumb per scored question. Solo passes `answered` questions only, so a wrong answer is included, a skip is not, and a replacement is that question's current masked URL. Daily 5 passes every dealt card. Thumbs are 64×90 at 1080. Ten and twelve solo cards stay one 64×90 row (gap tightens to 8px before width changes). Fifteen is one 56×79 row, same ratio. Twenty is two 64×90 rows. The thumb strip, score, pts line, pips, and tagline are centered between the SOLO/date row and the footer (`shared/scoreCardStack.ts`), with at least 36px between the strip and the score digits on 5, 10, 15, and 20-card cards. The glow restore band moves with the strip and stops above the score. A 5-card strip was 4 thumbs because `tilesForScoreShare` dropped a null/`Image()` failure (cold 503 or a non-bitmap body). Valid `/api/play/m/d5/{uuid}/{1-5}/{base64url}?v=v4.4` URLs already passed the filter. The loader fetches the JPEG as a blob and retries once. Glow restore is unchanged. `schema.ts` unchanged.
- [x] Game Complete label width (2026-09-25): ACCURACY at 12px with wider tracking is 72px and overflowed the solo content box at 390px (57px) and the Daily 5 content box at 360px (69px). The label now follows the tile content width on solo and Daily 5, from 320px to 430px. Under 76px the label is 10px with normal tracking. At 76px and wider it stays 12px with wider tracking. Horizontal padding is `clamp(0px, (100% - 60px) / 2, 16px)` so `12500`, `20/20`, `100%`, and ACCURACY satisfy scroll width at most the client width. One line, no ellipsis, tiles stay equal height.
- [x] PSA-slab top-label leak (Design QA 2026-09-16): v4.0 bake masked the inner 1987 Topps plaque but left **ROGER CLEMENS** on the PSA cert label. v4.1 added a detector + `?v=v4.1` but the Clemens live JPEG stayed plaque-only; `?v=v4.1` and `?v=v4.0` were byte-identical because `GET /api/cards/:id/masked-image` ignores `?v=` (one file). v4.2: center-column + holder-frame slab detect, GEM/MINT OCR tokens, Clemens-class fixture, bake `?v=v4.2`. Fleer top-name raw cards stay top-only. Rebuild: `POST /api/admin/masks/rebuild` `{ "all": true }` — `docs/MASK_CACHE_REBUILD.md`.
- [x] Identity-text still readable through v4.2 fill (Design re-QA 2026-09-21, post cache rebuild): geometry on Clemens `c6e890d5-015d-4e33-868a-77a69ca320ef` and 1989 Fleer top plates was correct, but `applyPercentRegions` used alpha 0.94 plus blur on the overlay rect. Sharp letters stayed visible. v4.3 bakes an opaque RGB fill (no alpha, no overlay blur) at `?v=v4.3`. Photo stays outside the name region. Eng runs `POST /api/admin/masks/rebuild` `{ "all": true }` after merge.
- [x] 1987 Topps Football bottom-mask leak (Design 2026-09-21, Hanford Dixon): the set matched `1987 topps` and painted the baseball bottom 46% while the name sits in the top plate. v4.4 registers `91cfdf3f-a620-4e73-adc8-22b8df221716` as `TOP_PLATE` (top 24%, opaque). Sport is part of the key. Pre-serve assert refuses a bake whose name band is not opaque or whose matched name token sits outside the mask (422 `mask_name_uncovered`, card quarantined). 1994 Topps Football (`a09b2fe7-728e-431b-9df8-bbf2652aa3b2`) audited as Finest bottom-bar, locked to a 28% bottom plaque. Eng rebuilds those two set ids after merge. QA URLs: `docs/MASK_CACHE_REBUILD.md`.
- [x] Between-card lag (Dave, 2026-09-19): next masked JPEG waited for submit ACK + first GET (often a cold bake). Client now prefetches remaining masked `/api/play/m/` URLs when the deal is known; 1v1 sends `upcomingMaskedUrls`. Server `kickPreMask` on solo/Daily 5/1v1 start. Warm masked JPEG is a disk peek (`X-Mask-Cache`). Solo Next shows the next card shell immediately. Reveal URL stays post-submit only. Do not regress #85 / #86 / #87 / v4.2 geometry / social SoR.
- [ ] Wager match settlement is still in progress (confirmed not complete)
- [ ] Adaptive difficulty (personalized card selection) not implemented
- [ ] Tournament mode not implemented (UI shows "coming soon")

### Security & Fraud
- [ ] No automated risk scoring engine (event logging exists, scoring/auto-action does not)
- [x] Chargeback → wallet freeze + REVERSAL ledger entry wired (Prompt 13): `charge.dispute.created` → `handleChargeDispute()` now calls `walletService.reversal()` after freezing user, mirrors `handleChargeRefunded` pattern
- [x] Hold period on PURCHASED bucket points (Prompt 14): `packpts_bucket.redeemable_at` column + `packpts_expiration_policy.purchased_hold_days` config; `getUserOpenBuckets()` and `getUserOpenBucketsFIFO()` filter out buckets in hold; migration applied to prod
- [x] Full attribution loop instrumented (Prompt 15): card_views table + POST /api/attribution/card-view; attributed_purchases table + GET /api/webhooks/epn-postback resolves EPN customId → outbound_click → user; migration applied to prod
- [x] Admin retention cohort dashboard (Prompt 16 / P0 2026-09-08): `GET /api/admin/retention` (admin session only) returns weekly first-active D1/D7/D30 + Maker Rate (`fetchMakerRateMetrics`). Cohort = first `event_log` day (America/Chicago ISO week), not signup; D_N = activity on first-active CT date + N; staff (`is_admin`) excluded like Maker Rate, bots excluded; pending windows are null until Sunday+N has passed. Surfaced on `/admin/metrics`. Never on `/api/home-stats` or marketing. Replaced the old `users.created_at` + `user_presence.last_seen_at` “still around after N days” query. Definition + fixture tests: `server/services/retentionCohorts.ts`.
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

### Social / Growth
- [x] Social Media Agent FOMO / hashtag-dump SoR violation (2026-09-16): Railway agent (~7am CT) auto-posted “250 free PackPTS / Signup bonus” with dense hashtags. Kill: `SOCIAL_MEDIA_AGENT_ENABLED=false` in prod; code lock Daily 5-only generator + preflight reject. Organic SoR: https://x.com/PlayPackPTS/status/2100232354249728403. Manual Growth mark-posted Daily 5 is unchanged.

### Marketplace
- [x] Listing price validation against CardHedge market data (Prompt 23): POST /api/marketplace/validate-price takes cardhedgeCardId + claimedPriceCents, compares to raw (ungraded) CardHedge price from cache or API; rejects if ratio > 2.5x; redemptionQuoteRequestSchema accepts optional cardhedgeCardId, redemption quote endpoint validates and rejects inflated prices before quote creation
- [ ] Goldin integration appears to use curated/manual listings vs. live API
- [ ] Redemption admin review queue exists but no notification system for pending reviews

### Data Model
- [x] baseballCards table decision (Prompt 25): KEEP as intentional fallback. playableCards is authoritative; baseballCards provides player-name options pool when playableCards is empty (cold-start / between imports). Decision documented in server/tests/baseballCardsLegacy.test.ts (5 tests). Deprecation criteria: 1) playableCards always ≥50 rows in prod, 2) matchService.initialize() refactored, 3) imageValidation.ts branch removed, 4) storage.ts seeding removed.
- [ ] Card masking regions must be configured per card set — new sets without masks will leak player names

### Testing
- [x] Unit test suite exists (Vitest): 14 test files, 223+ tests total — masking (33 tests), reward engine pure (30 tests), reward engine DB integration (6 tests), wallet (23 tests, strengthened Prompt 11: ledger invariant, frozen account, FIFO bucket depletion, EXPIRE reconciliation), purchase fulfillment (27 tests), and more
- [x] FIFO bucket expiration job is scheduled via pgJobQueue (`packpts_expiration`) and runs daily at `EXPIRATION_RUN_HOUR_UTC` (default 6 UTC). The scheduled run defaults to `EXPIRATION_MODE=dry_run`. Boot `ensureExpirationPolicy()` inserts a default policy (earned 365, bonus 90, purchased never, adjustments never) when no enabled policy is effective, using an advisory lock. It does not backfill existing null `expires_at` buckets. Admin policy PUT upserts. Inactivity expiration still runs only via manual trigger / standalone script.
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
| Registered users (non-staff) | `GET /api/admin/dashboard` → `overview.registeredUsersNonStaff`. SQL: `COUNT(*)` from `users` where `is_admin = false` AND `is_bot = false` (`REGISTERED_USERS_NON_STAFF_SQL`). Marketing cites this field only. Never all-rows `users` COUNT, never staff/bots, never an invented number. |
| DAU / WAU / MAU | Admin DAU: distinct `event_log.user_id` that day (`adminService.getMetrics`) — **does not** join `users.is_admin` (staff play can inflate it). Maker Rate MAU: distinct `event_log` users in 30d, staff excluded. Do not use `user_presence` for published admin proof. |
| D1 / D7 / D30 Retention | Weekly first-active cohorts from `event_log` (`GET /api/admin/retention`, `/admin/metrics`). First CT day with an event_log row; return = event on first-active + N. Staff + bots excluded. Pending = null. |
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

**Product lock:** users NEVER create cards and NEVER publish UGC / PC sets. `/make` is catalog-match Snap-to-Set (reopened 2026-09-22): a photo identifies a card and deep-links to an integrated playable set that already exists. Public nav / home / `/sets` / set pages / profile still do not CTA to publish or “make a set.” `POST /api/sets/create` is closed (410, no insert) for staff and non-staff. Collab create/publish stay admin-only and are not linked from `/make`.

Shipped July 2026 across seven sequential PRs (see `MAKING_LAYER_PROMPTS.md` for the original specs). Originally let any user build a playable set from photos of their own cards. That public UGC path is now closed; Daily 5, Beat-me, and `/sets` play of existing sets remain.

### Schema

- `game_sets` gained: `created_by_user_id` (FK users, null for staff sets), `co_creator_user_id` (FK users, set by collab publish), `maker_note` (text, ≤140 chars enforced at API layer), `is_user_created` (boolean, indexed).
- New table `collaboration_sessions`: `host_user_id`, `guest_user_id` (null until joined), `status` (`waiting`/`active`/`published`/`abandoned`), `nominated_cards` + `approved_cards` (JSONB arrays), `set_name`, `maker_note`, `published_set_id` (FK game_sets), `created_at`.
- User-created `playable_cards` rows use `cardhedgeCardId: snap2set:<uuid>` (never a real Card Hedge id). They must carry `image_url` (uploaded card photo) and `category` (= set sport) or `getRandomCardsFromSet` in `server/storage.ts` filters them out of gameplay.
- New table `card_photos`: `data` (bytea, sharp-downscaled JPEG), `content_type`, `uploaded_by_user_id`, `created_at`.
- Migrations: `migrations/add_maker_fields_to_game_sets.sql`, `migrations/add_collab_sessions.sql`, `migrations/add_card_photos.sql`, `migrations/add_maker_share_asset_type.sql`. **The production database is Railway Postgres** (see CLAUDE.md) — its schema is synced automatically at every deploy by `start.sh` running `drizzle-kit push --force`, so these SQL files are reference artifacts; the Supabase project holds a parallel copy the app never reads.

### Server routes

- `POST /api/make/identify` (auth, not admin, 20/hr/user via `cardIdentifyLimiter`) — OpenAI gpt-4o vision via `server/services/snapToSet.ts`, then `matchIdentifiedCardReadOnly`. Returns `{ catalogCardId, candidates, card, match: { status: matched|ambiguous|none, sets: [{ id, slug, name, cardCount, tease }] } }`. **Does not insert** playable cards, game sets, or card photos.
- `GET /api/make/match?catalogCardId=` (auth) — read-only membership of that catalog card against active non-user-created sets.
- `POST /api/sets/identify-card` (auth + **admin**, same limiter) — vision only, no photo insert, no playable-card insert. The `/make` client does not call it.
- `GET /api/card-photos/:id` (public) — serves the stored photo with `Cache-Control: immutable` (1 year).
- `POST /api/sets/create` — **closed**. Returns `410` and `{ error }` from `USER_SET_PUBLISH_CLOSED` for every caller. No `game_sets` or `playable_cards` insert. Not gated on `is_admin`.
- `GET /api/sets` (public) — the `/sets` shelf of **integrated** sets: `is_active = true` AND `is_user_created = false`, at least 5 eligible cards, deduped by name/year/sport (keep the row with the most eligible cards). Ordered by `created_at` DESC after that filter. User-created sets are never listed (UGC publishing is closed). `cardCount` is the eligible deal count, the same predicate as `GET /api/playable-sets` and `getRandomCardsFromSet` (`server/services/playableSetEligibility.ts`): playable, `content_verified` null or true, https image, non-empty player, category matches the set sport, plus the deal exclusions (rejected review, known silhouette URLs, quarantined-unplayable). Each row keeps the previous shape: `cardCount`, `shareImageUrl` (Surface A `content_assets` lookup; stock fan `maker-set-1080.png` stripped), `coverCardUrls` (up to 8 `/api/sets/{setId}/covers/{slot}` URLs for cards that already have a v4.4 mask-ready sidecar; empty when none are baked so the client shows the cream placeholder with the same solid plaque bar and gold seam and no PTS label; no raw image URL, player name, or card id; the cover route does not bake), `makerUsername`, `playCount`, and `createdAt` as ISO UTC. `playCount` remains on the JSON; public `/sets` UI must not render it. Integrated rows do not render a maker, a date, or AUTHORED. If a solo start asks for more questions than that set has eligible cards, the session deals the eligible stack and sets `totalQuestions` to the dealt length. Zero dealable cards still returns `NO_CARDS_AVAILABLE`.
- `GET /api/sets/:id` (public) — set metadata, maker + co-creator usernames, `createdAt` (drizzle Date → ISO), eligible `cardCount` (same deal predicate as `GET /api/sets`, not a raw `is_playable` count), `shareImageUrl` when a runtime maker-share PNG exists (looked up for any set, not only `isUserCreated`; stock fan stripped), `previewCards: { imageUrl, year }[]` using the same masked cover URLs (set year only; no player, description, raw image URL, or card id), and `playedToday` for the session user (CT day; guests are `false`). Public authored date renders only for a user-created set with a maker username (`formatAuthoredDate` → `formatPackptsMonDay`, America/Chicago). Integrated sets omit `by Maker`, the date, and AUTHORED. `cardCount` uses `eligiblePlayableCardCountSql`; `playCount` stays the correlated `COUNT(*)::int` against `game_sessions` using the raw identifier `game_sets.id` (`server/routes/userSetCounts.ts`). Interpolating `${gameSets.id}` inside drizzle `sql` templates rebinds the column as a parameter and reports `0` even when the set has playable cards. No denormalized `sets.cardCount` column. Cover helpers: `server/routes/userSetPreview.ts`, `server/services/setCovers.ts`. List and detail handlers: `server/services/publicSets.ts`. `GET /api/sets/:setId/covers/:slot` streams the baked JPEG and does not bake.
- `GET /api/my-sets` (auth) — the user's sets with play counts (profile "My Sets" tab). `playCount` uses the same correlated SQL as `GET /api/sets/:id`. `cardCount` stays the `is_playable` count in `userSetCardCountSql` (this route is not the public shelf).
- `GET /api/sets/:setId/cards/:cardId/listings` (public) — top 3 cheapest marketplace listings for the card (player + year + brand query); always returns `{ listings: [] }` on failure, never errors.
- `POST /api/sets/:setId/cards/:cardId/log-click` — logs to `outbound_clicks` with `pagePath: 'set-reveal'` for commerce attribution.
- `server/routes/collab.ts` (mounted in routes.ts): `POST /api/collab/create` (**admin**), `GET /api/collab/:id`, `POST /api/collab/:id/join`, `/nominate`, `/approve` (can't approve own nomination), `/publish` (**admin** + host only, ≥5 approved cards; sets `coCreatorUserId`). Runtime maker-share PNG is Surface A (`/make` publish) only — collab may keep templates.
- Admin: `GET /api/admin/metrics/making-layer` — sets/day (30d), maker rate (creators ÷ MAU, staff excluded, admin-only), `publishedSetsNonStaff` + `makerSupplyGate` (lifetime count of `is_user_created` sets whose `created_by_user_id` is non-admin — diligence ≥10 gate, with `target`/`remaining`/`progress`), maker-supply funnel (`funnel.last7d` / `funnel.last30d`: event + unique-user counts, fail counts, top drop-off, `friction` MAKE_FRICTION KPIs), set play depth, top-10 sets with outbound click counts. Maker Rate and funnel volume are not public metrics.
- Making Layer funnel events (same `event_log` spine as Maker Rate MAU; staff excluded via `users.is_admin`): `make_started` (`POST /api/make/start` on `/make` mount), `identify_success` / `identify_fail` (`POST /api/sets/identify-card`), `name_started` (step 3 name/mixtape form via `POST /api/make/event`), `publish_success` / `publish_fail` (`POST /api/sets/create`), `share_generated` (maker-share PNG persist in `onSetPublished`), `share_opened` (Share sheet / Share CTA), `set_viewed` (`GET /api/sets/:id` for `is_user_created` sets). Design MAKE_FRICTION KPIs on the same admin payload (`funnel.*.friction`): identify fail rate, time-to-publish p50/p90, name/mixtape drop-off, share open rate. Admin-only. Implementation: `server/services/makingLayerEvents.ts` + `makingLayerMetrics.ts`.
- MAKE_FLOW capture (still locked): auth-before-upload; two CTAs only (Take photo / Choose from library); sequential identify; HEIC→JPEG ≤5MB; 20 identifies/hour. Empty `/make` CTAs stay clickable during auth hydration (intent queued). Failed identify: Couldn’t identify + Try again + Skip. Name, mixtape, and Publish set are not on this route.
- Admin: `GET /api/admin/retention` — weekly first-active D1/D7/D30 (event_log, CT day keys) plus the same Maker Rate payload from `fetchMakerRateMetrics`. Admin-only; unpublished on marketing / home-stats.

### Play count convention

`game_sessions` has no `set_id` column. Play counts are derived with the JSONB query `(questions->0->'card'->>'gameSetId') = <setId> AND status = 'completed'`. Any change to how questions embed `gameSetId` breaks every play-count surface (set page, my-sets, admin metrics, maker digest).

### WebSocket (collab realtime)

`server/websocket.ts`: `collabConnections` map, `collab:join`/`collab:leave` client messages, `broadcastToCollab(collabId, message)` export used by the REST routes to push `collab:guest_joined`, `collab:card_nominated`, `collab:card_approved`, `collab:published`.

### Client pages

- `/make` — catalog-match Snap-to-Set, open to guests and non-staff (`canAccessMake` is true; auth is required before the file picker). Entry: Snap a card. Find its set. Results: Match found / A few possible sets / No set match yet. Primary play control goes to `/sets/{slug}` only. No-match primary is Browse sets (`/sets`). Staff QA `?qaIdentifyFail=1` / `?qa=identify-fail` still seeds one Failed slot. No public nav or home tile. Contracts: `docs/design/EMPTY_STATE.md`, `docs/design/IDENTIFY_RETRY.md`, Design catalog-match SoR. Funnel: `event_log` via `/api/make/event` for start; identify success/fail from `POST /api/make/identify`.
- `/sets` — play shelf for integrated sets already in PackPTS (`docs/SETS_POLISH.md`): eyebrow SETS, H1 “Sets”, sub “Play sets already in PackPTS.”, honest `{n} sets` from that list, Surface A cover crop or a fanned stack of baked masked cover URLs whose plaque is a solid bar with the gold seam and no label text. An empty cover keeps the cream card and that same bar and seam, with no PTS label and no photo URL. Integrated meta is `{n} cards` only (no `by Maker`, no date, no AUTHORED), blue **Play this set**, no short-shelf banner, empty state only at zero sets, Play Daily 5 (no Make a set). A stored brand missing from the set name is inserted into the heading (`2024 Basketball` + Topps → `2024 Topps Basketball`). No search chrome, no play counts, no Maker Rate, no playable-card vanity total. Also in mobile nav ("Browse") and home game-modes grid.
- `/sets/:id` — public set page: provenance, mixtape, honest card count + Play, optional “Play today’s stack” if not played today (CT), Surface A / runtime cover, THE STACK (masked, no player names), Share / Copy link / `packpts.com/sets/{slug}`. Share and copy use `playSetsShareUrl` (`utm_source=share&utm_medium=play_sets&utm_campaign=integrated`). HTML OG on `/sets` and `/sets/{slug}` prefers that runtime cover. No Times Played tiles, currency chrome, or “Make another set” / `/make` CTA. Maker / co-creator get a quiet Save cover link for the Surface A PNG.
- `/collab/:id` — host/guest co-creation with live updates.
- Profile "My Sets" tab lists already-published sets only (no Make a Set / Make Another CTA). In-game maker note shown above the question for user-created sets; post-reveal "Find this card" listing tiles (correct answer + user-created set only).

### Maker digest email

One email per set per day (in-memory dedup `Set` keyed `${setId}:${date}` in routes.ts — resets on deploy), sent via `sendMakerDigestEmail` after a completed session on a user-created set.

### Maker share (I MADE THIS SET)

After a user publishes via Snap-to-Set (`POST /api/sets/create` only), `onSetPublished` writes a 1080×1080 PNG (`content_assets.asset_type = MAKER_SHARE_CARD`, `source_event_id = maker_set_{setId}`). **v1 compose** (ship without Design polish): `I MADE THIS SET`, published set name + mixtape (Inter, DejaVu documented fallback), a **grid of 3–8** of **this set’s** identified cards (card-aspect or square crop, Daily 5 mask language + **black** name bar). Card inputs are whatever `/make` identify already stores (JPEG/WebP; HEIC normalized client-side). If a card’s mask/photo fails or the buffer is not jpeg/webp/png, that slot is a cream silhouette + black redaction — never the stock fan `maker-set-1080.png`. Footer: masked-P + PackPTS + `packpts.com/sets/{setSlug}`. Optional personal `N sets made` only after ≥10 non-staff published user sets; Maker Rate / volume brags stay gated. Swappable tokens: `server/contentFactory/makerShareAssets.ts`. Collab / badge templates are out of scope. Locked spec: `docs/MAKER_SHARE_CONTRACT.md`. Browse/detail presentation of that cover: `docs/SETS_POLISH.md`.

### Play-integrated set share kit

Marketing + in-product share for sets already on `/sets`. Surfaces: **A Play this set** · **B Integrated shelf** · **C Beat me from a set**. `beat_me` / `beat-me` / `beat_me_from_a_set` → C. CTA lock: `packpts.com/sets` or `packpts.com/sets/{slug}` only, with `utm_source=share&utm_medium=play_sets&utm_campaign=integrated`. `set` or `slug` resolves UUID or public slug (URLs cleaned) to the integrated set and prefers runtime cover. App/API kit PNGs: `/assets/play-sets/play-this-set.png`, `/assets/play-sets/integrated-shelf.png`, `/assets/play-sets/beat-me-from-a-set.png`. Same Design bytes also served as `play-set-1080.png`, `play-shelf-1080.png`, `play-beatme-1080.png`, `integrated-set.png`, `integrated-beatme.png`, `play-shelf.png`, `set-1080.png`, `beatme-1080.png`. Story crops: `play-set-story.png`, `play-shelf-story.png`, `play-beatme-story.png`. No `/make` publish CTA, no Maker Rate / public volume claims. Surface C does not mint a Daily 5-style challenge token. Contract: `docs/PLAY_SETS_SHARE.md`.

### Known gaps

- **Identify timeout (fixed 2026-09-08):** `/make` identify used the global `apiRequest` 15s abort while `identifyCardFromPhoto` calls gpt-4o `detail: "high"` with no server timeout — a silent/retry-loop blocker for non-staff publishes. Client identify now uses 45s; OpenAI client timeout is 40s; publish uses 30s.
- **Empty `/make` first pass (fixed 2026-09-08):** auth hydration disabled both CTAs and `requireAuthThen` returned without queueing the intent — empty page looked blocked. CTAs stay clickable; intent is queued until auth resolves.
- **Identify fail Retry (fixed 2026-09-08):** Retry re-sent the same file only. Failed cards now offer **New photo** (library replace) and show the error in destructive color + toast.
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
