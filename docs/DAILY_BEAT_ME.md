# Daily 5 “Beat me” URL contract

Share/challenge after Daily 5 Game Complete is a **product loop**, not a PNG or caption. The recipient opens **today’s** Daily 5 with the challenger’s real session score.

## Timezone lock

Beat-me `puzzle_day`, the Daily 5 day key / challenge window, and streak “today” all use **`America/Chicago` (CT)**.

- Day key: `YYYY-MM-DD` from `getPackptsDayKey()` in `shared/packptsDay.ts`
- Daily 5 `startsAt` / `endsAt` for a date are CT midnight → next CT midnight (`getDailyStartEnd`). Load and `updateChallengeStatuses` rewrite stored UTC-midnight windows and derive ACTIVE/SCHEDULED/CLOSED from now.
- Stale check: token `puzzle_day === getPackptsDayKey()` (same CT key)
- Do **not** use America/New_York, UTC calendar dates, or a second feature TZ

## Canonical URL

```
https://packpts.com/daily?utm_source=share&utm_medium=beatme&utm_campaign=daily5&challenge={token}
```

`/daily` and `/daily5` render the same page. Build and share **`/daily`**.

| Param | Required | Meaning |
|-------|----------|---------|
| `challenge` | yes | Server-signed token (`v1.{payload}.{hmac}`) |
| `utm_*` | yes on share | `share` / `beatme` / `daily5` |

Token payload (HMAC-SHA256 with `SECRET_SALT`):

| Field | Meaning |
|-------|---------|
| `s` | Challenger’s **real** session correct-count (`0`–`5`) |
| `d` | `puzzle_day` — CT Daily 5 day key |
| `n` | Optional username |
| `u` | Optional challenger user id |

TTL = that CT day key. If `d` is not today’s CT key → **stale**. Recipient still plays today’s five cards.

## Honesty

- Tokens are issued only by `POST /api/daily5/beat-me` after a completed entry for **today’s CT** Daily 5. The client cannot supply a score.
- Never invent scores, streaks, ranks, or kit `4/5`.
- Invalid token → normal `/daily` (no banner).

## Recipient UI

- Active: `Beat {name}. They went {score}/5 today` (no username → `a collector`). Quiet bar, not a neon toast. Dismiss hides the bar for the session; play continues.
- Stale: `Challenge expired. Play today's five.` Do not show yesterday’s score as live.
- Invalid token: no banner. Normal Daily 5.
- After the recipient finishes an **active** challenge only:
  - You led: `You went X/5. They went Y/5.`
  - Tie: `Tied at N/5.`
  - They led: `They led, Y/5 to your X/5.`
- Optional after that compare: `Want more?` + **Browse sets** → `/sets`. No Maker Rate. No `/make` publish.

## Challenger UI

Game Complete primary CTA is **Beat me.** It calls `POST /api/daily5/beat-me` and opens the system share sheet with the full challenge URL plus the challenge PNG. Secondary **Share** / **Save** are the session score card and must not emit bare `/daily`. Helper: `Challenge a friend to today's five.` Caption: `I went {X}/5. Beat me. Play today's Daily 5.`

## Endpoints

- `POST /api/daily5/beat-me` (auth) — signs today’s real session
- `GET /api/daily5/beat-me?challenge=` — `{ status: active\|stale\|invalid, puzzleDay, today, correctCount, displayName }`

Helpers: `shared/packptsDay.ts`, `server/lib/daily5BeatMeToken.ts`, `client/src/lib/dailyBeatMe.ts`.

## Share image

Session score card stays `docs/SCORE_CARD_CONTRACT.md` (today identity + mini strip + “N locked. M open.”).

Challenge share PNG (`buildChallengeShareSvg` / `generateChallengeShare`) is the kit D surface the **Beat me.** sheet attaches:

- 1080×1080, canvas `#0b0f16`, gold `#F5C518`, green `#22C55E`, ink `#F0F2F5`, muted `#8F96A3`
- `{MON} {D} · TODAY'S FIVE` on the CT session day, five cream/gold masked tiles
- Honest session `X/5` and green pips — never a canned kit 4/5
- Hook `Beat me.` · sub `I went {X}/5.` · `Play today's Daily 5.` · TODAY plaque
- Footer masked-P + PackPTS. The PNG may say `packpts.com/daily`; the href copied/shared is the challenge token URL.
