# Card Masking Redesign Plan

## Phase 1 Finding: Current Architecture

### What the user sees
- **Gray top bar** — 18% of card height, slate gradient (`from-slate-800 via-slate-700 to-slate-600`) with "MYSTERY CARD" label
- **Orange/amber bottom bar** — 38% of card height (y=62% to 100%), amber gradient (`from-amber-800 via-amber-700 to-amber-600`) with "WHO IS THIS PLAYER?" label

### Where it lives
**Entirely in `client/src/components/GameCard.tsx`** — pure CSS `<div>` overlays rendered on top of the raw CardHedge card image. No server-side image processing is involved in the game UI.

```
Game flow:  raw card imageUrl → <GameCard> → CSS overlay divs
```

Server-side masking (`server/masking/maskCardImage.ts`) is a separate pipeline used only for social media post composition — it never touches the game UI.

### Root cause of colored bars
`GameCard.tsx` lines 496–523 render two `<div>` elements with Tailwind gradient classes and text labels for the masked regions. These produce the solid colored bars the user sees.

---

## Phase 2: New Approach

Replace solid-color gradient overlays with CSS `backdrop-filter: blur()` overlays.

**How it works:**
- Keep the same positioned `<div>` mask elements
- Remove gradient background colors → use `rgba(0,0,0,0.25)` tint instead
- Add `backdropFilter: "blur(18px)"` to blur the underlying card pixels through the overlay
- Remove the "MYSTERY CARD" / "WHO IS THIS PLAYER?" text labels
- Optionally reduce the bottom region height (currently 38%) to target just the name area

**Result:** The card texture and colors remain visible, but the player name region appears as a frosted-glass blur — no orange, no gray, no solid bars.

---

## Phase 3–4: Implementation

Single file change: `client/src/components/GameCard.tsx`

Changes:
1. `DEFAULT_MASK_REGIONS` — change `type: "solid"` to `type: "blur"` for both regions; shrink bottom region (e.g., `yPct: 68, hPct: 32`)
2. Mask render block (lines 496–523) — replace gradient + text JSX with a simple translucent blur div

No server-side changes needed. No DB migrations. No new files.

---

## Phase 5: Verification criteria

- [ ] Orange/amber bottom bar is gone
- [ ] Gray/slate top bar is gone
- [ ] Card image is visible through frosted blur in both regions
- [ ] Player name is not legible through the blur
- [ ] Card reveals correctly (masks disappear on `isRevealed=true`)
- [ ] Works on mobile (check touch interactions)

---

## Phase 6: Rollback

Revert the `GameCard.tsx` changes — one file, no migrations, instant.
