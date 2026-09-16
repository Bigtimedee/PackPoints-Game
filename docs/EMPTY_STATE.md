# Score card empty state

Locked Design spec for Game Complete when the shareable score card cannot be shown.

## Hard rules
- Never mount `<img>` with an empty, missing, or invalid `src`
- On load error, unmount the image and show this empty state (no browser broken-image glyph)
- Points / accuracy / X of 5 stay on the results screen — they are already saved

## Copy
- Title: `Score card didn’t load.`
- Sub: `Your points are saved. Try again.`

## Actions
- Primary **Retry** — fill `#2B6CEE`, white label. Calls `POST /api/content-assets/retry` then re-fetches the card
- Secondary **Share without card** — underlined text. Native share or clipboard of the text + the mode CTA (`https://packpts.com/daily` for Daily 5 / Beat-me; `https://packpts.com` for solo/1v1). Never hardcode `/daily` on a solo score.

## Visual
- Dark panel `#0b0f16`
- Masked-P mark (yellow bar `#F5C518`) above the title
- No Lucide `Image` / mountain-sun icon
- Square preview area (matches the 1080 card)

## Results chrome
- Daily 5 Game Complete: Trophy, `Game Complete`, eyebrow **`DAILY 5`**, `{X} of {5}`
- Solo / 1v1 Game Complete: never labeled Daily 5, even when the session is 5 cards. Use the set name (solo) or match copy (1v1).
