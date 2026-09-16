# Mask removal only after successful answer submit

**Status:** audit + executive plan. **No behavior fix in this change.**  
**Date:** 2026-09-16  
**Codebase:** `origin/main` @ `07215b1b` (`#87` Play Again; includes `#86` v4.0 name localization and `#85` Daily 5 overlay).  
**Reporter / product owner:** Dave — after a user has **submitted** an answer, the mask must be removed to reveal the **full** card. The mask must **not** be removed before a successful submit.  
**This document:** read-only engineering audit. No production schema or card-row mutation. No invented live DB state.

Evidence classes:

| Label | Meaning |
|---|---|
| **CODE** | Proven by current `main` (commit `07215b1b`) |
| **HUNCH** | Plausible, not proven from this checkout (no live packpts.com session in this audit) |

Do not regress: `#85` Daily 5 honest overlay / `allowClientImageReject={false}` / share branding; `#86` layout-aware name localization (v4.0); `#87` Game Complete Play Again.

---

## 0. Executive verdict

Dave’s rule is **not met today**.

Two independent layers hide the printed name during play. `isRevealed` only drops the **client CSS overlay**. The `<img>` `src` stays the **server-baked masked JPEG** for the whole question. After a successful submit the overlay goes away, but the pixels Dave would see are still name-redacted (`alpha 0.94` dark rectangles from `#86`). That is the opposite of “reveal the full card.”

Select-without-submit does **not** flip `isRevealed` on any play surface. There is **no per-card timer** that reveals. Image load does **not** flip `isRevealed`. Guest vs auth does **not** change overlay timing (guest is solo-only).

| Dave’s rule | Current `main` |
|---|---|
| Mask stays on until a **successful** answer submit | Daily 5 and 1v1: overlay drops only after a successful submit/ack. Solo: overlay drops **on Submit click**, before the server accepts (**CODE**). |
| After that submit, show the **full** card (printed name visible) | Overlay off, **baked JPEG still masked**. No original-image swap on any mode (**CODE**). |
| Next card starts masked | `isRevealed` resets to false; `src` is still a masked URL (**CODE**). |

**Smallest safe product fix (see §8):** keep `#86` bake + overlay for the guessing phase; on **successful** submit only, swap `src` to the existing unmasked proxy `/api/images/card/:id` and keep the overlay off. Move solo `setIsRevealed(true)` to `onSuccess` so those two changes cannot leak the original before ACK.

---

## 1. Two masking systems (both still live)

Gameplay is **not** “CSS overlay on the raw CardHedge scan.” Question payloads set `card.imageUrl` to the baked endpoint, then `GameCard` paints a second mask on top of that JPEG.

```
CardHedge / playableCards.imageUrl
        │
        ▼
maskingService → maskCardImage (Sharp + optional Tesseract)
        │
        ▼
GET /api/cards/:cardId/masked-image?v=v4.0     ← question.imageUrl (solo, Daily 5, 1v1 start)
        │
        ▼
GameCard <img src={imageUrl}>
        │
        ▼
CSS overlays while !isRevealed && !imageError
  z20  cosmetic regions.map() (blur/solid + set label)
  z21  solid #0a0e16 name band + "WHO IS THIS PLAYER?"
```

`MaskedCardImage` is **not** a play surface. It is set-cover / stack chrome (`SetCover.tsx`). Share art uses `redactCardForShare` (always masked; never revealed). Those are out of Dave’s play-loop rule.

### 1.1 Server bake — `maskingService` / `maskCardImage` / geometry / OCR / v4.0 / cache

**CODE**

