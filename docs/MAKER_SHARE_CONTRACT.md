# Maker share contract (1080)

Locked Design spec for the PackPTS **I MADE THIS SET** share card.

This is maker voice (Sets Made / mixtape) — never a DAU flex, never a public Maker Rate brag.

## Canvas
- Size: **1080 × 1080** PNG
- Background: `#0b0f16` with a soft blue radial glow from the top-right
- Square only (same delivery path as the score card)

## Content (actual published set — never fake)
- Eyebrow, all-caps: `I MADE THIS SET`
- Hero: the maker’s **identified cards**, name-masked / redacted (brand mask regions, then the gameplay name band). Up to five cards fanned from the real photos. **No stock vector crowd / fan illustration.**
- Set name: the published `game_sets.set_name`
- Mixtape note: the published `maker_note` when present (quoted, truncated to fit — never invented)
- Card count: `{N} cards` where N is the real playable-card count on that set
- Footer left: locked masked-P mark (white P + gold `#F5C518` bar on `#0b0f16`) + **PackPTS**
- Footer right: `packpts.com/sets`

## Honesty (hard rules)
- Only data from the published set. No placeholder scores, no canned 4/5, no fake play counts.
- Do **not** render Maker Rate, DAU, “N makers”, or any gated public volume claim. Public Maker Rate / volume brags stay locked until ≥10 non-staff published sets; this card is the individual’s own set, not a platform brag.
- If a card has no photo, skip it. If none have photos, still render name + note + honest count — never substitute stock fans.

## Brand
- Spelling: **PackPTS** (never PackPoints)
- Masked P only. No three-square mark.

## Fonts
- **Inter** (SIL OFL 1.1) in `server/contentFactory/assets/fonts/`
- Outline every label to SVG paths (same as the score card). Do not rely on Railway system fonts.

## Delivery
- Generated server-side after `POST /api/sets/create` and collab publish (SVG → PNG via sharp)
- Public URL: `/generated/share/{YYYY-MM-DD}/{assetId}.png`
- Production writes to `/app/data/masked-cards/generated/share/`
- `content_assets.asset_type = MAKER_SHARE_CARD`, `source_event_id = maker_set_{setId}`
- Finish handlers await generation up to 1.5s and return `shareImageUrl`
