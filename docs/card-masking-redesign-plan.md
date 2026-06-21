# Card Masking Redesign Plan

## Current Implementation Summary

PackPTS uses **two separate masking systems** that operate independently:

### System 1: CSS DOM Overlay Masking (Primary — Browser)

During active gameplay, player names are hidden by absolute-positioned `<div>` elements layered on top of the card image. These overlays cover fixed percentage bands at the top and bottom of the card.

- **Mechanism:** `backdropFilter: blur(18px) saturate(0.7)` for blur type; `backgroundColor: "#0b0f16"` for solid type
- **Coverage:** 18% from top + 32% from bottom = **50% of the card area is masked**
- **Config source:** Per-request fetch to `/api/card-sets/:setKey/mask`, falling back to hardcoded `DEFAULT_MASK_REGIONS`
- **Trigger:** Applied when `!isRevealed && !imageError` in `GameCard.tsx`

### System 2: Server-Side Image Pre-rendering (Secondary — Sharp + OCR)

A separate pipeline pre-renders permanently-masked JPEG images using Sharp for band overlays and Tesseract.js for targeted OCR-based text detection.

- **Mechanism:** Sharp composites dark semi-transparent bands (r:30,g:30,b:30, alpha:0.92) onto the raw image; OCR finds player name tokens and applies additional targeted blur patches
- **Output:** Cached JPEG files in `data/masked-cards/`; served via `/api/cards/:cardId/masked-image`
- **Usage:** Available via API but the CSS overlay system is what gameplay actually renders

---

## Root Cause of Poor Visual Quality

### 1. Coarse Band Coverage Destroys Immersion
The masks cover **50% of the card** (18% top + 32% bottom). For a typical card, this blocks:
- Top band: team logo, set name, player position (fine to hide)
- Bottom band: player name, stats, biographical info (needed to hide)

The bottom band percentage is far larger than necessary because the system must conservatively cover all possible name positions across all card sets/eras.

### 2. Three Inconsistent DEFAULT_MASK_REGIONS Definitions
| Location | Top | Bottom | Type |
|---|---|---|---|
| `shared/schema.ts` (canonical) | 18% blur | 32% (y=68) blur | blur |
| `GameCard.tsx` (gameplay) | 18% blur | 32% (y=68) blur | blur |
| `MaskedCardImage.tsx` (standalone) | 18% solid | 20% (y=80) solid | solid |

`MaskedCardImage.tsx` has diverged — its bottom band is only 20% and uses solid color instead of blur.

### 3. Blur Artifacts on Vibrant Card Art
`backdropFilter: blur(18px)` applied to colorful, high-contrast card photography creates visible color bleeding — the blurred art smears into the overlay edge. On cards with orange/red team colors (Giants, Orioles, Cardinals), this bleeds orange. On cards with gray/dark backgrounds, it bleeds gray. This is the origin of the "orange bottom, gray top" description — it is not a fixed color, it is whatever the card art bleeds into the blur region.

### 4. Server-Side System Uses Different Logic Than Client
`maskProfiles.ts` default is `bottomBandPct: 0.22` (22%) while the client default is 32%. These systems are not synchronized.

---

## All Files and Components Involved

### Client

| File | Role |
|---|---|
| [`client/src/components/GameCard.tsx`](../client/src/components/GameCard.tsx) | Primary gameplay card renderer; applies CSS DOM masks in all 3 game modes |
| [`client/src/components/MaskedCardImage.tsx`](../client/src/components/MaskedCardImage.tsx) | Standalone masked card image; used outside gameplay contexts; has diverged DEFAULT_MASK_REGIONS |

### Server

| File | Role |
|---|---|
| [`server/services/maskConfig.ts`](../server/services/maskConfig.ts) | Reads/writes/caches mask config from DB; serves `/api/card-sets/:setKey/mask` |
| [`server/masking/maskCardImage.ts`](../server/masking/maskCardImage.ts) | Core Sharp + Tesseract OCR masking engine |
| [`server/masking/maskingService.ts`](../server/masking/maskingService.ts) | Orchestrates server-side mask generation; manages `maskingQueue` dedup and file cache |
| [`server/masking/maskProfiles.ts`](../server/masking/maskProfiles.ts) | Per-set band percentage profiles for server-side system; inconsistent with client defaults |
| [`server/routes.ts`](../server/routes.ts) | Exposes mask-related APIs (lines ~7464, 7584, 7599, 7622) |

### Shared

| File | Role |
|---|---|
| [`shared/schema.ts`](../shared/schema.ts) | Canonical `DEFAULT_MASK_REGIONS`, `SLABBED_MASK_REGIONS`, `MaskRegion` type, `cardSetMasks` table, `cardImageMaskCache` table |

