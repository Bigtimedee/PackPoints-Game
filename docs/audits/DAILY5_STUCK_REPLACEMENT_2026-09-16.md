# Daily 5 stuck on “Finding a replacement card…”

**Incident date:** 2026-09-16 01:50 UTC (CT calendar day **2026-09-15**)  
**Reporter / user:** Dave Maloney (`Bigtimedee`)  
**Surface:** https://packpts.com/daily5  
**Severity:** Daily 5 card 1 is unplayable for every user who hits today’s puzzle, until they guess blindly or leave. The UI lies that a replacement is in progress.  
**This document:** read-only engineering audit. No production schema or card-row mutation was performed.

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

---

## 1. Production timeline (Dave’s session)

Railway project `marvelous-freedom`, service PackPoints-Game, deployment `e77d1ce7` (`main` @ `bdf91647`). CT day key `2026-09-15`. Challenge id `436bc826-8156-412b-a615-b9233352631e`. Set id `229f0379-aa56-40a8-abe3-1af217a397e8`. User id `0125683a-f641-4318-a6db-77e955a10d94`. Entry id `0c7e5d49-9b85-4c4c-a694-4ca19b87e67d`.

| UTC | Event | Result |
|---|---|---|
| 01:50:25 | `GET /api/daily5/status` | `ACTIVE`, `hasPlayed: false`, `entry: null` |
| 01:50:26 | `POST /api/daily5/start` | **200 / 104ms**. Entry created. Five cards returned. Position 1 choices are exactly the screenshot: Tristan da Silva, Adem Bona, Walker Kessler, Nicolas Batum. |
| 01:50:28 | `GET /api/cards/1356d9c8-1d34-4335-b6df-16fb97472fca/masked-image` | **200 / 1453ms**. `[MaskingService] Generated masked image … { ocrApplied: false, ocrMatches: [] }` |
| 01:50:28 → 01:51:25 | Status/leaderboard polls | Entry still `answers: []`, `score: 0`, `completedAt: null`. **No second image fetch. No `/report`. No `/replace-card`.** |
| 01:51:41 | Navigation to solo `/game` | Dave left Daily 5 stuck |
| 01:53:09 | Solo `POST …/replace-card` | 404 `No replacement found for sport unknown` — different mode, useful contrast |

Public `GET /api/daily5/leaderboard` at audit time: `{ entries: [], date: "2026-09-15", totalEntries: "0" }`. Dave never finished. No one else had a completed entry either. **HUNCH:** Dave was the first (and only) starter of this CT day in the log window; every other user who opens today’s Daily 5 will hit the same card-1 overlay.

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
| Replacement pool empty looping | Daily 5 never calls replace. Solo later *did* 404 replace (`sport unknown`) — separate bug |
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

8. **Solo replace `sport unknown` 404** (Dave hit this two minutes later) is a separate bug: `getReplacementCardForSession` keys off `currentQuestion.card.setName` → `gameSets.setName`. If `setName` is missing, `expectedSport` is null and the same-sport fallback never runs. Not in the Daily 5 path; fix later.

**What not to do:** delete today’s `daily_challenge_cards` out from under in-progress entries; run `drizzle-kit push` for this; “verify” in Supabase; add a third-party image CDN.

---

## 8. What this audit did not see

- The `playable_cards` row for `1356d9c8…` (quarantine, review status, raw `imageUrl`). Sandbox has no TCP to Railway Postgres. Not required: the JPEG that row produced is a real Batum Chrome.
- Dave’s browser console (`[PlaceholderDetect] High dominant color: 57.3%` would be definitive if `logger.debug` survived the prod bundle).
- Whether Safari vs Chrome canvas resize would move 57.3% across the 50% line. Margin is 7 points; **HUNCH:** all Chromium users reject. Unproven for WebKit.

---

## 9. Bottom line for Dave

The server found a card, baked a JPEG, and handed the four names to the page. The page then ran a “is this a silhouette?” check that treats a black Chrome border as a fake image, hid the JPEG behind a yellow panel, and printed a sentence from solo mode (“Finding a replacement card…”) even though Daily 5 has no replacement machinery. Header `0/200` is the daily earning-cap toy in the chrome. It did not cause this.

Cards 2–5 of 2026-09-15 are fine under the same check. Card 1 is a landmine for the whole day because Daily 5 is shared.

---

*Audit by Cursor Grok 4.6, 2026-09-16. Code: `main` @ `bdf91647`. Live: packpts.com + Railway deploy `e77d1ce7`.*
