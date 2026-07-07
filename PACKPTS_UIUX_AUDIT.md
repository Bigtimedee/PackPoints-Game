# PackPTS UI/UX Audit — July 6, 2026

Static code audit of the client (`client/src`) plus targeted fixes implemented this session. Companion documents: `PACKPTS_AUDIT_TRAIL_2026-07-06.md` (what was changed and why), `PACKPTS_IOS_APP_STORE_PLAN.md` (native readiness).

## Scope and method

This was a code-level audit of the React client: card rendering (`GameCard.tsx`, `MaskedCardImage.tsx`), game surfaces (`game.tsx`, `daily5.tsx`, `match.tsx`), onboarding (`OnboardingModal.tsx`), the HTML shell (`client/index.html`), and PWA/mobile readiness. It did not include live-browser testing or user session recordings — those are recommended follow-ups (see backlog).

## Issues found and FIXED this session

### 1. Orange name mask replaced with blur (P0, fixed)
The bottom name-band overlay in `GameCard.tsx` rendered an amber/orange gradient (`from-amber-800 via-amber-700 to-amber-600`) when the mask type was `solid`, and an orange-brown tint (`rgba(120, 53, 15, 0.4)`) layered over a weak 12px blur when the type was `blur`. This made every card look defaced rather than mysterious.

**Fix:** The name band (region index 1) now always renders as a clean `blur(24px)` backdrop filter with a subtle neutral tint (`rgba(15, 23, 42, 0.2)`) and the "WHO IS THIS PLAYER?" label, regardless of configured type. Because `GameCard` is the single card renderer used by solo play, Daily 5, and 1v1 matches, this one change fixes all three game surfaces. Anti-cheat is unaffected: the server bakes a heavy sigma-25 blur into the served image (`server/masking/maskCardImage.ts`), so the client blur is presentational, not the security boundary.

### 2. No PWA/home-screen support (P1, fixed)
`client/index.html` had no web app manifest, no `apple-touch-icon`, no `theme-color`, and the only icon asset was a 128×128 favicon. Users adding PackPTS to an iOS/Android home screen got a generic blank icon and browser chrome.

**Fix:** Added `manifest.webmanifest` (standalone display, brand dark `#0b0f16` theme), generated `apple-touch-icon.png` (180×180, flattened onto brand background since iOS ignores alpha), `icon-192.png`, and `icon-512.png`, and wired up the meta tags. **Note:** icons are upscaled from the 128px favicon — replace with exports from a high-resolution logo source when available.

## Issues found, NOT fixed (prioritized backlog)

### P1 — high value
- **`MaskedCardImage.tsx` is dead code.** No page imports it; `GameCard` is the only card renderer. Its local `DEFAULT_MASK_REGIONS` (bottom band at 80–100%) also disagrees with the canonical defaults in `shared/schema.ts` (62–100%), which is a trap for future contributors. Recommend deliberate removal in its own commit.
- **No live-browser/device QA pass.** The blur change should be visually verified on production across a few card sets (especially 1952 Topps, where the name band is tallest) and on iOS Safari, where `backdrop-filter` behavior differs. Use the `/api/version` canary before testing.
- **`game.tsx` is 1,310 lines.** Not user-facing per se, but it slows every future UX iteration on the core loop. Extract the answer-submission flow and reveal state into hooks/components.

### P2 — meaningful polish
- **Viewport locks zoom** (`maximum-scale=1`). Good for preventing accidental double-tap zoom in gameplay, but an accessibility trade-off; consider allowing zoom on content pages (terms, privacy, roadmap).
- **Blur strength consistency.** Top band (set label) still uses 12px blur; name band now uses 24px. Intentional hierarchy, but worth a design pass.
- **Reveal moment.** The mask fades via a 300ms opacity transition on reveal. This is the game's dopamine moment — a slight scale/unblur animation on correct answers would amplify it cheaply.
- **Onboarding modal** is solid (4 steps, 250-pt signup hook), but fires on a `localStorage` flag only — logged-in users on a new device see it again. Key it to account state when authenticated.

### P3 — later
- Skeleton states: the card loading state is a spinner; a card-shaped shimmer skeleton would feel faster.
- Error-state styling in `GameCard` (amber "Image Failed to Load") predates the neutral palette; align it.
- Audit `pointer-events-none` on mask overlays vs. `pointer-events-auto` in the dead `MaskedCardImage` — inconsistent intent.

## Verification performed
- Re-read the exact changed line ranges in `GameCard.tsx` after editing (lines 496–529) — confirmed no amber/orange code paths remain in the mask rendering.
- Repo-wide grep for `WHO IS THIS PLAYER`, `amber-7`, `amber-8`, `rgba(120, 53, 15` — remaining amber usages are unrelated error states and badges.
- `npm run check` (tsc) passes clean — this is the same gate Railway runs on deploy.
