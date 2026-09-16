# Daily 5 stuck on “Finding a replacement card…”

**Status (fix):** implemented 2026-09-16. Daily 5 never canvas-rejects (`allowClientImageReject={false}`), overlay copy is honest when there is no replace path, silhouette heuristic no longer treats dominant >50% alone as a fake, share/results branding follows `mode === "daily5"`, solo share footer is `packpts.com` (not `/daily`), and a skipped card is painted on the 1080 (dealt pips + `1 skipped`) instead of a silent `10−1=9` row. Solo replace stamps `imageFailure` on the failed card index + looks up sport via `gameSetId`. Daily 5 still must not call solo `replace-card`. No production card-row mutation. Design target: Dave’s `/game/solo` Game Complete screenshot (1994 Topps Football, 6 of 9 + 1 skipped).

**Incident date:** 2026-09-16 01:50 UTC (CT calendar day **2026-09-15**)  
**Reporter / user:** Dave Maloney (`Bigtimedee`)  
**Surface:** https://packpts.com/daily5  
**Severity:** Daily 5 card 1 is unplayable for every user who hits today’s puzzle, until they guess blindly or leave. The UI lies that a replacement is in progress. Solo *can* skip; Dave did that two minutes later in a **different** session — that is not Daily 5 completing.  
**This document:** read-only engineering audit. No production schema or card-row mutation was performed. Two live screenshots: Daily 5 hung overlay, then solo Game Complete.

Evidence classes used below:

| Label | Meaning |
|---|---|
| **CODE** | Proven by current `main` (commit `bdf91647`) |
| **PROD** | Proven by live Railway logs / HTTP against packpts.com on 2026-09-16 |
| **REPRO** | Reproduced from the live JPEG with the same math `GameCard` runs |
| **HUNCH** | Plausible, not proven for this incident |

---

## 0. What Dave saw vs what actually happened

Screenshot (amber/yellow card rectangle, spinner, copy **“Finding a replacement card…”**, four NBA names, `0 pts`, `1/5`, header `0/200 cards` + `5,350` pts) is **not a loading state** and **not a replacement loop**.

It is `GameCard`’s **hard image-error overlay**.

| UI element | What it actually is |
|---|---|
| Pale yellow rectangle | `bg-gradient-to-br from-amber-100 to-amber-200` error overlay (`GameCard.tsx`), **not** the card scan |
| Spinner + “Finding a replacement card…” | Default error branch when **neither** `showSkipButton` **nor** `showReplaceButton` is set |
| Four name buttons | Daily 5 `choices[]` from `POST /api/daily5/start` — independent of the image |
| `1/5` + yellow progress | Client is on position 1, unanswered |
| `0 pts` | Entry `score: 0`, `answers: []` |
| Header `0/200 cards` | Daily earning-cap badge, **not** inventory and **not** Daily 5 |

**PROD:** the image endpoint for card 1 returned **HTTP 200 JPEG in 1.45s**. The browser then **rejected the successfully loaded image** in `handleImageLoad` and froze on the error overlay. Daily 5 **never requested a replacement** (there is no Daily 5 replace API).

**Immediate workaround (ops):** Submit any answer on card 1 (blind). Positions 2–5 of today’s puzzle pass the same client heuristic and should render. This is unfair; it is not a fix.

**Second screenshot (same user, ~3 minutes later):** `https://packpts.com/game/solo` Game Complete — **1994 Topps Football**, `1050 PTS`, `67%`, `6 of 9`, copy **“1 card skipped”**, share card `SOLO / SEP 15` / `6/9` / `Six locked. Three open.` / footer `packpts.com/daily`. That is **not** Daily 5 finishing as nine cards. It is the default 10-card solo picker minus one skip (`10 − 1 = 9`). Math: `6/9 = 67%`. **PROD** session `ec205940…`, `mode: "solo"`, `totalQuestions: 10`, `skippedQuestions: 1`.

---

## 1. Production timeline (Dave’s session)

Railway project `marvelous-freedom`, service PackPoints-Game, deployment `e77d1ce7` (`main` @ `bdf91647`). CT day key `2026-09-15`. Challenge id `436bc826-8156-412b-a615-b9233352631e`. Set id `229f0379-aa56-40a8-abe3-1af217a397e8`. User id `0125683a-f641-4318-a6db-77e955a10d94`. Entry id `0c7e5d49-9b85-4c4c-a694-4ca19b87e67d`.