| Piece | Where | What it does |
|---|---|---|
| Version | `shared/maskGeometry.ts` `CURRENT_MASK_VERSION = "v4.0"` | Query `?v=v4.0`, filename `{cardId}_v4.0.jpg`, DB `card_image_mask_cache.maskVersion` |
| URL helper | `maskedCardImageUrl(cardId)` | `/api/cards/${id}/masked-image?v=v4.0` |
| Geometry helpers | `overlayMaskRegions`, `largestMaskRegion`, `unionMaskRegions`, `pixelBoxToRegion` | Client floor = at least `DEFAULT_MASK_REGIONS`; OCR boxes → percent regions |
| Profiles | `server/masking/maskProfiles.ts` | 1986–1990 Fleer **Basketball** → top 18% plate. 1987 Topps → bottom 46%. 1989 Upper Deck → bottom 20%. 1952 Topps → bottom 35%. Unknown → `DEFAULT_MASK_REGIONS` (`yPct:54, hPct:46`). 1989 Fleer **baseball** does not take the basketball top plate |
| OCR + plan | `server/masking/nameLocalization.ts` `resolveNameMaskPlan` | Chain: `ocr+profile` → `profile` (even if OCR misses) → `ocr` (last name matched) → `default` |
| Bake | `maskCardImage.ts` `applyPercentRegions` | Opaque `{ r:10, g:14, b:22, alpha: 0.94 }` + blur 8. **Not** the old 0.15 wash |
| Orchestration | `maskingService.ts` | Dedup queue, `MAX_CONCURRENT_OCR = 2`, timeout 3500ms. Looks up `baseballCards` **first**, else `playableCards` + `game_sets` for `buildSetMaskHint(year, brand, sport, setName, category)` |
| HTTP | `GET /api/cards/:cardId/masked-image` | Public. `Cache-Control: public, max-age=3600` (not immutable). 404 if bake/download fails — **no fallback to original** |
| Rebuild | `POST /api/admin/masks/rebuild` | Admin. Ops: `docs/MASK_CACHE_REBUILD.md` |
| Config API | `GET /api/card-sets/:setKey/mask` | Public. `maskConfig.ts`: UUID `setKey` → `game_sets` hint → profile regions. Custom `card_set_masks` row wins only if it is **not** equal to `DEFAULT_MASK_REGIONS` |
| Question URLs | `storage.ts`, `daily5Service.ts`, `matchService.ts` | All use `maskedCardImageUrl` |

Tests: `server/tests/masking.test.ts` (sanitizer + `DEFAULT_MASK_REGIONS` + version `v4.0`); `server/tests/nameMasking.test.ts` (Fleer-like top plate vs bottom plaque on **synthetic** Sharp fixtures — no live DB, no Tesseract in CI).

**HUNCH:** leftover `*_v3.0.jpg` files on the Railway volume until admin rebuild. New `?v=v4.0` URLs still regenerate when the cache row version mismatches. Not inspected on this machine.

**HUNCH:** `baseballCards` lookup-first could theoretically bind the wrong source image if a legacy id collided with a `playableCards` id. Active play is `playableCards`; treat as defensive leftover, not a play-path design.

### 1.2 Client overlay — `GameCard`

**CODE** (`client/src/components/GameCard.tsx`)

- Fetches `/api/card-sets/${setKey \|\| setLabel}/mask` (10 min React Query staleTime). Empty key → local `DEFAULT_MASK_REGIONS`.
- `regions = overlayMaskRegions(maskConfig?.regions)` — never an empty overlay.
- Name band follows **all** regions at `zIndex: 21`, solid `#0a0e16`, label on the largest region if `hPct >= 8`. This is the `#86` fix for the hardcoded `bottom:0; height:46%` that left 1989 Fleer **SPUD WEBB** in the clear.
- Cosmetic `regions.map()` at `zIndex: 20` still uses `backdropFilter: blur(12px)` for `type === "blur"`. It does **not** combine `backdropFilter` with `mask-image` (Chrome rule). The security layer is the solid z21 band.
- Overlay **render gate:** `{!isRevealed && !imageError && ...}`. Both the cosmetic regions and the name band unmount when either flag is true.
- Overlay does **not** depend on image-load success except via `imageError`. A loading spinner covers the card until `onLoad`; the mask nodes are already in the tree (over an `opacity: 0` img).
- `allowClientImageReject` default `true` (solo / 1v1). Daily 5 passes `false` (`#85`).
- Image-error overlay (`gameCardImageError.ts`): Daily 5 with no skip/replace/`onImageError` → honest copy “Card image didn’t load. You can still answer.” Solo with `onImageError` → “Finding a replacement card…” then skip/replace buttons. Error overlay is `z-30` and **replaces** the card art — the printed name is not shown.

