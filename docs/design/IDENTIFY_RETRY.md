# Design IDENTIFY_RETRY — `/make` draft-row sequential identify

Eng-ready contract for a failed identify slot in the Snap-to-Set draft row.
Pipeline stays sequential (one identify at a time). A failure must not block later slots.

## Slot states (locked labels)
| Status | Label | Chrome |
|--------|-------|--------|
| `queued` | `Queued` | Quiet / muted |
| `loading` | `Identifying…` | Spinner + muted |
| `ok` | `Saved` | Green check `#22C55E` on thumb + `{year} {brand}` |

Draft chrome (match `make-identify-retry-1080.png`): headline `Identifying your stack`; subline `One card at a time. Failed slots stay actionable — skip anytime.`; board `Draft • N cards` + `Sequential`. Failed: gold 40% border, **Try again** `#2B6CEE` over **Skip** text.
| `error` | `Couldn't identify` | Quiet border (optional gold at 40%) |

## Failed slot
- Primary tap: **Try again** — re-runs identify on that file (or a replacement still). Queues behind the in-flight slot; do not parallelize.
- **Skip** stays available — removes the slot immediately. Sequential queue is not blocked.
- Do **not** use alarm red, destructive toasts per failure, or FOMO copy.
- Rate-limit / auth detail may sit under the label in muted ink. No toast-per-failure.

## Pipeline
- New library / camera stills identify **one after another** (existing rate-limit + MAKE_FLOW sequential rule).
- Skip or fail on slot N does not pause slot N+1.
- Try again while another slot is identifying: mark `Queued`, drain after the current call.

## Brand
- Canvas / page tokens as EMPTY_STATE: ink `#F0F2F5`, muted `#8F96A3`, gold `#F5C518` at 40% on the fail border.
- Success check `#22C55E` only. No red error flash.

## Staff QA (Design screenshot, no upload)
Staff/admin (`users.is_admin`) can seed **one** Failed slot without calling identify:

- `https://packpts.com/make?qaIdentifyFail=1`
- `https://packpts.com/make?qa=identify-fail`
- One-shot `sessionStorage` / `localStorage` key `packpts:make:qaIdentifyFail` = `1` (consumed after inject)

Non-staff: param and storage are ignored with no toast, redirect, or empty-state change. **Try again** on the QA stub stays Failed (no identify). **Skip** removes the slot. Dev-only `#design-retry` still seeds the four-state mock row.

## Non-goals
- Parallel identify
- Changing `POST /api/sets/identify-card` or publish gates (≥5 ok cards)