| UTC | Event | Result |
|---|---|---|
| 01:50:25 | `GET /api/daily5/status` | `ACTIVE`, `hasPlayed: false`, `entry: null` |
| 01:50:26 | `POST /api/daily5/start` | **200 / 104ms**. Entry created. Five cards returned. Position 1 choices are exactly the screenshot: Tristan da Silva, Adem Bona, Walker Kessler, Nicolas Batum. |
| 01:50:28 | `GET /api/cards/1356d9c8-1d34-4335-b6df-16fb97472fca/masked-image` | **200 / 1453ms**. `[MaskingService] Generated masked image … { ocrApplied: false, ocrMatches: [] }` |
| 01:50:28 → 01:51:25 | Status/leaderboard polls | Entry still `answers: []`, `score: 0`, `completedAt: null`. **No second image fetch. No `/report`. No `/replace-card`.** |
| 01:51:41 | HTTP: home + `/assets/game-*.js` | Dave left Daily 5. Daily 5 entry still open (`answers: []`). |
| 01:51:50 | `POST /api/game/start` | **New session** `ec205940-…`, `mode: "solo"`, `totalQuestions: 10`, `skippedQuestions: 0`. Same user id. Default picker is 10 cards (`game.tsx` `selectedCardCount = "10"`). |
| 01:51:57 → 01:53:08 | Eight solo answers | Mix of correct/wrong. Score to 875 / 5 correct. `skippedQuestions: 0`. |
| 01:53:02 | `POST /api/game/next` | Index 7. Image `3af91a8c-…` (Edgar Bennett Finest + seller banner) HTTP **200** in 1364ms. |
| 01:53:08 | `POST /api/game/answer` index 7 | Kevin Greene, correct. Submitted **after** that JPEG loaded. |
| 01:53:09 | `POST /api/game/next` then `POST …/replace-card` 404 | Next advances to **index 8**. Replace for `3af91a8c` 404s: `[CardReplacement] No replacement found for sport unknown`. Sets `imageFailure` on **current index 8**, not necessarily the failed card’s index. |
| 01:53:12 | `POST /api/game/next` `reason=image_failure` | **PROD:** `[Game Next] Question skipped due to verified image failure { questionIndex: 8, skippedQuestions: 1 }`. This is the UI line **“1 card skipped”**. |
| 01:53:15 | Answer index 9 | Jeff Hostetler, correct. `correctAnswers: 6`, `score: 1050` (`6 × 175`). |
| 01:53:17 | Finish `POST /api/game/next` | `status: completed`, `totalQuestions: 10`, `skippedQuestions: 1`. Score-card metadata `{ mode: "solo", correctCount: 6, totalQuestions: 9, streak: 1 }` — **9 = 10 − 1**. PNG `/generated/share/2026-09-15/2b0e2c4e-…png`. |

Public `GET /api/daily5/leaderboard` after both screenshots: `{ entries: [], date: "2026-09-15", totalEntries: "0" }`. Dave **still has not finished Daily 5**. The Game Complete screen is solo. **HUNCH:** he was the first Daily 5 starter of the CT day in the log window; every other user who opens today’s Daily 5 still hits the same card-1 overlay.

Position 1 payload from the start log:

```
position: 1
cardId: 1356d9c8-1d34-4335-b6df-16fb97472fca
imageUrl: /api/cards/1356d9c8-1d34-4335-b6df-16fb97472fca/masked-image
choices: ["Tristan da Silva", "Adem Bona", "Walker Kessler", "Nicolas Batum"]
pointValue: 100
```

Live fetch of that URL (audit machine, minutes later): `Content-Type: image/jpeg`, `705×1200`, 115 KB. It is a real **Topps Chrome Nicolas Batum autograph** scan (dark chrome border, jersey text `BATUM`, printed name at the bottom). Not a silhouette, not a 404, not an empty buffer.

---

## 2. End-to-end control flow

```
CT midnight
  └─ GET /api/daily5/status  →  Daily5Service.getStatus
        └─ getOrCreateTodayChallenge
              ├─ existing daily_challenges row for CT date? return it
              └─ else createChallengeForDate
                    ├─ pick the active gameSets row with highest cardsImportedCount
                    ├─ insert daily_challenges (seed = sha256(date:setId:SECRET_SALT))
                    └─ selectCardsForChallenge  →  insert 5 daily_challenge_cards

User clicks Start (or resume hydrates an open entry)
  └─ POST /api/daily5/start  →  Daily5Service.startChallenge
        ├─ insert daily_challenge_entries if missing (score 0, answers [])
        ├─ load daily_challenge_cards ordered by position
        └─ for each card, return:
              { position, cardId,
                imageUrl: "/api/cards/{cardId}/masked-image",   // opaque URL, not the CDN scan
                choices: per-user shuffle of stored choices,
                pointValue }

Client daily5.tsx
  ├─ setCards(data.cards)          // choices + URL are already enough to render the page
  ├─ applyResume(entry)            // lands on next unanswered position (here: 1)
  └─ <GameCard imageUrl={…} />     // NO onImageError, skip, replace, cardId, setKey

<img src="/api/cards/{id}/masked-image" crossOrigin="anonymous">
  └─ GET masked-image  →  getMaskedImagePath(cardId)
        ├─ cache hit on volume /app/data/masked-cards + card_image_mask_cache? stream JPEG
        └─ else download playableCards.imageUrl, Sharp+Tesseract mask, write JPEG, stream it

GameCard.handleImageLoad  (CLIENT_SIDE_IMAGE_VALIDATION defaults ON)
  ├─ too small (<50px)            → imageError
  ├─ landscape (w/h > 1.3)        → imageError
  ├─ isBlankImage (border samples)→ imageError
  └─ isPlaceholderImage
        ├─ quantized unique colors < 30  → imageError
        └─ dominant quantized color > 50% → imageError   ★ THIS INCIDENT
              └─ Daily 5: no onImageError handler, no skip/replace flags
                    └─ overlay: spinner + "Finding a replacement card..."  FOREVER
```

