# Score card contract (1080)

Locked Design spec for the PackPTS Daily 5 / Game Complete share card.

## Canvas
- Size: **1080 × 1080** PNG
- Background: `#0b0f16` with a soft blue radial glow from the top-right
- No 9:16 story crop. Square only.

## Content (actual session values — never fake)
- Eyebrow, top-left, all-caps: `DAILY 5`
- Score: **actual** `X/5` (example 3/5). The numerator is white; `/5` is grey. Never render a canned 4/5.
- Points under the score: `{score} pts` (example `525 pts`)
- Five rounded-square pips. The first **X** pips fill `#22C55E`; the rest are dark outlines.
- Headline from the session: `{LockedWord} locked. {OpenWord} open.`  
  Example for 3/5: `Three locked. Two open.`
- Footer left: masked-P mark (`#F5C518` bar through the P) + **PackPTS**
- Footer right: `packpts.com/daily`

## Brand
- Spelling: **PackPTS** (never PackPoints)
- Masked P only. No three-square mark.

## Fonts
- **Inter** (SIL OFL 1.1) ships in `server/contentFactory/assets/fonts/` and is copied into the Railway image.
- Do **not** rely on Alpine / Railway system fonts — they are absent and render tofu.
- Generator embeds the TTFs as `@font-face` data URIs **and** outlines every label to SVG paths so Sharp/librsvg never looks up a face.
- Required glyphs: session `X/5`, `{score} pts`, headline, **PackPTS**, `packpts.com/daily`.

## Delivery
- Generated server-side (SVG → PNG via sharp)
- Public URL: `/generated/share/{YYYY-MM-DD}/{assetId}.png`
- Production files write to the Railway volume `/app/data/masked-cards/generated/share/` (the `packpts` user cannot write `/app/public`)
- Visible on Game Complete within ~2s on mobile Safari when generation succeeds
