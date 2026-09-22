# Admin set-delete toast + honesty craft (#107)

Source of truth for PackPTS admin Playable Sets hard-delete feedback.
Tone: Goldin-quiet. No FOMO. No opaque "Delete failed." PackPTS spelling only.

## Live baseline (Eng #107 GREEN)

- Cascade delete works; Prizm `80996291-…` removed.
- Pre-delete honesty: Cards = COUNT(*) playable_cards (e.g. 2,735), real Last Import.
- Success toast today: "Set deleted — The game set has been permanently removed"
- Blockers: HTTP 409 + Postgres constraint text surfaced in toast.

Eng proof: `/workspace/packpts-e2e-cashback/set-delete-107/`

## Locked copy (Design)

### Confirm modal (keep structure; tighten numbers)

- Title: `Delete Game Set`
- Body: `Permanently delete "[Set Name]"? This will hard-delete the set and [N] stored cards. This cannot be undone.`
  - Use the honest card count (COUNT(*) playable_cards), never a gameplay-filtered zero.
  - Prefer "stored cards" over "imported cards" when import may be partial.
- Bullets stay as shipped (remove from table + play; delete playable cards + import records; cannot reverse).
- Primary: `Delete permanently` (danger red). Secondary: `Cancel`.

### Success toast

- Title: `Set deleted`
- Description: `"[Set Name]" and [N] stored cards are gone.`
  - If N is unknown after success, fall back to: `The game set has been permanently removed.`
- Never celebrate. No confetti. Auto-dismiss ~4s.

### Blocked delete (409 / constraint)

- Title: `Can't delete yet`
- Description (prefer API `message` / constraint text, trimmed to one line):
  - Import in flight: `Import is still running. Wait for it to finish, then try again.`
  - FK / dependents (if API returns raw Postgres): show the humanized Eng message first; if only constraint text, show it truncated, not "Delete failed".
- Never: `Delete failed`, `Something went wrong`, bare 500.

### List honesty labels (already Eng; Design lock)

- Cards column: always `COUNT(*)` playable_cards → `[N] cards` / `0 cards` only when truly zero rows.
- While import active: badge `Import in progress` (quiet amber), not Active green.
- Last Import: real timestamp or `Never imported` only when zero playable_cards AND no import job history.

## Hard rules (never regress)

1. Admin card counts and delete confirm copy must use the same source of truth as the FK that blocks delete (playable_cards), never a gameplay filter that can show 0 while rows exist.
2. Never show opaque `Delete failed` / generic 500 toast for hard-delete. Always actionable title + one-line reason (409 message or humanized constraint).
3. Success toast names the set when possible; stays quiet (no FOMO, no bonus language).
4. Confirm modal must state the honest card count before delete.
5. Toast craft is Design-owned; Eng owns API status codes and message strings Design maps into the toast shell.

## Eng handoff

Map toast shell to API:

| Case | Status | Title | Description source |
|------|--------|-------|--------------------|
| OK delete | 200/204 | Set deleted | Design success line + optional N |
| Import lock | 409 | Can't delete yet | Eng import-in-progress message |
| Other constraint | 409 | Can't delete yet | Eng Postgres/humanized text |
| Auth / network | * | Can't delete yet | `Check your connection and try again.` |

No new visual chrome required beyond existing sonner/toast system. Keep PackPTS admin dark theme.

## Implementation

Client craft: `client/src/lib/gameSetDeleteToast.ts` (`gameSetDeleteSuccessToast`, `gameSetDeleteBlockedToast`, `gameSetDeleteConfirmBody`). Wired from `/admin/playable-sets`. Tests: `client/src/lib/__tests__/gameSetDeleteToast.test.ts`.
