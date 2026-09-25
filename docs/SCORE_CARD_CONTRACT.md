# Score card contract (1080)

Locked Design spec for the PackPTS Daily 5 / Game Complete share card.

## 1. Canvas
- Size: **1080 × 1080** PNG
- Background: `#0b0f16` with a soft blue radial glow from the top-right
- No 9:16 story crop. Square only.

## 2. Content (actual session values — never fake)
- Eyebrow, top-left, all-caps: `DAILY 5`
- Score: **actual** `X/5` (example 3/5). Numerator ink `#F0F2F5`; `/5` muted `#8F96A3`. Never render a canned 4/5.
- Points under the score: `{score} pts` (example `525 pts`)
- Optional real streak under points: `{n}-day streak` in muted `#8F96A3`. Omit when streak is missing or 0 — never invent one.
- Five rounded-square pips. The first **X** pips fill `#22C55E`; the rest are dark outlines.
- Headline from the session: `{LockedWord} locked. {OpenWord} open.`  
  Example for 3/5: `Three locked. Two open.`
- Footer left: locked masked-P mark — **white P** + gold (`#F5C518`) bar on dark (`#0b0f16`) tile (not yellow-P-on-white) + **PackPTS**
- Footer right: `packpts.com/daily` (visual only — Beat-me share href is the signed `/daily?utm_source=share&utm_medium=beatme&utm_campaign=daily5&challenge=` token)

## Other modes (solo / 1v1)

Same 1080 canvas, pips, and PackPTS mark. Branding follows **`mode === "daily5"`**, never `total === 5`:

- Eyebrow: `SOLO` or `1V1 MATCH` — never `DAILY 5` for a 5-card solo
- No `TODAY'S FIVE`. The server SVG has no decorative mini strip (that strip is Daily 5 only).
- Footer right: `packpts.com` (not `/daily`)
- **Skips:** never fold `dealt − skipped` into a silent pip row. Dave’s 10-card solo with 1 skip (screenshot: Game Complete `6 of 9` + “1 card skipped”, share PNG `6/9` / `Six locked. Three open.`) keeps scored `6/9` and paints **10 pips** (6 locked `#22C55E`, 1 skipped muted outline + gold bar, 3 open) plus muted `1 skipped` under pts (with streak: `1-day streak · 1 skipped`). Accuracy stays 6/9 = 67%. Footer is `packpts.com`.

## Palette (Design Sync)
- Canvas `#0b0f16` · gold `#F5C518` · green `#22C55E` · ink `#F0F2F5` · muted `#8F96A3`

## 3b. Today identity (America/Chicago CT day key, session-day only)

Quiet header identity for the session's PackPTS day — never "now", never a different day's five.

- Day key: **America/Chicago** via `shared/packptsDay.ts` (`getPackptsDayKey()`), same as Daily 5 / streak / Beat-me `puzzle_day`.
- **Top-right**, all-caps muted: `{MON} {D} · TODAY'S FIVE`  
  Example: `SEP 8 · TODAY'S FIVE`
- `TODAY'S FIVE` only when `mode === "daily5"`. Other modes show the session date alone.
- YYYY-MM-DD session dates format as that calendar day (do not UTC-shift).
- **Optional mini masked-strip** under `DAILY 5`: five cream (`#F0F2F5`) tiles, each crossed by a gold (`#F5C518`) redaction bar (same strip language as `daily5-masked-1080-v2.png`).
- **Client thumbs (2026-09-25):** `ShareAssetCard` paints the session's real masked `/api/play/m/` images over that band before show, download, and native share (solo and Daily 5). Plaque look, session order. A failed or canvas-tainting load drops that tile. Never `/api/images/card` or `/api/play/r/`. Mode label, date, scored denominator, and footer stay on the server PNG (`packpts.com/daily` only for Daily 5). The client does not hardcode that footer.
- Honesty: session `X/5` only. A 3/5 finish stays 3/5.

## Brand
- Spelling: **PackPTS** (never PackPoints)
- Masked P only (white P + gold bar). No three-square mark.

## Fonts
- **Inter** (SIL OFL 1.1) ships in `server/contentFactory/assets/fonts/` and is copied into the Railway image.
- Do **not** rely on Alpine / Railway system fonts — they are absent and render tofu.
- Generator embeds the TTFs as `@font-face` data URIs **and** outlines every label to SVG paths so Sharp/librsvg never looks up a face.
- Required glyphs: session `X/5`, `{score} pts`, `{n}-day streak`, date / `TODAY'S FIVE`, headline, **PackPTS**, `packpts.com/daily` (Daily 5) or `packpts.com` (solo/1v1).

## Delivery
- Generated server-side (SVG → PNG via sharp)
- Public URL: `/generated/share/{YYYY-MM-DD}/{assetId}.png`
- Production files write to the Railway volume `/app/data/masked-cards/generated/share/` (the `packpts` user cannot write `/app/public`)
- Visible on Game Complete within ~2s on mobile Safari when generation succeeds
