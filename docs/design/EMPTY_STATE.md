# Design EMPTY_STATE — `/make` (no draft cards)

Eng-ready contract for Snap-to-Set when the maker has no draft cards yet.
This is **not** the Game Complete score-card empty state (`docs/EMPTY_STATE.md`).
Do not reuse Surface A maker-share art (`docs/MAKER_SHARE_CONTRACT.md`) as empty chrome.

Auth-before-upload stays **MAKE_FLOW**: signed-out tap still stores intent and redirects to `/auth?redirect=/make`. Soft copy only changes.

## When
`/make` step 1 and `entries.length === 0` (no photos in the current draft).

## Copy (locked)
| Slot | Text |
|------|------|
| Eyebrow | `SNAP-TO-SET` |
| Headline | `Photo the stack. Name it. Publish.` |
| Subline | `Sample cards below — not your PC. Snap yours to start.` |
| Example badge | `EXAMPLE · NOT YOUR PC` |
| Primary CTA | `Take photo` |
| Secondary CTA | `Choose from library` |
| Soft auth (signed out) | `Sign in to photo your stack.` |

## Example stack (match `make-empty-state-1080.png`)
- Quiet **example** PC stack: **5** fanned cards. Cream + gold inner stroke; **one navy** mid-fan.
- Front card: `DESK` + silhouette + eye-mask bar + `PTS` / `1990` footer. Soft drop shadow.
- Badge centered above the fan: `EXAMPLE · NOT YOUR PC` (gold 40% stroke).
- Clearly **not** the user’s published set.
- **Never** mount Surface A share PNG, `maker-set-1080.png`, or `<ShareAssetCard>` as empty chrome.
- Eyebrow is muted `#8F96A3` (not gold). CTAs are full-width stacked: fill `#2B6CEE` + dark outline.

## Actions
- Primary **Take photo** — existing camera file input (`capture=environment`, single still).
- Secondary **Choose from library** — existing multi library input (cap 20).
- Signed-out: same `packpts:make:pendingIntent` resume as MAKE_FLOW.

## Brand
- Canvas `#0b0f16` · ink `#F0F2F5` · muted `#8F96A3` · gold `#F5C518`
- Green `#22C55E` and blue `#2B6CEE` only sparingly (CTAs / success elsewhere)
- No **PackPoints** spelling, no FOMO, no Maker Rate or volume claims.

## Non-goals
- Changing identify / publish API contracts
- Unlocking Maker Rate
- Replacing collab (“Make it together”)
