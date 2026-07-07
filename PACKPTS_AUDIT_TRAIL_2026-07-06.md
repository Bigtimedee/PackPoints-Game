# PackPTS Audit Trail — Session of July 6, 2026

Plain-language record of every change made this session, why it was made, and how it was verified. Intended to be readable by anyone (investor, acquirer diligence, future engineer).

## Code changes

### 1. Card name mask: orange → blur
- **File:** `client/src/components/GameCard.tsx` (lines ~496–529)
- **What:** The bottom "name band" overlay on every game card previously showed either an amber/orange gradient (when configured as `solid`) or an orange-brown tint over a light 12px blur (when configured as `blur`). Both orange treatments were removed. The name band now always renders as a heavy 24px backdrop blur with a subtle neutral dark tint and the existing "WHO IS THIS PLAYER?" label, regardless of the configured mask type.
- **Why:** UX quality — the orange mask looked like a defect covering the card; a blur preserves the card's aesthetic while keeping the name unreadable.
- **Scope:** `GameCard` is the single card renderer used by solo play (`game.tsx`), Daily 5 (`daily5.tsx`), and 1v1 matches (`match.tsx`), so this one change covers all game modes.
- **Anti-cheat impact:** None. The server bakes an unrecoverable sigma-25 blur into the served image (`server/masking/maskCardImage.ts`); the client overlay is presentational.
- **Verification:** Changed lines re-read after edit; repo-wide search confirmed no remaining orange/amber mask code paths; `npm run check` (TypeScript, the same gate Railway runs) passes.

### 2. PWA / iOS home-screen support
- **Files:** `client/index.html` (new meta tags), `client/public/manifest.webmanifest` (new), `client/public/apple-touch-icon.png`, `icon-192.png`, `icon-512.png` (new, generated from the existing 128px favicon).
- **What/why:** The site previously had no web manifest, no apple-touch-icon, and no theme color, so "Add to Home Screen" produced a generic, browser-chromed experience. Now installs as a standalone dark-themed app on iOS/Android — an immediate retention stopgap while the native iOS app is built, and a prerequisite for iOS web push.
- **Known limitation:** Icons are upscaled from a 128px source. Replace with exports from high-resolution logo artwork; App Store will require a 1024×1024 master.
- **Verification:** Included in the passing `npm run check`; manifest/icon paths match Vite's `client/public` static root.

### 3. Project context updated (required by repo policy)
- **File:** `PACKPTS_PROJECT_CONTEXT.md` §7 (masking) — documents the new name-band rendering behavior, per the CLAUDE.md rule that behavior changes update the context file in the same commit.

## Documents produced (no behavior change)
- `PACKPTS_UIUX_AUDIT.md` — full UI/UX audit: what was fixed, plus a prioritized P1–P3 backlog (dead `MaskedCardImage.tsx` component, device QA pass for the blur on iOS Safari, `game.tsx` refactor, reveal-moment animation, onboarding re-fire issue, and more).
- `PACKPTS_IOS_READINESS_2026-07-06.md` — current-state assessment against the existing `iOS-Adaptation-Plan.md`: native build not started; blockers (JWT auth, Apple IAP, APNs, Sign in with Apple) unchanged since March; dependency-ordered next steps.
- `PACKPTS_MARKETING_BRAND_CONTENT_PLAN.md` — umbrella brand/marketing/content strategy tying together the existing growth, social, Reddit, and monetization docs; defines brand pillars, the rotating incentive calendar, three-layer content architecture (including the "Hobby Attention Index" acquisition-narrative asset), KPIs, and acquisition-readiness checklist.

## Deployment notes
- No database migrations required. No environment variable changes. No API changes.
- Ships via the normal path: Dave pushes to `main` → Railway auto-deploys. Verify via the `/api/version` canary before visually testing the blur in production.
- Pre-existing untracked items in the working tree (`engineering/`, `public/generated/`) were NOT touched or committed by this session.
