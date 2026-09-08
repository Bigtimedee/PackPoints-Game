# Maker share — locked eng spec (1080²)

Formal engineering spec for Surface A: post-publish **I MADE THIS SET** share art.
Do not wait on design review to implement. Collab / badge / rainy-Saturday templates are out of scope (P0 is `/make` after a successful publish).

## Trigger
Generate **only** after set publish succeeds (`POST /api/sets/create` returns a real `game_sets` row).
Not on draft, not mid-`/make` identify, not first DM, not collab publish (templates may remain there).

## Canvas
- **1080 × 1080** PNG, `#0b0f16` + soft blue radial glow (same delivery path as the score card)
- Fonts: bundled **Inter**, outlined to SVG paths; **DejaVu Sans** is the documented fallback (Railway Alpine has neither — Inter ships in-repo)
- Design tokens live in `server/contentFactory/makerShareAssets.ts` (crop, cream, bar, grid). v1 ships without Design polish; swap tokens there, do not block on a pass.

## Layout (acceptance) — v1 compose
| Zone | Content |
|------|---------|
| Header | `I MADE THIS SET` (all caps) |
| Title + note | `{Set name}` + `{mixtape note}` from the published row (never invented) |
| Cards | **Prefer 3–8** of this set’s identified cards as a **grid** (1 row ≤4; 2 rows for 5–8). Per-card thumb: **card-aspect (2.5×3.5) or square** crop, **masked** (cream + **black** `#000000` redaction bar, or product mask pipeline). Inputs = whatever `/make` identify already stores (**JPEG/WebP**; HEIC normalized upstream). |
| Mask failure | **Per missing mask:** cream silhouette + black redaction bar. **NEVER** default the canvas to stock fan `maker-set-1080.png`. |
| Optional | `N sets made` — this maker’s real published-set count, **only** if the volume gate is unlocked |
| Footer | Masked-P + **PackPTS** + `packpts.com/sets/{setSlug}` |

## Card rules
- Take `min(8, playable card count)` slots from the published set (publish already requires ≥5).
- Each slot is either a redacted JPEG/WebP/PNG thumbnail or a cream silhouette. Never drop a slot into a crowd/fan illustration.
- Masking floor = gameplay `DEFAULT_MASK_REGIONS` (yPct 54 / hPct 46) + Daily 5 label `WHO IS THIS PLAYER?` + solid black name bar.

## Honesty / gate
- Only real published set data. No fake counts, no canned scores.
- **Volume gate:** public Maker Rate / platform volume brags stay locked until **≥10 non-staff** (`users.is_admin = false`) published user-created sets.
- When the gate is closed: omit Sets Made and every Maker Rate / DAU / “N makers” line.
- When the gate is open: optional personal `N sets made` (this maker’s count) is allowed. Still never render Maker Rate %.

## Delivery
- `content_assets.asset_type = MAKER_SHARE_CARD`, `source_event_id = maker_set_{setId}`
- Write to `/app/data/masked-cards/generated/share/` (prod) or `public/generated/share/` (local)
- Public URL `/generated/share/{YYYY-MM-DD}/{assetId}.png`
- Publish handler awaits up to 1.5s and returns `shareImageUrl`
- `setSlug` = kebab-case set name (≤32) + `-` + first 8 hex chars of the set id (no dashes)

## Non-goals (not Surface A)
- Collab publish share art
- Badge / rainy-Saturday campaign templates
- Unlocking public Maker Rate on marketing surfaces
