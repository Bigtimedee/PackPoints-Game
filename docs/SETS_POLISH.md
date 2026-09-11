# Sets polish — locked Design contract

Formal engineering spec for Goldin-quiet `/sets` (index) and `/sets/:id` (detail).
ICP: Obsessive Maker-Collector. Auction-house quiet (Goldin), not casino.

Mocks: `sets-index-polish.png`, `sets-detail-polish.png`.

## Brand

| Token | Hex | Use |
|-------|-----|-----|
| Canvas | `#0b0f16` | Page surface |
| Ink | `#F0F2F5` | Titles |
| Muted | `#8F96A3` | Meta, cues |
| Gold | `#F5C518` | Accent only (short-shelf rule, FAN MADE outline) |
| Green | `#22C55E` | Not required on these pages |
| Blue | `#2B6CEE` | Play CTAs, sparingly |

Mark: PackPTS + masked-P only. No glossy shield, no PackPoints currency chrome, no three-square tiles, no neon.

## Index `/sets`

- Eyebrow `SETS`
- H1 `Sets`
- Sub `Play sets already in PackPTS.`
- Honest `{n} sets` count of the live published list (never a padded inventory number)

### Cards

- **Cover priority:** runtime Surface A share crop (`shareImageUrl`) when present and not stock fan `maker-set-1080.png`. Else a **masked stack of that set’s cards**. Never keep a stock fan once the runtime cover exists.
- Meta: set name · `by {maker}` · honest `{n} cards` · optional `{MON D}` (America/Chicago via `shared/packptsDay.ts`) · `AUTHORED`
- Play CTA: blue `#2B6CEE`
- Do not render play count, Maker Rate, trending, or vanity tiles

### Sparse shelf

When published set volume is below the public gate (**10**), show a quiet banner:

> **A short shelf.** Integrated sets only — play what’s here, or open Daily 5.

Never fake inventory. Never publish Maker Rate / DAU / “N makers” here. The gate matches admin `publishedSetsNonStaff` diligence (≥10 non-staff); the public page only sees the honest list length, not the admin metric.

Product lock (2026-09-08): no public **Make a set** CTA. Footer action: **Play Daily 5** (quiet outline). `/make` is staff-only.

## Detail `/sets/:id`

- Provenance: title, `by {maker}` · optional date (same America/Chicago `{MON D}` as index) · `AUTHORED`, gold-outline `FAN MADE` if user-created
- Mixtape note in a quiet quoted panel (real `makerNote` only)
- Play + honest `{n} Cards` pill
- Optional muted `Play today’s stack` **only if this visitor has not already played this set today** (America/Chicago). No clocks, no “hurry”, no “come back tomorrow”
- Cover priority same as index. Caption: `Share cover · runtime Surface A` when Surface A is shown
- **THE STACK:** staggered preview of this set’s cards (masked). Cream silhouette + redaction bar if a photo is missing. Never player names in copy, alt, or payload
- Share · Copy link · muted `packpts.com/sets/{slug}`
- Share/copy href is `https://packpts.com/sets/{slug}?utm_source=share&utm_medium=play_sets&utm_campaign=integrated` (never `/make`). Display line stays the quiet canonical without UTMs.
- **Cover / OG priority:** runtime Surface A (or play-sets runtime crop) when present and not stock fan `maker-set-1080.png`. Kit templates (`/assets/play-sets/*.png`) are Marketing cold posts / placeholders only — do not substitute kit A for a real set’s runtime cover. Story crops: `/assets/play-sets/play-set-story.png`, `play-shelf-story.png`, `play-beatme-story.png`. Contract: `docs/PLAY_SETS_SHARE.md`.
- Do not lead with `0 Times Played` or any play-count vanity tile
- No PackPoints balance chrome on this page

## API (minimal)

`GET /api/sets` and `GET /api/sets/:id` already expose honest `cardCount`. Both emit `createdAt` as ISO UTC (browse maps raw pg timestamps via `createdAtToIso`). Authored `{MON D}` is America/Chicago (`formatPackptsMonDay`). Add:

- `shareImageUrl` on the browse list (same `content_assets` lookup as detail)
- `coverCardUrls` (browse) / `previewCards: { imageUrl, year }[]` (detail) — **no player names**
- `playedToday` on detail when the session can resolve a user; guests are `false`

`playCount` may remain on the JSON for existing callers; public `/sets` UI must not render it.

## Honesty / gate

- Public Maker Rate / platform volume claims stay locked until **≥10 non-staff** published user-created sets
- Short-shelf copy is the only volume language allowed below the gate
- Play starts with `totalQuestions = clamp(cardCount, 5, 20)` — the set’s real stack, not a hardcoded 10

## Non-goals

- Public Maker Rate
- Trending / times-played leaderboards
- Currency chrome on browse/detail
- Changing Surface A compose (see `docs/MAKER_SHARE_CONTRACT.md`)
