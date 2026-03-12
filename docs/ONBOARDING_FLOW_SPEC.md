# PackPTS Onboarding Flow — Product Spec

**Goal:** Get a new user from landing page to their first correct answer in under 3 minutes
**Success metric:** Day-1 retention — % of registrants who play again within 24 hours
**Current gap:** Users register but don't understand the value until they earn their first points

---

## Problem Statement

Today's registration → game flow has two friction points:
1. New users land on the home page and don't know where to start
2. After registering, they're dropped back to home with no next step
3. There's no moment that makes earning PackPTS feel real and exciting

Result: low conversion from registration → first game, low D1 retention.

---

## Proposed Onboarding Journey

### Step 0 — Pre-Registration Hook (Landing Page)
**No change required.** The hero section already sets up the value prop:
- "Guess the Player → Earn Points → Get Real Discounts"
- CTA: "Play Now" or "Start Earning — It's Free" (A/B test variant B)

**Trigger for onboarding:** User clicks "Play Now" → if not logged in → show registration modal → after success → enter onboarding flow.

---

### Step 1 — Registration (Existing + Minor Enhancement)
**Current:** Standard username/email/password form
**Change:** After successful registration, redirect to `/welcome` instead of `/`

**Backend:** Set a `completedOnboarding: false` flag on the user record
**Schema addition:** `users.onboardingCompletedAt` (timestamp, nullable)

---

### Step 2 — Welcome Screen (`/welcome`)
**Component:** `WelcomeScreen` — full-page, replaces nav

**Copy:**
```
Welcome to PackPTS, [username] 🎉

Here's how it works in 30 seconds:
```

**Animation sequence (3 cards, auto-advancing every 2s):**
1. Card appears face-down → "A classic card appears, name hidden"
2. 4 answer choices appear → "Pick the right player from 4 options"
3. Points animation → "Earn PackPTS. Spend them on real cards."

**CTA:** "Play Your First Game →"
**Skip link:** "Skip intro" (small, below CTA) — sets `onboardingCompletedAt` immediately

---

### Step 3 — First Game (Coached Solo Mode)
**Trigger:** Only fires if `onboardingCompletedAt IS NULL`
**Mode:** Same solo game, but with a one-time overlay coach tip on the first question

**Coach tip overlay (dismissible):**
```
[?] Tap the player you think is on this card.
     Faster correct answers = more points.
     [Got it →]
```

Overlay dismisses on "Got it" tap or on first answer submission.

**After first correct answer:** Show micro-celebration:
- Points animation (e.g., "+150 PackPTS" flies up from the answer)
- Brief toast: "First points earned! Keep going 🔥"

---

### Step 4 — Post-First-Game CTA
**Trigger:** After the solo game ends for the first time

**If score > 0:**
```
You earned [N] PackPTS!

That's [N]% toward your next card on Goldin.

[Play Again]    [See How to Redeem →]
```

**If score = 0:**
```
Tough first game! Every card you see twice gets easier.

Your streak starts now — come back tomorrow to keep it going.

[Try Again]    [See Today's Daily 5 →]
```

**Set `onboardingCompletedAt = now()`** after this screen is shown, regardless of score.

---

### Step 5 — Day-1 Re-Engagement Email
**Trigger:** 20 hours after registration, if `gamesPlayed = 0`
**Subject:** "Your first game takes 2 minutes — here's what you'll earn"

```
Hey [username],

You signed up for PackPTS but haven't played yet. No worries — here's what you're missing:

Today's Daily 5 is live. Same 5 cards for every player.
Fastest correct answers climb the leaderboard.

Your current PackPTS: 0
Potential from one game: up to 500 PackPTS

[Play Now →]

You've got until midnight to get on today's board.
— The PackPTS Team
```

**Trigger:** 4 days after registration, if `gamesPlayed < 3`
**Subject:** "Other collectors are pulling ahead"

```
Hey [username],

Since you signed up, PackPTS players have completed [N] games
and [top-user] just hit [X] PackPTS — enough to take [Y]% off
their next Goldin purchase.

Your total: [user's total] PackPTS

The gap is closable. Each correct answer earns 50–500 pts.

[Catch Up →]
```

---

## Technical Implementation Notes

### New DB Field
```sql
ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
```

### New Route
`GET /welcome` → React page (requires auth, redirects to `/` if `onboardingCompletedAt IS NOT NULL`)

### New API Endpoint
`POST /api/onboarding/complete`
Body: `{}`
Response: `{ ok: true }`
Action: Sets `onboardingCompletedAt = now()` for the authenticated user

### Client-Side Guard
In the router, after successful registration, push to `/welcome`. In `/welcome` component, call `/api/onboarding/complete` when the user advances past Step 2 or clicks Skip.

### Post-Game Detection
In `game.tsx`, after `isGameOver` becomes true:
- Check `user.onboardingCompletedAt === null`
- If true, show the `FirstGameEndModal` component instead of standard results UI
- The modal calls `POST /api/onboarding/complete` on close

---

## Success Metrics

| Metric | Current (est.) | Target (30 days post-launch) |
|--------|---------------|------------------------------|
| Reg → First game played rate | ~30% | 60% |
| D1 retention (played again next day) | ~15% | 35% |
| Avg time to first correct answer | Unknown | < 3 min |
| Onboarding completion rate | N/A | 80% |

---

## Future Enhancements (Out of Scope for V1)

- **Set selector during onboarding:** "What sport do you collect?" → personalizes first game set
- **Progressive disclosure of wallet:** Only show wallet/redemption UI after first 100 PackPTS earned (reduces cognitive load)
- **Social proof during onboarding:** "Join [N] collectors already playing"
- **Streak setup:** Day-1 nudge to enable push notifications for streak reminders
