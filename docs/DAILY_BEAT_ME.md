# Daily 5 “Beat me” URL contract

Share/challenge after Daily 5 Game Complete is a **product loop**, not a PNG or caption. The recipient opens **today’s** Daily 5 with the challenger’s real session score.

## Timezone lock

Beat-me `puzzle_day`, the Daily 5 day key / challenge window, and streak “today” all use **`America/Chicago` (CT)**.

- Day key: `YYYY-MM-DD` from `getPackptsDayKey()` in `shared/packptsDay.ts`
- Daily 5 `startsAt` / `endsAt` for a date are CT midnight → next CT midnight
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

- Active: `Beat {name} — they went {score}/5 today`
- Stale: `Challenge expired — play today's five.`
- After the recipient finishes: quiet compare (`You went X/5. They went Y/5.` / tie / they led). No casino copy.

## Endpoints

- `POST /api/daily5/beat-me` (auth) — signs today’s real session
- `GET /api/daily5/beat-me?challenge=` — `{ status: active\|stale\|invalid, puzzleDay, today, correctCount, displayName }`

Helpers: `shared/packptsDay.ts`, `server/lib/daily5BeatMeToken.ts`, `client/src/lib/dailyBeatMe.ts`.
