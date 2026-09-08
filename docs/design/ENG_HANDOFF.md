# ENG_HANDOFF — `/make` EMPTY_STATE + IDENTIFY_RETRY

Shipped Design mocks → client. Specs remain authoritative:
- `docs/design/EMPTY_STATE.md`
- `docs/design/IDENTIFY_RETRY.md`

Mocks (Design volume / session attachments):
- `make-empty-state-1080.png` — signed-in empty
- `make-identify-retry-1080.png` — sequential draft row

## Empty state (`entries.length === 0`)
Match mock, not Surface A share art.

| Zone | Implement |
|------|-----------|
| Canvas | Full-bleed `#0b0f16` (page, not a light-theme card) |
| Eyebrow | `SNAP-TO-SET` — muted `#8F96A3`, tracking wide |
| Headline | `Photo the stack. Name it. Publish.` — ink `#F0F2F5`, large bold |
| Subline | `Sample cards below — not your PC. Snap yours to start.` |
| Badge | Centered over stack: gold 40% border, gold `EXAMPLE · NOT YOUR PC` |
| Stack | **5** fanned sample cards. Cream + gold inner stroke. **One navy** mid-stack. Front card: `DESK` + silhouette + eye mask + `PTS` / `1990`. Soft drop shadow. CSS only. |
| Primary | Full-width fill `#2B6CEE` — `Take photo` |
| Secondary | Full-width dark fill, gray stroke — `Choose from library` |
| Soft auth | Signed-out only: `Sign in to photo your stack.` MAKE_FLOW intent unchanged. |
| Do not ship | Mock footer `Eng mock · …` |

Auth chrome (PackPTS mark / Signed in) is the existing app header — do not duplicate.

## Identify retry (draft row)
| Zone | Implement |
|------|-----------|
| Crumb | `/make · draft` (quiet, top-right of page column) |
| Eyebrow | `SNAP-TO-SET` muted |
| Headline | `Identifying your stack` |
| Subline | `One card at a time. Failed slots stay actionable — skip anytime.` |
| Board | Dark panel `Draft • N cards` + `Sequential` |
| Slots | Horizontal row. Thumb + title + status. |
| Success | Cream thumb, green check badge, title `{year} {brand}`, status `Saved` `#22C55E` |
| Identifying | Blue spinner on thumb, `Photo 0N`, `Identifying…` |
| Failed | Quiet gold 40% border, dark thumb, `Couldn't identify`, primary **Try again** `#2B6CEE`, **Skip** text under |
| Queued | Cream thumb, `Photo 0N`, `Queued` |
| Do not ship | Mock legend / `Eng mock · no alarm red…` |

No alarm red. No toast-per-failure. Sequential queue only (IDENTIFY_RETRY).

## Staff QA (no file picker)
Admin session + `?qaIdentifyFail=1` or `?qa=identify-fail` injects one Failed slot (`Couldn't identify` + Try again + Skip) so Design can screenshot IDENTIFY_RETRY without Auto-review / `/auth`. Non-admin: ignore silently. Optional one-shot storage: `packpts:make:qaIdentifyFail=1`.

## Out of scope
Wizard steps 2–3 (review / publish) keep existing chrome. Collab (“Make it together”) stays below empty CTAs, quiet. Identify / publish APIs unchanged.