Files:

| Stage | File | Symbol |
|---|---|---|
| Day window / create | `server/services/daily5Service.ts` | `getOrCreateTodayChallenge`, `createChallengeForDate`, `selectCardsForChallenge` |
| Session | `server/services/daily5Service.ts` | `startChallenge`, `submitAnswer`, `finishChallenge` |
| HTTP | `server/routes.ts` | `GET /api/daily5/status`, `POST /api/daily5/start`, `GET /api/cards/:cardId/masked-image` |
| Mask bake | `server/masking/maskingService.ts` | `getMaskedImagePath`, `generateMaskedImage`, `preMaskCards` (unused) |
| OCR/bands | `server/masking/maskCardImage.ts` | `maskCardImage` |
| Client page | `client/src/pages/daily5.tsx` | `Daily5Page`, `startMutation`, playing `GameCard` |
| Resume | `client/src/lib/daily5Resume.ts` | `resolveDaily5Resume` |
| Image widget | `client/src/components/GameCard.tsx` | `isPlaceholderImage`, `handleImageLoad`, error overlay |
| Solo replace (contrast) | `client/src/pages/game.tsx` | `handleCardImageError`, `replaceCardMutation` |
| 1v1 replace (contrast) | `client/src/pages/match.tsx` | retries + `showReplaceButton` |
| Daily cap badge | `client/src/components/daily-progress-badge.tsx` | `{cardsCompleted}/{cardsMax} cards` |

Daily 5 does **not** go through `POST /api/game/session/:id/replace-card` or match `question_replace_request`. Those exist only for solo / 1v1, where a different card is allowed.

---

## 3. Ranked root causes

### RC1 — Client placeholder detector rejects a real dark Chrome card (likelihood: **confirmed**)

**CODE + PROD + REPRO.**

`GameCard.isPlaceholderImage` downscales the loaded bitmap to 100×100, quantizes RGB to 32-level buckets, and returns `true` if any single bucket covers **> 50%** of pixels (`GameCard.tsx`, the `dominantPercent > 50` check). Comment in the same function claims “Real cards have <10% dominant color, silhouettes have >50%.” That comment is false for black-border Topps Chrome.

Reproduced from the live JPEG Dave’s browser received:

| Card | Size | Unique (q32 @ 100×100) | Dominant | Would `GameCard` reject? |
|---|---|---|---|---|
| **Pos 1 Batum Chrome** `1356d9c8…` | 705×1200 | 66 | **57.3%** | **YES** |
| Pos 2 `50e42eec…` | 705×1200 | 141 | 13.2% | no |
| Pos 3 `d970b77a…` | 705×1200 | 133 | 10.3% | no |
| Pos 4 `a9438161…` | 705×1200 | 139 | 11.3% | no |
| Pos 5 `288249b1…` | 705×1200 | 200 | 9.3% | no |

Aspect ratio 0.59 (portrait) — does **not** trip the `> 1.3` landscape reject. `isBlankImage` does **not** trip (corner pixel is `(24,27,34)`, not near-white/near-black enough). The only tripwire is dominant color.

**PROD confirmation it is client-side, not a 404:**

- Masked-image **200**.
- Daily 5 does not pass `cardId` into `GameCard`, so `autoReportPlaceholder()` no-ops. That is why there is **no** `POST /api/cards/1356d9c8…/report` in the log, unlike solo a minute later.
- No retry fetch. `imageError` sticks for the life of the component. Daily 5 also does not pass `key={cardId}`, so even a later URL change would not remount / reset state (`useState` initializer only).

`VITE_CLIENT_SIDE_IMAGE_VALIDATION` is compiled in by Vite at **build** time:

```ts
const CLIENT_SIDE_IMAGE_VALIDATION = import.meta.env.VITE_CLIENT_SIDE_IMAGE_VALIDATION !== 'false';
```

Absent env ⇒ **enabled**. Railway PackPoints-Game variables do **not** include this flag (nor `VITE_CDN_BASE_URL`). A comment three lines above `handleImageLoad` says the opposite (“Disabled by default in production … Enable with `=true`”). The comment is wrong; the expression is what ships.