`isRevealed` is **only** a parent prop. `GameCard` never sets it from click, timer, or `onLoad`.

---

## 2. Per-mode play surfaces

### 2.1 Solo — `client/src/pages/game.tsx` (`/game/solo`)

| Event | Masked JPEG shown? | CSS overlay (`isRevealed`) | Notes |
|---|---|---|---|
| Question start | Yes (`maskedCardImageUrl`) | `false` | `startGameMutation.onSuccess` / `nextQuestionMutation.onSuccess` reset `isRevealed` |
| Choice click | Yes | stays `false` | `handleSelectAnswer` only `setSelectedAnswer` |
| Submit **click** | Yes | **`true` immediately** | `handleSubmit`: `setIsRevealed(true)` then `mutate` — **before** HTTP success |
| Submit HTTP success | Yes (same URL) | stays `true` | `onSuccess` sets `revealedCorrectAnswer`; does **not** change `imageUrl` |
| Submit HTTP error | Yes | rolled back to `false` | `onError` comment `BUG-15` |
| Next question | Yes (next card’s masked URL) | `false` | |
| Image error | Card hidden; error overlay | overlays unmounted (`imageError`) | Auto `replace-card` if `!isRevealed` |
| Replace success | New question still `maskedCardImageUrl` | stays `false` (replace gated on `!isRevealed`) | Sanitized; no `playerName` / `correctAnswer` |
| Skip after 2 failed replaces | Advances; no reveal of the failed card | `next` resets `isRevealed` | `#85` `imageFailure` index stamping stays |
| Play Again (`#87`) | New session, masked | `false` | Immediate restart same set + count; guests allowed |

Guest vs auth (**CODE**): `POST /api/game/start` and `POST /api/game/answer` are not auth-gated. Overlay timing is the same. Signup modal is post-complete only.

Prefetch (**CODE**): next question’s **masked** URL is warmed with `new Image()`. It does not load `/api/images/card/:id`.

`currentQuestionAnswered`: if the session object has `answered === true` on the current question, Submit is hidden. That is a resume/idempotency UI, not a visual reveal of the scan.

### 2.2 Daily 5 — `client/src/pages/daily5.tsx`

| Event | Masked JPEG? | `isRevealed` |
|---|---|---|
| Start / resume onto **next unanswered** | Yes | `false` (`applyResume`) |
| Choice click | Yes | stays `false` |
| Submit click | Yes | stays `false` until mutation success |
| `POST /api/daily5/answer` success | Yes (same URL) | **`true` in `onSuccess` only** |
| Submit error | Yes | stays `false` (toast only) |
| Next Card / See Results | Next position masked | `false` |
| Resume already-answered position | Submit disabled; handler advances | does not paint a reveal of the old card |
| Image error | Honest overlay; **submit still enabled** | overlays unmounted; name not shown |
| Replace / skip | **None** — Daily 5 must not call solo `replace-card` (`#85`) | |

Auth (**CODE**): `POST /api/daily5/start` and `/answer` require `isAuthenticated`. Guests can see status/preview/leaderboard, not play. No guest overlay variant.

Countdown on this page is the **next CT midnight** widget on results, not a per-card reveal timer.

`GameCard` props from `#85`/`#86` (**CODE**): `key={currentCard.cardId}`, `setKey={challenge.setId}`, `allowClientImageReject={false}`. Keep these.

### 2.3 1v1 / match — `client/src/pages/match.tsx`

| Event | Image URL | Overlay (`isRevealed = answerResult !== null`) |
|---|---|---|
| `match_started` / `next_question` | `maskedCardImageUrl` from `matchService` | `answerResult` cleared → masked |
| Choice click | unchanged | stays masked | `handleSelectChoice` only |
| Submit click | unchanged | stays masked | `send("submit_answer")`; `lockedIn` after `answer_ack` **does not** reveal |
| `answer_result` or HTTP fallback `data.ok` | unchanged | **revealed** |
| Stale `answer_result` (idx behind current) | ignored | no flip |
| Next question | masked | overlay back on |
| Image error | retry twice, then replace button | error overlay hides art |
| `question_replaced` | **`/api/images/card/:id` (UNMASKED proxy)** | overlay **on** (until they submit) |

