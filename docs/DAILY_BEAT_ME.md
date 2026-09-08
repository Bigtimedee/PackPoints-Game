# Daily 5 “Beat me” URL contract

Share/challenge after Daily 5 Game Complete is a **product loop**, not a PNG or caption. The recipient opens today’s Daily 5 with the challenger’s real session score.

## Canonical URL

```
https://packpts.com/daily?s={0-5}&n={username}
```

| Param | Required | Meaning |
|-------|----------|---------|
| `s` | yes | Challenger’s **real** session correct-count (`0`–`5`). This is the X in X/5. |
| `n` | no | Challenger username (`[A-Za-z0-9_]`, max 20). Omitted when unavailable. |
| `ref` | no | Existing referral short-link code. Ignored by the Beat-me parser. |

`/daily` and `/daily5` render the same page. Build and share **`/daily`**.

## Honesty

- Emit `s` only from the finished Daily 5 session (`finishResult.correctCount` or `status.entry.correctCount`).
- Never invent scores, streaks, ranks, or points in the deep link.
- Invalid or out-of-range `s` → treat as a normal `/daily` visit (no banner).
- Do **not** pin a puzzle date. The recipient always plays **today’s** Daily 5. `s`/`n` are challenger context only.

## Recipient UI

Quiet banner on preview / play / results:

```
{n} went {s}/5 — Beat them
```

If `n` is missing: `A player went {s}/5 — Beat them`.

## How links are produced

1. **Challenge a Friend** — `POST /api/referrals/create` with `purpose: SCORE_SHARE` and `destinationPath: /daily?s=…&n=…`. The `/r/{code}` redirect keeps those params and appends `ref`.
2. **ShareAssetCard** (copy / native / share-without-card) — `shareUrl` is the canonical `https://packpts.com/daily?s=…&n=…` URL.
3. **Share Result** clipboard/native text — same X/5 caption + that URL.

Helpers live in `client/src/lib/dailyBeatMe.ts`. Context is also written to `sessionStorage` (`packpts_daily_beat_me`) so a sign-in hop or `/daily5` alias still shows the banner.