### RC2 — Daily 5 uses the solo “replacement pending” empty state with no replacement path (likelihood: **confirmed**, why it hung)

**CODE.**

Playing view:

```tsx
<GameCard
  imageUrl={currentCard.imageUrl}
  isRevealed={isRevealed}
  imageRotation={0}
/>
```

No `onImageError`, `showSkipButton`, `showReplaceButton`, `onSkip`, `onReplace`, `cardId`, `sessionId`, `setKey`, or `setLabel`.

Error overlay (`GameCard.tsx`):

- `!showSkipButton && !showReplaceButton` → spinner + **“Finding a replacement card…”**
- Solo (`game.tsx`) passes `onImageError` → `replaceCardMutation` and, after timeout / failed replace, `showSkipButton`
- 1v1 (`match.tsx`) retries the URL twice, then `showReplaceButton`

Daily 5 fairness rule is “same five cards for everyone.” There is no Daily 5 replace endpoint, and there must not be one that swaps in a different card. The widget was copied from solo without the recovery wiring **and** without an honest Daily 5 empty state.

Once `imageError` is set, CSS name masks are also skipped (`!isRevealed && !imageError`). The user never sees the card, the overlay never times out, Submit still works underneath.

This is **not a loop**. One failed `onLoad` check → sticky overlay. Calling it a “replacement loop” in the ticket matches the copy, not the control flow.

**The second screenshot is what that same GameCard path looks like when recovery *is* wired.** Solo’s terminal state is `skippedQuestions += 1` and Game Complete “1 card skipped”. Daily 5 cannot reach that state. Dave did not skip Daily 5 card 1; he abandoned the mode. See §10.

### RC2b — Solo replace 404 (`sport unknown`) forces a skip (likelihood: **confirmed** for the Game Complete skip; not Daily 5)

**CODE + PROD.**

`POST /api/game/session/:id/replace-card` always sets `questions[currentQuestionIndex].imageFailure = true`, then looks up a replacement. `storage.getReplacementCardForSession` keys sport off `currentQuestion.card.setName` → `gameSets.setName`. If that lookup misses, `expectedSport` is null, the same-sport fallback **never runs**, log is `No replacement found for sport unknown`, HTTP **404**.

Client `replaceCardMutation.onError`: if the message contains `"No replacement card available"`, it sets `replacementAttempts` for that index to **2**, which is the skip threshold. Next click on the overlay button calls `nextQuestionMutation.mutate("image_failure")`.

Server `POST /api/game/next` with `reason === "image_failure"` increments `skippedQuestions` **only if** `currentQ.imageFailure` is already true (the 404 path stamps that flag). Log line Dave hit: `Question skipped due to verified image failure { questionIndex: 8, skippedQuestions: 1 }`.

**Race (PROD timestamps, same second):** `next` to index 8 at 01:53:09, then replace-card 404 for `3af91a8c` (the *previous* JPEG) also 01:53:09. Replace stamps `imageFailure` on **index 8**, then skip at 01:53:12 burns question 8. **HUNCH:** the skipped slot may not have been the bad JPEG; the flag is “current index”, not “failed card id”. Not proven without the session blob. Proven: skip requires that flag, and 404 wrote it.

Daily 5 never calls this endpoint. `sport unknown` cannot unstick `/daily5`.

### RC3 — Daily 5 card pick never proves the image is showable (likelihood: **confirmed contributing**)

**CODE.** `selectCardsForChallenge` filters:

- `isPlayable = true`
- `contentVerified` null or true
- `imageUrl` non-empty `https://`
- not the three known appforest silhouette URL LIKE patterns
- player name present
- `imageReviewStatus` is null or **not** `'rejected'`

It does **not** filter:

- `quarantineStatus` (`OK` / `SUSPECT_*` / `QUARANTINED_ADMIN_REVIEW`) — 1v1 `matchService` does
- `validationFailCount`
- `imageGate` / `imageValidation.ts` “URL actually fetches as an image”
- “client `isPlaceholderImage` would accept this bitmap”
- “masked JPEG exists on the volume”
- `preMaskCards()` — **defined, never called**

So a black Chrome auto that is a perfectly valid collectible is a legal Daily 5 pick, then gets executed by RC1+RC2 at first paint.

`createChallengeForDate` also picks **whichever active set has the most imported cards**, not a curated Daily 5 set. Today that produced modern basketball (the four NBA distractors).

If `filtered.length < 5`, the function **logs and returns without inserting cards**, but the `daily_challenges` row already exists. That is a different bug (would present as a full-page spinner, `gameState === "playing" && !currentCard`, **not** this screenshot). **Not this incident** — five cards were returned.

