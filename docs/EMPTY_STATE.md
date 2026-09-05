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
- Secondary **Share without card** — underlined text. Native share or clipboard of the text + `https://packpts.com/daily` (no image)

## Visual
- Dark panel `#0b0f16`
- Masked-P mark (yellow bar `#F5C518`) above the title
- No Lucide `Image` / mountain-sun icon
- Square preview area (matches the 1080 card)

## Results chrome (Daily 5 / 5-card Game Complete)
- Trophy
- `Game Complete`
- `DAILY 5`
- Three stats: `{pts} PTS` · `{accuracy}% ACCURACY` · `{X} of {5} SCORE`