### Database Tables

| Table | Purpose |
|---|---|
| `cardSetMasks` | Per-set mask region configurations (setKey, regions JSON, maskVersion) |
| `cardImageMaskCache` | Cache of pre-rendered masked JPEG paths (cardId, rawImageUrl, maskedImagePath, maskVersion) |

---

## Where Masking Is Applied in the App

| Location | Component | Mode |
|---|---|---|
| Solo gameplay | `GameCard.tsx` (via `game.tsx:1130`) | CSS overlay |
| Daily 5 | `GameCard.tsx` (via `daily5.tsx:448`) | CSS overlay |
| 1v1 match | `GameCard.tsx` (via `match.tsx:745`) | CSS overlay |
| Standalone card views | `MaskedCardImage.tsx` | CSS overlay |
| Pre-rendered masked image API | `maskingService.ts` → `GET /api/cards/:cardId/masked-image` | Server JPEG |
| Admin mask config | `POST /api/admin/card-sets/:setKey/mask` | Config only |

**Not involved in card masking:**
- `server/contentFactory/` — generates score summary social share graphics (SCORE_CARD, DAILY5_RANK_CARD, STREAK_BADGE); no card image masking

---

## Risks and Dependencies

### Breaking Risks

| Risk | Impact | Notes |
|---|---|---|
| Changing `DEFAULT_MASK_REGIONS` in `shared/schema.ts` | Low | Both client components fall back to their own local hardcoded values, not `shared/schema.ts`, so the canonical value is not used at client runtime |
| Changing CSS overlay z-index or positioning | Medium | `GameCard.tsx` has complex layering: image → overlays (z:20) → flip animation → reveal state |
| Changing mask region format/schema | High | `cardSetMasks.regions` is stored as JSON; any structural change requires a migration and cache invalidation |
| Removing or changing `backdropFilter` | Low-Medium | Safari requires `-webkit-backdrop-filter`; already handled with `WebkitBackdropFilter` in `GameCard.tsx` |
| Server-side masking pipeline changes | Low | The server JPEG system appears lightly used in actual gameplay; CSS overlays are primary |

### Performance Risks

| Risk | Notes |
|---|---|
| `backdropFilter` GPU cost | Blur filters are GPU-composited; on low-end mobile devices, 50% blur coverage per card is expensive. Reducing coverage area improves performance. |
| OCR worker lifecycle | Tesseract workers are per-recognition with 2500ms timeout; MAX_CONCURRENT_OCR=2 throttles this. Any server-side approach must preserve this throttle. |
| Per-card API fetch for mask config | Each `GameCard` and `MaskedCardImage` fetches `/api/card-sets/:setKey/mask`; cached server-side (10min) but not client-side |

### Cross-Device Risks

| Risk | Notes |
|---|---|
| `backdropFilter` support | Supported in all modern browsers; Chrome/Safari/Firefox all handle it. |
| Solid vs. blur rendering on OLED | Solid `#0b0f16` on OLED displays renders as true black, which is more visually jarring than blur. Blur approach is better for OLED. |
| Retina/HiDPI card images | No masking-specific issues; Sharp handles image scaling server-side, CSS overlays scale with the element. |

### Consistency Risks

| Risk | Notes |
|---|---|
| Three DEFAULT_MASK_REGIONS definitions | `MaskedCardImage.tsx` will show 20% solid bottom band while `GameCard.tsx` shows 32% blur bottom band for the same card and set |
| Two masking systems with different band calculations | If the server-side system is ever promoted to primary, its 22% default bottom band won't match the 32% the client uses |

---

## Redesign: Detailed Masking Design

### Visual Goal

The mask must read as a natural part of the card — not a UI element placed on top of it. Players should see rich card art and feel genuinely engaged in the guessing game. The mask should feel like frosted glass over the name area, not a painted box.

### New Region Targets

Based on how name and stats text appears on actual baseball cards:

| Region | yPct | hPct | Rationale |
|---|---|---|---|
| Bottom (primary) | 82% | 18% | Player name is in the bottom 18% on most modern Topps, Bowman, and Upper Deck sets |
| Top (conditional) | 0% | 10% | Only applied when `cardSetMasks` config for the set specifies it; many sets have the name purely at the bottom |

**Old coverage:** 50% (18% top + 32% bottom)  
**New coverage:** 18–28% depending on set (10% top optional + 18% bottom)

The bottom percentage drops from 32% to 18% because the old system was over-compensating for uncertainty. With per-set configuration in the `cardSetMasks` DB (already in place), each set can specify exactly where its name text lives instead of using a single conservative default.