### RC4 — Mask bake is lazy, OCR missed, jersey name is in the clear (likelihood: **confirmed secondary**; not what froze the UI)

**PROD + CODE.** First GET of card 1 spent 1453ms generating the JPEG (`ocrApplied: false`). Volume path is `/app/data/masked-cards` (Railway volume `packpoints-game-volume`). Cache-Control on success is `public, max-age=2592000, immutable`.

A hung bake would show `GameCard`’s **dark** `bg-muted` loader (`!imageLoaded && !imageError`), not the amber overlay. Dave’s screenshot is amber ⇒ `imageError === true`. Lazy generation added latency; it did not strand the request.

Because OCR did not fire, the baked JPEG still has **“NICOLAS BATUM”** at the bottom and **“BATUM”** on the jersey. Daily 5 does not pass `setKey`, so `GameCard` uses `DEFAULT_MASK_REGIONS` (`yPct: 54, hPct: 46`) without fetching `/api/card-sets/:id/mask`. That bottom band would cover the printed name **if the image were shown**. The jersey `BATUM` sits above y=54% and would leak the answer.

**Do not “just show the image” as the Daily 5 fix without a masking pass.** Unstick ≠ safe.

### RC5 — Header `0/200 cards` (likelihood: **not causal**; red herring)

**CODE + PROD.** Header widget is `DailyProgressBadge`: `{cardsCompleted}/{cardsMax} cards` with default cap 200 (`use-daily-progress.ts`, `DAILY_CARD_CAP = 200` in `server/services/progress/dailyProgress.ts`).

That counter increments in `awardDailyBaseForCorrectCard` (`dailyGameplayBase.ts`) on **correct solo / 1v1 card awards**. Daily 5 `submitAnswer` / `finishChallenge` never call it (Daily 5 credits via `applyLedgerEntry` / `daily5_reward` at finish). So:

- `0/200` at the screenshot = Dave had **zero daily-base-counted correct cards** yet today. He then went to solo and started answering.
- Wallet `5,350` is lifetime/available PackPTS (`useWallet`), unrelated to the overlay.
- Hitting the 200 cap would not block Daily 5 start (start has no cap check).

### Other hypotheses checked and **rejected** for this incident

| Hypothesis | Why not |
|---|---|
| Empty playable pool / 0 cards in the challenge | Start returned 5 cards with choices |
| Masked-image 404/500 / dead CardHedge URL | HTTP 200 JPEG, 115 KB, visually a real scan |
| `VITE_CDN_BASE_URL` prefixing a relative URL onto a dead CDN | Variable not set in Railway; request path was `/api/cards/…/masked-image` |
| CORS `crossOrigin="anonymous"` firing `onError` | Same-origin 200; `onLoad` ran (otherwise canvas math never executes). Canvas `SecurityError` path in `isPlaceholderImage` **returns false** (would have *shown* the card) |
| `isPlaceholderUrl("/api/cards/…/masked-image")` | Patterns are `placeholder`, `silhouette`, `fallback`, etc. This path does not match. Initial `imageError` state would be false |
| Ownership / user inventory filter | Daily 5 reads `playableCards` + `daily_challenge_cards`, not user-owned cards |
| Resume desync (card 1 already answered) | Entry `answers: []`; UI `0 pts` `1/5`; that bug was fixed 2026-09-08 (`resolveDaily5Resume`) |
| Replacement pool empty looping | Daily 5 never calls replace. Solo later 404’d replace (`sport unknown`) and **skipped** — §10 |
| Solo Game Complete is Daily 5 with wrong flags | Separate session `mode: "solo"`, `totalQuestions: 10`. `/game/solo` ≠ `/daily5`. See §11 |
| Railway volume EACCES | Bake succeeded and file was served |
| `Daily5Preflight` Railway function failed | That function only dumps Twitter env for social posting; it does not preflight cards |

---

## 4. Why answer choices render without a card

**CODE, by contract.** `startChallenge` returns choices **inline** and the image as a **side-channel URL**:

```ts
imageUrl: `/api/cards/${c.cardId}/masked-image`,
choices: shuffledChoices,
```

`daily5.tsx` renders `currentCard.choices.map` in a sibling column. `GameCard` is only the image. There is no `if (imageLoaded)` gate on the buttons or Submit.

That is why the screenshot is possible: question metadata 200, image widget in `imageError`. The user *can* Submit blindly; the UI just tells them to wait for a replacement that will never arrive.

Correct answer is `card.correctAnswer` on the server only. Start payload does not include it. Choices are a 4-shuffle of `[correct, wrong, wrong, wrong]` stored at challenge creation. Seeing four NBA names does **not** mean the client knows which is correct.

---

## 5. API contracts (what each call guarantees)

### `GET /api/daily5/status` (auth optional)

