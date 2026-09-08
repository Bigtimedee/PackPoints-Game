# Maker share — locked eng spec (1080²)

Formal engineering spec for Surface A: post-publish **I MADE THIS SET** share art.
Do not wait on design review to implement. Collab / badge / rainy-Saturday templates are out of scope (P0 is `/make` after a successful publish).

## Trigger
Generate **only** after set publish succeeds (`POST /api/sets/create` returns a real `game_sets` row).
Not on draft, not mid-`/make` identify, not first DM, not collab publish (templates may remain there).

## Canvas
- **1080 × 1080** PNG, `#0b0f16` + soft blue radial glow (same delivery path as the score card)
- Fonts: bundled Inter, outlined to SVG paths (no Railway system fonts)

## Layout (acceptance)
| Zone | Content |
|------|---------|
| Header | `I MADE THIS SET` (all caps) |
| Title + note | `{Set name}` + `{mixtape note}` from the published row (never invented) |
| Stack | **3–8 of this set’s identified cards**, rendered as **masked cards in the same language as Daily 5** (`WHO IS THIS PLAYER?` name band, bottom 46%, `#0b0f16` @ 0.92). Prefer real thumbnails from published `card_photos`. |
| Mask failure | Cream masked silhouette **per card** (`#F3E6C8` body + Daily 5 name band). **NEVER** default the whole canvas to stock fan `maker-set-1080.png`. |
| Optional | `N sets made` — this maker’s real published-set count, **only** if the volume gate is unlocked |
| Footer | Masked-P + **PackPTS** + `packpts.com/sets/{setSlug}` |

## Stack rules
- Take `min(8, playable card count)` slots from the published set (publish already requires ≥5).
- Each slot is either a redacted thumbnail or a cream silhouette. Never drop a slot into a crowd/fan illustration.
- Masking floor = gameplay `DEFAULT_MASK_REGIONS` (yPct 54 / hPct 46) + Daily 5 label `WHO IS THIS PLAYER?`.

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