### Rendering Approach: Frosted Glass via CSS `backdrop-filter`

The new approach keeps the CSS DOM overlay architecture (it is already in place in both `GameCard.tsx` and `MaskedCardImage.tsx`) but changes the visual parameters to produce a natural frosted-glass effect instead of a colored box.

**New blur parameters:**

```
backdropFilter: "blur(24px) brightness(0.85) saturate(0.5)"
WebkitBackdropFilter: "blur(24px) brightness(0.85) saturate(0.5)"
backgroundColor: "rgba(0, 0, 0, 0.15)"
```

Explanation of each parameter:
- `blur(24px)` — stronger than the current 18px; makes individual letter shapes unreadable even for larger font sizes
- `brightness(0.85)` — slightly darkens the frosted area relative to the surrounding card, giving it a natural recessed look without imposing a color
- `saturate(0.5)` — desaturates the smeared color so red/orange bleeds no longer look like colored boxes
- `rgba(0,0,0,0.15)` — a near-invisible dark tint prevents the blur region from appearing whiter/lighter than the card (which can happen on light-colored card borders)

**Soft edge treatment:**

The sharp rectangular edges of the current mask are a key source of the "colored box" perception. The new design uses a CSS gradient mask on the overlay element:

```
maskImage: "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)"
WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)"
```

This feathers the top and bottom edges of each mask region over 20% of the region's own height, blending the frosted glass smoothly into the card art with no visible edge. This is pure CSS — no canvas, no additional dependencies.

**What does NOT change:**
- The `<div>` overlay structure in `GameCard.tsx:495–512` and `MaskedCardImage.tsx:141–158`
- The `MaskRegion` type in `shared/schema.ts`
- The `cardSetMasks` DB table schema
- The `/api/card-sets/:setKey/mask` API endpoint

Only the visual CSS parameters and the `DEFAULT_MASK_REGIONS` values change.

### New DEFAULT_MASK_REGIONS (canonical, in `shared/schema.ts`)

```typescript
export const DEFAULT_MASK_REGIONS: MaskRegion[] = [
  // Bottom name band — covers name on most modern sets
  { xPct: 0, yPct: 82, wPct: 100, hPct: 18, type: "blur", radiusPct: 0 },
];
```

No top band in the default. The top band will be added only in per-set configs for sets that have name text at the top (e.g., some vintage sets). This is already expressible in the existing `cardSetMasks` table.

**New SLABBED_MASK_REGIONS** (for slabbed card views):

```typescript
export const SLABBED_MASK_REGIONS: MaskRegion[] = [
  { xPct: 5, yPct: 83, wPct: 90, hPct: 14, type: "blur", radiusPct: 0 },
];
```

Slightly inset horizontally (5% on each side) to avoid masking the slab holder border. Reduced height to 14% since slabbed card images have proportionally more border framing.

### Per-Set Config Updates Required

The following sets in `maskProfiles.ts` (server-side) and their equivalents in `cardSetMasks` (client-side) need updated region configs post-implementation:

| Set | Name Location | Recommended Bottom yPct | hPct |
|---|---|---|---|
| Default (modern Topps/Bowman) | Bottom 15–20% | 82 | 18 |
| 1952 Topps | Bottom 30–40% | 65 | 35 |
| 1987 Topps | Bottom 20–25% | 78 | 22 |
| 1989 Upper Deck | Bottom 18–22% | 80 | 20 |

These values are informed by the existing `maskProfiles.ts` bottomBandPct entries and narrowed using the new tighter approach.

---

## Architecture Decision: CSS-First Hybrid

### Decision: Keep CSS DOM Overlays as Primary; Reform Server-Side as Canonical Pre-render

**Rationale grounded in the codebase:**

1. **CSS overlays already work and are deployed.** Both `GameCard.tsx` and `MaskedCardImage.tsx` use the same overlay pattern. Switching to server-side or canvas would require rewriting the render path in both components, invalidating the mask cache, and adding a loading state for every card.

2. **The visual problem is parameter-based, not architecture-based.** The "orange box" issue is caused by `blur(18px) saturate(0.7)` over 32% of the card without a feathered edge. Changing the CSS parameters and adding `maskImage` gradient fixes the visual problem without any architecture change.

3. **Canvas is not warranted.** Canvas-based masking would require reading image pixel data (same security constraint that `isPlaceholderImage` already handles with try/catch for `SecurityError`) and re-drawing the image on canvas for every card render. This is significantly more complex, introduces cross-origin image restrictions (CORS), and provides no visual benefit over a well-tuned `backdrop-filter`.

