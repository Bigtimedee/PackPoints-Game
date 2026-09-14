# SOCIAL_PNG_QA — share PNG tofu prevention gate

Prevention gate for live packpts.com / @PlayPackPTS share PNGs. Railway Alpine has no system fonts; Sharp/librsvg draws tofu for SVG `<text>` that relies on fontconfig.

Do **not** invent marketing creatives. Do **not** touch Design hotfix PNGs (`daily5-masked-1080-v2.png`, play-sets kit files, OG marks).

## 1. Fonts (required)

Railway/CI must never render share PNGs without fonts.

**Preferred for generated type:** bundled **Inter** outlined to SVG paths (`server/contentFactory/fonts.ts` `textToPath`) — same as score cards. `@font-face` base64 is belt-and-suspenders only.

**Also required:** DejaVu at a Design-listed or vendored path (`fonts-dejavu-core` **or** embed TTFs):

| Source | Regular | Bold |
|--------|---------|------|
| Vendored (repo) | `assets/fonts/DejaVuSans.ttf` | `assets/fonts/DejaVuSans-Bold.ttf` |
| Debian/Ubuntu `fonts-dejavu-core` | `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` | `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf` |
| Alpine `font-dejavu` | `/usr/share/fonts/dejavu/DejaVuSans.ttf` | `/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf` |

Inter ships in `server/contentFactory/assets/fonts/` (`Inter-Regular.ttf`, `Inter-SemiBold.ttf`, `Inter-Bold.ttf`).

**Fail the build/job** if Inter or DejaVu regular is missing (`assertShareFontsPresent`, `scripts/assert-share-fonts.ts`, hooked from `script/build.ts` and CI).

## 2. Runtime composers

| Path | Rule |
|------|------|
| `gameImageRenderer.ts` (@PlayPackPTS scheduler) | No `<text font-family="sans-serif">`. Outline Inter. |
| `generateScoreCard.ts` / maker-share / play-sets runtime | Already outlined Inter. Keep. |
| Design hotfix / kit PNGs | Serve as-is. Do not regenerate. |

## 3. Prefer Design-baked social exports when available

Drop: `packpts-design/social/exports/`  
Hosted copy (optional): `client/public/assets/social/`

`composePostImage` uses a Design PNG when the file exists; otherwise the outlined runtime composer. Copy-only — never generate a stand-in creative.

| Content type | Square 1080 | Story 1080×1920 (TikTok) |
|--------------|-------------|--------------------------|
| `LEADERBOARD_HIGHLIGHT` | `leaderboard-1080.png` | `leaderboard-story.png` |
| `STREAK_MILESTONE` | `streak-1080.png` | `streak-story.png` |
| `CHALLENGE` | `challenge-1080.png` | `challenge-story.png` |
| `NEW_USER_ACQUISITION` | `join-1080.png` | `join-story.png` |
| `REWARD_ANNOUNCEMENT` | `reward-1080.png` | `reward-story.png` |
| `TRIVIA_CARD` | `trivia-1080.png` | `trivia-story.png` |
| `MARKET_PRICE_SPOTLIGHT` | `market-1080.png` | `market-story.png` |

Missing files are OK. Inventing pixels is not.

## 4. Tests

`server/tests/gameImageRender.test.ts` fails if:

- a social SVG composer emits `<text>` / `sans-serif`
- rendered PNG text regions are blank/navy (tofu)
- `assertShareFontsPresent()` cannot resolve Inter + DejaVu