**CODE:** `server/services/matches/replaceQuestion.ts` writes `imageUrl: /api/images/card/${availableCard.id}` — not `maskedCardImageUrl`. Initial questions use the masked helper. Replaced 1v1 cards are the only play path that serves **original pixels** during the guessing phase. CSS overlay is then the only in-UI name hide. Overlay `setKey={matchState.gameSetId}` but `sanitizeMatchStateForClient` in `websocket.ts` **does not send `gameSetId`**, so the client falls through to `DEFAULT_MASK_REGIONS` (bottom 46%) for 1v1.

**HUNCH:** a replaced 1989 Fleer Basketball card in 1v1 could show the top name plate in the clear (unmasked JPEG + default bottom overlay). Not reproduced against live matches in this audit.

1v1 requires auth (WebSocket `isAuthenticated`). No guest 1v1 overlay path.

There is an 8s **resync** timer while waiting for the opponent, not a reveal timer.

---

## 3. When can the overlay drop? (Dave’s “not before submit”)

| Trigger | Solo | Daily 5 | 1v1 |
|---|---|---|---|
| Choice select | No | No | No |
| Image `onLoad` | No | No | No |
| Per-card timer | None | None | None |
| Submit **button** (optimistic) | **Yes — overlay off before ACK** | No | No |
| Successful submit / `answer_result` | Yes (already off) | **Yes — only then** | **Yes — only then** |
| Wrong answer (successful submit) | Overlay off (same as correct) | Same | Same |
| Skip / replace | No reveal of that card | N/A | Replace keeps overlay |
| Image error | Overlay unmounted; **error chrome**, not the scan | Same | Same |

Dave’s “successful submit” = HTTP/WS accepted the answer (correct **or** incorrect). Daily 5 and 1v1 match that for the **overlay**. Solo does not (optimistic). **None** of the three then show original card pixels.

---

## 4. Guest vs auth

| Mode | Play without account | Overlay / bake difference |
|---|---|---|
| Solo | Yes | None. Same `GameCard` + same masked URLs |
| Daily 5 | No (`isAuthenticated` on start/answer) | N/A for guests |
| 1v1 | No | N/A for guests |

`#87` Play Again on solo is not auth-gated. Replay starts a **new** masked session (`isRevealed` false). Do not tie reveal logic to that CTA.

---

## 5. Related leaks (in-UI vs DevTools)

These are not Dave’s “after submit, show the card” UX, but they sit on the same URLs.

| Issue | Class | Notes |
|---|---|---|
| Question JSON includes `card.id` | **CODE** | Intentional opaque id |
| `GET /api/images/card/:cardId` is **public** and returns the **original** scan | **CODE** | A client that already has `card.id` can fetch the full card before submit without using `GameCard` |
| Baked JPEG 404 | **CODE** | `GameCard` error overlay; Daily 5 can still answer blind (`#85`) |
| Alt text | **CODE** | `[team, "sports card"]` — team is set/name-ish on some payloads (`card.team` from set string), not `playerName`. Sanitizer strips `playerName` |

Closing the public original endpoint without a **post-submit** replacement URL would make Dave’s full-card reveal harder. Sequence that with §8; do not gate the proxy first.

---

## 6. Gaps vs Dave’s rule (ranked)

| Rank | Gap | Severity | Evidence | Surfaces |
|---|---|---|---|---|
| **P0** | After submit, full card is **not** shown — `<img>` stays on baked v4.0 JPEG (`alpha 0.94` name wipe). Overlay-off ≠ unmask. | Product miss vs Dave | **CODE** | Solo, Daily 5, 1v1 (non-replace) |
| **P0** | Solo overlay drops on Submit **click**, not on successful ACK | Violates “not before successful submit” **if** P0 image-swap ships without moving this line | **CODE** `game.tsx` `handleSubmit` | Solo only |
| **P1** | 1v1 **replace** serves `/api/images/card/:id` (original) **before** submit | Name can leak in-UI if overlay geometry misses (top-name sets + missing `gameSetId`) | **CODE** | 1v1 replace only |
| **P1** | 1v1 WS state omits `gameSetId` → overlay uses default bottom 46% | Overlay wrong for Fleer-style top plates; bake still set-aware | **CODE** | 1v1 |
| **P2** | Public original proxy lets DevTools skip the bake | Anti-cheat, not the play UI | **CODE** | All modes that expose `card.id` |
| **P2** | No unit/e2e test that select-without-submit stays overlay-on, or that post-submit pixels are unmasked | Regression vacuum | **CODE** (no client tests mention `isRevealed`) | All |
| **P3** | Cosmetic z20 still `backdropFilter` under the solid band | Visual only; z21 is the hide | **CODE** | `GameCard` |
| **P3** | `MaskedCardImage` / maker share never reveal | Correct for marketing; out of scope | **CODE** | `/sets`, share |