Returns today’s challenge, `hasPlayed` (`completedAt` set), existing `entry` including `answers[]` (1-indexed positions), and window countdowns. **Does not return cards or image URLs.** Client with an open entry must still `POST /api/daily5/start` to load cards (`daily5.tsx` does this when `cards.length === 0`).

### `POST /api/daily5/start` (auth required)

Idempotent for an in-progress entry. Guarantees:

- `entry` row
- `cards[]` length should be 5 **if** `selectCardsForChallenge` inserted 5 rows
- each `imageUrl` is the masked-image route, not the upstream scan
- `choices` shuffled per `(challengeId, userId, position)`

Does **not** guarantee: JPEG exists, JPEG will pass client canvas checks, name is masked, upstream URL is live.

### `GET /api/cards/:cardId/masked-image`

On success: `image/jpeg`. On bake failure: **404 JSON** `{ error: "Unable to generate masked image" }` (would fire `img.onError`, same overlay, different trigger). No `Access-Control-Allow-Origin`. Same-origin is enough for Daily 5.

### `POST /api/daily5/answer`

Does not care whether the client displayed an image. Position uniqueness is the only card-progress invariant.

### Solo `POST /api/game/session/:id/replace-card`

**Not on the Daily 5 path.** Listed so nobody “fixes” Daily 5 by wiring it in — that would break “same five cards for everyone.”

---

## 6. What logs / metrics would prove each hypothesis next time

Instrument these; today we got lucky because Railway request logs print the start JSON body.

| Hypothesis | Prove with |
|---|---|
| Client canvas reject | Client counter `gamecard.image_reject{reason=placeholder_image\|blank_image\|too_small\|aspect\|on_error}` + `cardId` + `mode=daily5\|solo\|match`. Today: **infer** from 200 image + no `/report` (Daily 5 omits `cardId`) + sticky overlay |
| Mask bake 404 | Deploy log `[MaskingService] Failed to download` / `Card not found` + HTTP 404 on `/masked-image` |
| Bake timeout | `/masked-image` duration >> 5s, then 504/502, then overlay. Today: 1453ms 200 |
| Empty Daily 5 deck | `[Daily5] Not enough playable cards` + start `cards: []` + full-page spinner (not this overlay) |
| Quarantined pick | SQL: `playable_cards.quarantine_status` for the five `daily_challenge_cards.card_id`s |
| Dominant-color false positive | Offline: resize JPEG to 100×100, q32 histogram, max bucket / 10000 > 0.5. Done for this incident: **0.573** |
| User at daily cap | `GET /api/progress/daily` `cardsAnswered >= 200`. Today: 0, and cap is not consulted by Daily 5 start |
| All users stuck | Leaderboard `totalEntries` stays 0 while `/daily5/start` count > 0; or many in-progress entries with `answers=[]` and matching card 1 |
| Solo skip vs Daily 5 hang | Deploy: `[Game Next] Question skipped due to verified image failure`. Daily 5 never emits this. Session `mode` + `totalQuestions` + `skippedQuestions` on finish. |
| Replace `sport unknown` | `[CardReplacement] No replacement found for sport unknown` + 404 `/replace-card`. Prove `card.setName` empty/mismatch via the session question payload (not fetched this audit). |

Suggested one-line server log on masked-image 200: `{ cardId, bytes, ms, ocrApplied, cacheHit }`. Suggested client log (already `logger.debug` in `isPlaceholderImage`, likely stripped in prod): promote those to `warn` with `mode`.

Do **not** use Supabase SQL to “verify” this. Production is Railway Postgres.

---

## 7. Fix recommendations (smallest safe first)

Do **not** wire Daily 5 into solo `replace-card`. That violates the product rule that everyone shares the same five cards.

1. **Honest empty state when recovery is impossible (smallest UX, no heuristic change).** In `GameCard`, if `imageError && !showSkipButton && !showReplaceButton && !onImageError`, do not say “Finding a replacement card…”. Copy should be “Card image didn’t load. You can still answer.” Keep Submit. Unsticks the *wait*, not the *blind guess*. Matches the score-card empty-state doctrine in `docs/EMPTY_STATE.md` (don’t lie, don’t spin forever).

2. **One-line default matching the comment in `handleImageLoad`.** Change  
   `VITE_CLIENT_SIDE_IMAGE_VALIDATION !== 'false'`  
   to  
   `=== 'true'`.  
   Production does not set the flag, so canvas rejects stop. **This would have shown Dave the Batum card.** Also: jersey `BATUM` would likely be visible (RC4). Treat as a product tradeoff, not a free win. Rebuild required (Vite inlines it).

3. **Daily 5-specific: never canvas-reject when the card cannot be replaced.** Prop e.g. `allowClientImageReject={false}` from `daily5.tsx`. Solo/1v1 keep the detector if you still want it. Same spoiler caveat as (2) for this particular scan.