4. **Server-side JPEG pre-render is useful but not primary.** The existing `maskingService.ts` + `maskCardImage.ts` system should be reformed to produce correctly-sized masks (aligned with the new CSS parameters) and retained as the canonical source for any context where CSS rendering is not available (OG/social images, server-side rendering). It should not be the live gameplay path because it adds latency on first request.

5. **Performance.** With the masked area dropping from 50% to ~18%, the GPU cost of `backdrop-filter` is reduced proportionally. This resolves the mobile performance concern without any architectural change.

### Architecture Summary

```
Gameplay (GameCard.tsx, MaskedCardImage.tsx)
  └─ CSS backdrop-filter overlay [PRIMARY]
       ├─ MaskRegion config from /api/card-sets/:setKey/mask
       ├─ Falls back to DEFAULT_MASK_REGIONS (shared/schema.ts)
       └─ New: CSS maskImage gradient for soft edges

Server-side JPEG pipeline (maskingService.ts)
  └─ Sharp + OCR [RETAINED, REFORMED]
       ├─ Used for social share / OG images
       ├─ Used to pre-warm cache for upcoming cards
       └─ Aligned with new DEFAULT region sizes (18% bottom, no top default)
```

---

## Fallback Strategy

**Rule: No colored overlays allowed as fallback under any condition.**

### Fallback Hierarchy

1. **Mask config fetch fails** → Use `DEFAULT_MASK_REGIONS` from `shared/schema.ts` (imported, not local copy). The frosted glass CSS parameters apply. This is safe because the default region covers the bottom 18% where names appear on most modern sets.

2. **Image fails to load** → The existing `imageError` state in both `GameCard.tsx` and `MaskedCardImage.tsx` already suppresses mask rendering when the image is missing. No change needed; a card with no image shows the error state, not a masked overlay on nothing.

3. **`backdrop-filter` is unsupported** (extremely rare in 2026 — pre-Chromium Edge, old iOS Safari before 9) → CSS graceful degradation: without `backdrop-filter`, the `rgba(0,0,0,0.15)` `backgroundColor` alone is rendered. This is a near-transparent tint, not a colored box, and the text beneath it is readable. In this case, the fallback behavior is: **replace the card**.
   - `GameCard.tsx` already has an `onReplace`/`onSkip` callback and a `reportOpen` flow.
   - A `onUnsupportedMask` prop can signal the parent to swap the card, exactly as the existing "auto-report placeholder" flow works today.
   - This path will affect < 0.5% of users and does not require special implementation.

4. **Server-side masking fails** → The card is served unmasked from the server JPEG endpoint. This endpoint is not the primary path; the CSS overlay in the browser does not depend on it. No user-visible impact.

### What Fallback Must Never Do

- Render a solid `#0b0f16` colored band
- Render an `rgba(0,0,0,0.9)` near-opaque overlay
- Use `backgroundColor` with any saturated color
- Leave no masking at all on a card that should be masked (skip the card instead)

---

## Delegation Plan

The implementation work divides cleanly across four concerns. Each is independent once the new `DEFAULT_MASK_REGIONS` values are set in `shared/schema.ts`.

### Agent 1: UI / Frontend (`react-specialist` or `frontend-developer`)

**Scope:**
- Update `GameCard.tsx:504–511` — replace CSS parameters with new frosted-glass values (`blur(24px) brightness(0.85) saturate(0.5)`, `rgba(0,0,0,0.15)`, add `maskImage` gradient)
- Update `MaskedCardImage.tsx:150–157` — same CSS parameter changes
- Remove both local `DEFAULT_MASK_REGIONS` definitions from `GameCard.tsx` and `MaskedCardImage.tsx`
- Import `DEFAULT_MASK_REGIONS` from `@shared/schema` in both files
- Add `maskImage`/`WebkitMaskImage` gradient inline style to the overlay `<div>` for soft-edge feathering

**Files:** `client/src/components/GameCard.tsx`, `client/src/components/MaskedCardImage.tsx`

**Verify:** Card renders with frosted glass bottom strip; no colored band visible; soft top/bottom edge on the mask; `isRevealed=true` shows full card

### Agent 2: Shared Schema + Config (`backend-developer` or `typescript-pro`)