`#86` made P0 **worse for Dave’s reveal** in a good way for guessing: pre-v4.0 bake was a faint 0.15 wash, so dropping the CSS overlay often *looked* like a full card. v4.0 bake is actually opaque. Fix reveal by swapping the asset, **not** by weakening localization.

---

## 7. What we will not change in the first fix

- `#86` profiles, OCR chain, `DEFAULT_MASK_REGIONS` floor, UUID `setKey` → `game_sets` hint.
- `#85` Daily 5 `allowClientImageReject={false}`, honest error copy, `key={cardId}`, no Daily 5 `replace-card`.
- `#87` Play Again / Daily 5 “Play Solo” copy.
- `card_set_masks` rows, `playableCards` rows, live Daily 5 challenge cards.
- Share / OG / `redactCardForShare` (those cards stay masked).

---

## 8. Executive plan — smallest safe sequence

Goal: **guessing phase** = bake + overlay (localized). **After successful submit only** = overlay off **and** original scan. **Next card** = bake + overlay again.

### Step 1 — One helper, three parents (no new third-party, no new host)

Add a tiny shared helper, e.g. `shared/playCardImage.ts`:

```ts
maskedPlayUrl(cardId)  → maskedCardImageUrl(cardId)           // already exists
revealPlayUrl(cardId)  → `/api/images/card/${cardId}`         // already exists
resolvePlayCardSrc({ cardId, submitted }) → submitted ? reveal : masked
```

Wire **only** in:

- `game.tsx` — `submitted = isRevealed` **after** Step 2 (success-only).
- `daily5.tsx` — `submitted = isRevealed` (already success-only).
- `match.tsx` — `submitted = answerResult !== null` (already success-only).

`GameCard` stays dumb: it renders the `imageUrl` it is given. Do not teach `GameCard` to fetch originals from `isRevealed` internally until solo is success-gated (otherwise optimistic solo would request the original on click).

Remount with existing `key`s so the new `src` loads cleanly (`#85` Daily 5 `key={cardId}` is enough if `src` changes on the same card after submit; prefer including a `revealed` token in `key` so React does not keep the baked decode).

### Step 2 — Solo: overlay and original only on ACK

In `handleSubmit`, **delete** `setIsRevealed(true)` before `mutate`. Set it in `submitAnswerMutation.onSuccess` (keep `onError` rollback — it becomes a no-op if never flipped). Disable Submit while pending (already true). Choice highlight stays; overlay stays until 200.

Ship Step 1 and Step 2 **in the same PR**. Image-swap without Step 2 leaks the original on a failed/slow solo submit.

### Step 3 — 1v1 replace uses the masked helper

In `replaceQuestion.ts`, set both `imageUrl` assignments to `maskedCardImageUrl(availableCard.id)`. Overlay remains for the guessing phase. After Step 1, a later successful submit still swaps to original.

Optional same-PR: add `gameSetId: matchState.gameSetId` (from lobby/`matches.cardSetId`) to `sanitizeMatchStateForClient` so 1v1 overlay profiles match `#86`. Does not require DB writes.

### Step 4 — Tests (no live DB)

