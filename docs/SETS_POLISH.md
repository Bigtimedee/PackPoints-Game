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
| Gold | `#F5C518` | Accent only (FAN MADE outline) |
| Green | `#22C55E` | Not required on these pages |
| Blue | `#2B6CEE` | Play CTAs, sparingly |

Mark: PackPTS + masked-P only. No glossy shield, no PackPoints currency chrome, no three-square tiles, no neon.

## Index `/sets`

- Eyebrow `SETS`
- H1 `Sets`
- Sub `Play sets already in PackPTS.`
- Honest `{n} sets` count of the live published list (never a padded inventory number)

### Cards

- **Cover priority:** runtime Surface A share crop (`shareImageUrl`) when present and not stock fan `maker-set-1080.png`. Else a **masked stack** of the valid pinned covers only (`server/config/pinnedCovers.ts`, at most 8, in that order). Each thumb is a baked `/api/sets/{setId}/covers/{slot}` JPEG. No raw photo URL, player name, or card id. With 1 to 8 covers, the fan closes up and spreads those covers evenly. No empty slot and no gray card. If no pick or alternate passes, the tile does not render a cover slot. It shows the set name, the year label, and Play this set. No cream card, gray box, card count, or placeholder line. The plaque on a real thumb is decoration. Never keep a stock fan once the runtime cover exists. Never bake a mask while listing `/sets`. `SETS_COVERS_DISABLED` hides covers even when pins are valid.
- Meta for an integrated set: honest `{n} cards` only. No `by Maker`, no date, no `AUTHORED`.
- Meta for a user-created set that still has a maker username: `by {maker}` · honest `{n} cards` · optional `{MON D}` (America/Chicago via `shared/packptsDay.ts`) · `AUTHORED`
- Title: the stored set name. If `brand` is set and the name does not already contain it, insert the brand after a leading year (`2024 Basketball` + brand `Topps` → `2024 Topps Basketball`). A blank brand leaves the stored name. Do not substitute the `year` column for the year already in the name. `shared/setDisplayOverride.ts` can replace the player-facing title and year label for a set id. Set `229f0379-aa56-40a8-abe3-1af217a397e8` shows `2024-25 Topps Chrome Basketball` and year label `2024-25`. The stored row stays `2024 Basketball` / year 2025.
- Fanned card thumbs (no Surface A cover): the name plaque is a solid bar with the gold seam and no label text. The in-game card, the baked mask, and reveal stay as they are.
- Play CTA: blue `#2B6CEE`, label `Play this set`. Starts that set's solo game (same flow as detail Play).
- Do not render play count, Maker Rate, trending, or vanity tiles
- Do not show a short-shelf banner. The honest `{n} sets` line is the list length only. Do not add a playable-card total.

### Shelf length

Never fake inventory. Never publish Maker Rate / DAU / “N makers” here. Admin `publishedSetsNonStaff` diligence (≥10 non-staff) stays an admin metric. The public page only sees the honest list length.

Product lock (2026-09-08): no public **Make a set** CTA. Footer action: **Play Daily 5** (quiet outline). `/make` is staff-only.

## Detail `/sets/:id`

- Provenance on a user-created set: title, `by {maker}` · optional date (same America/Chicago `{MON D}` as index) · `AUTHORED`, gold-outline `FAN MADE`
- Integrated sets omit the maker line, the date, and `AUTHORED`. No `FAN MADE` tag.
- Mixtape note in a quiet quoted panel (real `makerNote` only)
- When valid pinned covers exist: Play + honest `{n} Cards` pill. When they do not, or `SETS_COVERS_DISABLED` is on: the set name, the year label, and a full-width Play. No placeholder cards, gray boxes, card count, or coming soon.
- Optional muted `Play today’s stack` **only if this visitor has not already played this set today** (America/Chicago). No clocks, no “hurry”, no “come back tomorrow”
- Cover priority same as index. Caption: `Share cover · runtime Surface A` when Surface A is shown
- **THE STACK:** staggered preview of the valid pinned covers (masked), same even fan as the index. Fanned thumbs use the same solid plaque and gold seam, with no label text. The stack is omitted when there are no valid covers. Never player names in copy, alt, or payload
- Share · Copy link · muted `packpts.com/sets/{slug}`
- Share/copy href is `https://packpts.com/sets/{slug}?utm_source=share&utm_medium=play_sets&utm_campaign=integrated` (never `/make`). Display line stays the quiet canonical without UTMs.
- **Cover / OG priority:** runtime Surface A (or play-sets runtime crop) when present and not stock fan `maker-set-1080.png`. Kit templates (`/assets/play-sets/*.png`) are Marketing cold posts / placeholders only — do not substitute kit A for a real set’s runtime cover. Story crops: `/assets/play-sets/play-set-story.png`, `play-shelf-story.png`, `play-beatme-story.png`. Contract: `docs/PLAY_SETS_SHARE.md`.
- Do not lead with `0 Times Played` or any play-count vanity tile
- No PackPoints balance chrome on this page

## API (minimal)

`GET /api/sets` lists active integrated sets (`is_user_created = false`) with at least 5 eligible cards. `cardCount` is that eligible count (same predicate as `GET /api/playable-sets` and the solo deal), after name/year/sport dedupe that keeps the most playable row. User-created sets are not listed. `GET /api/sets/:id` uses the same eligible `cardCount`. Both emit `createdAt` as ISO UTC (browse maps raw pg timestamps via `createdAtToIso`). Authored `{MON D}` is America/Chicago (`formatPackptsMonDay`) and only renders for a user-created set with a maker username. Add:

- `shareImageUrl` on the browse list (same `content_assets` lookup as detail)
- `coverCardUrls` (browse) / `previewCards: { imageUrl, year }[]` (detail) are the valid pinned masked cover URLs only, in pin order, or empty for the hidden state. No raw image URL, player name, or card id. `GET /api/sets/:setId/covers/:slot` serves the baked file and does not bake.
- `playedToday` on detail when the session can resolve a user; guests are `false`

`playCount` may remain on the JSON for existing callers; public `/sets` UI must not render it.

## Honesty / gate

- Public Maker Rate / platform volume claims stay locked until **≥10 non-staff** published user-created sets
- The index does not advertise how short the shelf is, and it does not publish a card total
- Play starts with `totalQuestions = clamp(cardCount, 5, 20)` — the set’s real stack, not a hardcoded 10

## Non-goals

- Public Maker Rate
- Trending / times-played leaderboards
- Currency chrome on browse/detail
- Changing Surface A compose (see `docs/MAKER_SHARE_CONTRACT.md`)