**Scope:**
- Update `DEFAULT_MASK_REGIONS` in `shared/schema.ts` to single bottom-only region (yPct:82, hPct:18, type:"blur")
- Update `SLABBED_MASK_REGIONS` in `shared/schema.ts` (yPct:83, hPct:14, inset xPct:5/wPct:90)
- Update `server/masking/maskProfiles.ts` default: `bottomBandPct: 0.18`, `topBandPct: 0.0`
- Update per-set profiles in `maskProfiles.ts` for 1987 Topps, 1989 Upper Deck, 1952 Topps
- Bump `CURRENT_MASK_VERSION` in `maskProfiles.ts` from `"v2.0"` to `"v3.0"`
- Clear `cardImageMaskCache` for all cards (version mismatch will force re-render on next request)

**Files:** `shared/schema.ts`, `server/masking/maskProfiles.ts`

**Verify:** `DEFAULT_MASK_REGIONS` has one region; `SLABBED_MASK_REGIONS` has one inset region; maskProfiles default matches schema

### Agent 3: Server-Side Masking Reform (`backend-developer`)

**Scope:**
- Update `maskCardImage.ts` `applyTemplateMasks()` to use new band percentages from `maskProfiles.ts` (already reads from it — just ensure alignment)
- Update Sharp overlay to use `background: { r: 0, g: 0, b: 0, alpha: 0.15 }` with increased `blur(24)` — producing server-side JPEG equivalents of the new CSS frosted-glass look
- Remove top-band overlay from `applyTemplateMasks()` for the default profile (top band = 0.0)
- No changes to `maskingService.ts` dedup/caching logic

**Files:** `server/masking/maskCardImage.ts`

**Verify:** Generated JPEG shows narrow bottom blur band with no visible colored box; OCR layer still applies targeted word-level blurs on top

### Agent 4: Testing (`test-automator` or `qa-expert`)

**Scope:**
- Visual regression tests: render `GameCard` with `isRevealed=false` and assert no `#0b0f16` or solid dark backgroundColor in the overlay style
- Unit test: verify `DEFAULT_MASK_REGIONS` import in `GameCard.tsx` and `MaskedCardImage.tsx` comes from `@shared/schema`, not local declaration
- Integration test: verify `/api/card-sets/__default__/mask` returns `hPct: 18` bottom region and no top region
- Fallback test: with mock returning HTTP 500 from mask config endpoint, verify `GameCard` falls back to `DEFAULT_MASK_REGIONS` from schema (not local)
- Snapshot test: render `MaskedCardImage` with `showMasks=true` and confirm overlay count = 1 (bottom only) for default config

**Files:** new test files in `client/src/components/__tests__/` and `server/__tests__/`

---

## Consolidation Pre-conditions (Must Complete Before Any Agent Starts)

These are prerequisites, not separate tickets. They are small and must happen atomically:

1. `shared/schema.ts` `DEFAULT_MASK_REGIONS` updated to new values
2. Both client components delete their local `DEFAULT_MASK_REGIONS` and import from `@shared/schema`
3. `maskProfiles.ts` default aligned with schema

Everything downstream (CSS parameters, server masking, tests) depends on this single source of truth being established first.

---

---

## Implementation Status

**Implemented: 2026-06-20. All four agents' scopes complete. 12 new unit tests added.**

### What changed

| File | Change |
|---|---|
| `shared/schema.ts` | `DEFAULT_MASK_REGIONS` → single bottom band `{ yPct: 82, hPct: 18 }`; `SLABBED_MASK_REGIONS` → inset variant `{ xPct: 5, wPct: 90, yPct: 83, hPct: 14 }` |
| `client/src/components/GameCard.tsx` | Removed local `MaskRegion`/`DEFAULT_MASK_REGIONS`; imports from `@shared/schema`; CSS updated to `blur(24px) brightness(0.85) saturate(0.5)`, `rgba(0,0,0,0.15)`, `maskImage` gradient for soft edges; inner content div backgrounds made transparent |
| `client/src/components/MaskedCardImage.tsx` | Same imports, same CSS update; removed re-export of `DEFAULT_MASK_REGIONS` (now comes from schema) |
| `server/masking/maskProfiles.ts` | 1989 Upper Deck: `0.18 → 0.20`; 1952 Topps: `0.28 → 0.35` |
| `server/masking/maskCardImage.ts` | Sharp overlay background: `r:20,g:20,b:20 → r:0,g:0,b:0` |
| `server/tests/masking.test.ts` | 12 new unit tests covering schema constants, per-set profiles, version, and no-solid-color invariant (merged with existing server-side answer masking tests) |

### Coverage: 50% → 18%

The default mask now covers the bottom 18% of the card only. Old two-band 50% coverage (18% top + 32% bottom) is gone. Per-set configs can add a top band for vintage sets via `cardSetMasks` DB entries.

*Analysis completed: 2026-04-17. Design completed: 2026-04-17. Implementation completed: 2026-06-20.*