4. **Fix the heuristic if it stays on.** Dominant > 50% at 32-level quantization on a 100×100 letterbox of a black Chrome card is a real-card signature, not a silhouette. Silhouettes need a tighter test (known URL patterns already exist in `isKnownSilhouetteUrl`; low unique colors **and** near-flat histogram, not either-or with a 50% dominant cut). `isBlankImage` only samples **corners/edges** — white-border scans are a waiting false positive.

5. **Preflight the day’s five at challenge creation.** After `selectCardsForChallenge`, `preMaskCards(ids)`. Drop / reshuffle any id that returns null **or** whose JPEG fails a server-side histogram gate that matches whatever the client still runs. Fail challenge creation rather than ship a card the client will hide.

6. **Pass `setKey={challenge.setId}` (and a `key={cardId}`) into Daily 5 `GameCard`.** Enables per-set mask geometry and resets error state on navigation. Does not by itself unstick card 1.

7. **Do not pick Daily 5 from “largest imported active set” forever.** Curate, or at least exclude cards whose baked image is name-on-jersey / OCR-miss. That’s content ops, not a one-line patch.

8. **Solo replace `sport unknown` 404** (Dave’s skip). `getReplacementCardForSession` must use `gameSetId` from the question/card, not `setName` string match. Also stamp `imageFailure` on the **failed card’s index**, not whatever `currentQuestionIndex` is when the 404 returns (the 01:53:09 race). Daily 5 still must not call this API.

9. **Stop labeling solo results as Daily 5, and stop printing `packpts.com/daily` on every score card.** `game.tsx` uses `effectiveTotal === 5 ? "DAILY 5"` (Dave’s 9 avoided it). `buildScoreCardSvg` uses `treatAsDaily5 = mode === "daily5" || total === 5` and hardcodes the Daily 5 footer. Contract `docs/SCORE_CARD_CONTRACT.md` is Daily 5–specific; solo reuse is a branding leak, not a playable-card fix.

**What not to do:** delete today’s `daily_challenge_cards` out from under in-progress entries; run `drizzle-kit push` for this; “verify” in Supabase; add a third-party image CDN; treat the 6-of-9 Game Complete as Daily 5 recovery.

---

## 8. What this audit did not see

- The `playable_cards` row for `1356d9c8…` (quarantine, review status, raw `imageUrl`). Sandbox has no TCP to Railway Postgres. Not required: the JPEG that row produced is a real Batum Chrome.
- The solo session’s full `questions[]` blob (which card sat at index 8 when skipped). Logs show replace targeted `3af91a8c` while skip was `questionIndex: 8` after a `next` to 8.
- Dave’s browser console (`[PlaceholderDetect] High dominant color: 57.3%` would be definitive if `logger.debug` survived the prod bundle).
- Whether Safari vs Chrome canvas resize would move 57.3% across the 50% line. Margin is 7 points; **HUNCH:** all Chromium users reject. Unproven for WebKit.

---

## 9. What “1 card skipped” means (client + server)

**CODE.** Skip is a **solo/session** concept. Daily 5 has no `skippedQuestions` field on `daily_challenge_entries`.

| Step | Where | What happens |
|---|---|---|
| Image fails (onError or canvas reject) | `GameCard` → `onImageError` | Solo: `handleCardImageError`. Daily 5: **undefined**, overlay lies. |
| Auto-replace | `POST /api/game/session/:id/replace-card` | Always `questions[currentQuestionIndex].imageFailure = true`. Then find another card. 404 if none. |
| Client skip threshold | `game.tsx` `replaceCardMutation.onError` | Message contains `"No replacement card available"` → `replacementAttempts.set(idx, 2)`. Overlay button mode becomes `'skip'`. |
| User clicks skip | `handleManualSkip` | `nextQuestionMutation.mutate("image_failure")` → `POST /api/game/next { reason: "image_failure" }` |
| Server accepts skip | `routes.ts` `/api/game/next` | If `reason === "image_failure"` **and** `currentQ.imageFailure`, then `skippedQuestions += 1`. If the flag is missing, it **warns and ignores** the skip (`Ignoring unverified image_failure skip attempt`). |
| Results copy | `game.tsx` Game Complete | `{n} card(s) skipped` when `skippedQuestions > 0`. |
| Score math | client + finish path | `effectiveTotal = totalQuestions - skippedQuestions`. Accuracy and “X of Y” use **effectiveTotal**. Share card is passed `totalQuestions: effectiveTotal`. |

Dave’s numbers are the identity `10 − 1 = 9`, `6/9 = 67%`, headline `Six locked. Three open.` (`buildScoreCardHeadline(6, 9)`). **PROD** finish metadata: `correctCount: 6, totalQuestions: 9, skippedQuestions: 1, mode: "solo"`.

**Is this the terminal outcome of the hung Daily 5 overlay?** Same *widget* (`GameCard` imageError), **different product path**:

- Daily 5: no `onImageError` → overlay never becomes a skip button → **stuck**. Session `0c7e5d49…` still `answers: []`.
- Solo: `onImageError` → replace → 404 → skip button → `skippedQuestions=1` → Game Complete.

Dave’s second screenshot is **escape to `/game/solo`**, not Daily 5 converting a hang into a skip. Leaderboard `totalEntries: 0` proves Daily 5 never finished.

---

## 10. Why the completed game is 9 cards, not Daily 5 of 5

**CODE + PROD. Not a shared engine with wrong mode flags.**

| | Daily 5 (screenshot 1) | Solo (screenshot 2) |
|---|---|---|
| URL | `/daily5` | `/game/solo` (`App.tsx` `Route path="/game/:mode"`) |
| Page | `client/src/pages/daily5.tsx` | `client/src/pages/game.tsx` |
| Start API | `POST /api/daily5/start` | `POST /api/game/start` `{ mode: "solo", totalQuestions: 10, setId }` |
| Session | `daily_challenge_entries` `0c7e5d49…` | `game_sessions` `ec205940…` |
| Length | Always 5 | Picker 5/10/15/20; **default `"10"`** |
| Set | Largest active imported set (today: NBA names) | User-picked **1994 Topps Football** |
| Skip | Impossible | `skippedQuestions` |
| Finish | `POST /api/daily5/finish` | last `POST /api/game/next` sets `status: "completed"` |

Nine is `effectiveTotal`: 10 dealt, 1 skipped, 9 counted. Home “Play” links to `/game/solo`, not `/daily5`. No fallback that starts solo because Daily 5 failed — Dave navigated (HTTP at 01:51:41: `/` then `game-*.js`).

---

## 11. Daily 5 / solo / share-card branding divergence

Three different “daily” concepts share chrome.

**Routes (CODE):** `/daily` and `/daily5` are the **same** lazy page (`App.tsx`). `/game/solo` is the generic solo engine. Footer `packpts.com/daily` therefore opens Daily 5, even from a football solo.

**Game Complete subtitle (CODE, `game.tsx`):** `{effectiveTotal === 5 ? "DAILY 5" : "Here's how well you know your {set} cards"}`. A **solo 5-card** game would be titled Daily 5. Dave’s 9 missed that lie; the 1994 Topps line is the else branch. Daily 5’s own complete screen always says `DAILY 5` (`daily5.tsx`).

**Share PNG (CODE, `generateScoreCard.ts`):**

- Eyebrow: `treatAsDaily5 = mode === "daily5" || total === 5` then `"DAILY 5"`, else `"SOLO"` / `"1V1 MATCH"`. Dave: `mode: "solo"` and `total: 9` → **SOLO**. A solo 5 would print **DAILY 5** on the PNG.
- Date: `formatSessionDayIdentity(date, isDaily5Mode)` with `isDaily5Mode = mode === "daily5"` only → `SEP 15` without `· TODAY'S FIVE`. Matches the screenshot.
- Pips: `buildPipsSvg(6, 9)` → 6 filled + 3 open. Contract text in `docs/SCORE_CARD_CONTRACT.md` still says “Five rounded-square pips” because that spec is Daily 5; the generator allows 1–12.
- Footer is **hardcoded** `packpts.com/daily` for every mode. `ShareAssetCard` default `shareUrl` is `https://packpts.com/daily`. Solo Game Complete passes that explicitly. Design contract calls the footer “visual only” for Beat-me; it is still the wrong CTA for a 1994 football solo.

**Not causal** to the missing card. It is why the second screenshot *looks* like Daily 5 product (footer, pip language “locked/open”) while the URL bar is `/game/solo`.

---

## 12. Bottom line for Dave

Daily 5: the server found a card, baked a JPEG, and handed the four names to the page. The page ran a “is this a silhouette?” check that treats a black Chrome border as a fake image, hid the JPEG behind a yellow panel, and printed a sentence from solo mode (“Finding a replacement card…”) even though Daily 5 has no replacement machinery. Header `0/200` is the daily earning-cap toy. It did not cause this. Cards 2–5 of 2026-09-15 would have displayed. Card 1 is a landmine for the whole day because Daily 5 is shared. That session is **still open**.

Solo, two minutes later: same `GameCard` failure detector, but `onImageError` is wired. Replace 404’d (`sport unknown`), the server marked `imageFailure`, you skipped one of a **10-card 1994 Topps Football** game, and Game Complete counted `6 of 9`. The share card says SOLO and still points friends at `packpts.com/daily` (the Daily 5 alias). That skip is the recovery Daily 5 does not have. It is not Daily 5 finishing.

---

*Audit by Cursor Grok 4.6, 2026-09-16. Code: `main` @ `bdf91647`. Live: packpts.com + Railway deploy `e77d1ce7`.*