| Test | Assert |
|---|---|
| Helper: `submitted === false` | URL contains `/masked-image?v=v4.0` |
| Helper: `submitted === true` | URL is `/api/images/card/:id`, not masked |
| `nameMasking.test.ts` / `masking.test.ts` | Still green (do not shrink default 46% or drop v4.0) |
| Source assertion (same style as `playAgain.test.ts`) | `game.tsx` does not call `setIsRevealed(true)` before `mutate`; Daily 5 sets it in `onSuccess`; match uses `answerResult !== null` |
| `replaceQuestion` | replacement `imageUrl` uses `maskedCardImageUrl` |
| `#85` | `allowClientImageReject={false}` still on Daily 5 `GameCard` |
| `#87` | Play Again helpers unchanged |

Browser / Playwright (if run): select without submit → name band `data-testid="mask-name-band"` present and `img` src masked; after submit 200 → band gone and `img` src original; next card → band present and src masked again. Wrong-answer submit still reveals. Image-error Daily 5 still shows honest copy and keeps Submit.

### Step 5 — Anti-cheat (later, not blocking Dave)

Optionally mint a short-lived reveal URL from `POST /api/game/answer`, `POST /api/daily5/answer`, and `answer_result`, then require it on `/api/images/card`. **Do not** lock the proxy before Step 1 or reveal breaks.

### Explicit success criteria (Dave)

1. **Select-without-submit stays masked** — CSS name band visible; `img` is `masked-image?v=v4.0` (or 1v1 replace after Step 3: also masked-image). Printed name not readable on the card.
2. **After successful submit (correct or wrong)** — name band gone; `img` is the original scan; printed name readable.
3. **Next card starts masked** — band back; `img` masked-image again. Play Again / Daily 5 next / 1v1 `next_question` all start masked.
4. **Failed submit** — still masked (solo no longer optimistic).
5. **No regression** of `#85` / `#86` / `#87` as listed in §7.

### Out of scope / non-goals

- Rebuilding the v4.0 JPEG cache (`docs/MASK_CACHE_REBUILD.md`) — still recommended for **guessing-phase** quality, not for this reveal rule.
- Inventing `card_set_masks` rows or inspecting production `game_sets.sport` values.
- Weakening bake opacity to fake a reveal.

---

## 9. File index (play + mask)

| File | Role in this audit |
|---|---|
| `shared/maskGeometry.ts` | v4.0, `maskedCardImageUrl`, overlay floor |
| `shared/schema.ts` | `DEFAULT_MASK_REGIONS` / `SLABBED_MASK_REGIONS` / `cardSetMasks` / `cardImageMaskCache` |
| `server/masking/maskProfiles.ts` | Set layout profiles |
| `server/masking/nameLocalization.ts` | OCR token plan |
| `server/masking/maskCardImage.ts` | Sharp bake |
| `server/masking/maskingService.ts` | Cache, queue, `game_sets` hint |
| `server/services/maskConfig.ts` | `/api/card-sets/:setKey/mask` |
| `server/storage.ts` | Solo question `imageUrl` |
| `server/services/daily5Service.ts` | Daily 5 card `imageUrl` |
| `server/services/matchService.ts` | 1v1 initial `imageUrl` |
| `server/services/matches/replaceQuestion.ts` | 1v1 replace **unmasked** URL |
| `server/routes.ts` | masked-image, original proxy, admin rebuild, answer APIs |
| `server/websocket.ts` | `sanitizeMatchStateForClient` (no `gameSetId`) |
| `client/src/components/GameCard.tsx` | Overlay + `isRevealed` gate |
| `client/src/pages/game.tsx` | Optimistic reveal |
| `client/src/pages/daily5.tsx` | Success-only `isRevealed` |
| `client/src/pages/match.tsx` | `answerResult !== null` |
| `client/src/components/MaskedCardImage.tsx` | Covers / stacks only |
| `server/contentFactory/generateMakerShare.ts` | Share redaction; not play |
| `docs/MASK_CACHE_REBUILD.md` | v4.0 cache ops |
| `docs/audits/DAILY5_STUCK_REPLACEMENT_2026-09-16.md` | `#85` overlay incident |

---

## 10. Recommendation

Approve this plan, then a **behavior PR** that is only Steps 1–4. Do not mix in OCR/profile tweaks, Daily 5 replace, or Play Again copy. After merge, one solo card + one Daily 5 card + one 1v1 card: select, wait, confirm still masked; submit, confirm full card; next, confirm masked again.
