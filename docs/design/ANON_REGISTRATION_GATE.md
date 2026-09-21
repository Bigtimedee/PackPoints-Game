# Anon registration gate — copy for Marketing and Design

Guest play on packpts.com is capped. The server enforces it. These strings are the product copy. They live in `ANON_GATE_COPY` (`shared/anonGate.ts`). Do not paraphrase them in the UI.

Day boundary is America/Chicago, same as Daily 5.

## When each surface appears

| Moment | What the guest sees |
|---|---|
| First round, still playing | Nothing. Do not interrupt a round that already started. |
| After the first finished Daily 5, `/sets` play, or home solo (same day) | **Soft modal** plus the soft banner. They may start one more round. |
| Trying to start a third round (abandoned starts count) | **Hard wall.** No new game. |
| Coming back on a later CT day after any guest start | **Hard wall.** Next-day body, not the two-round body. |
| Register or sign in (local or WorkOS) | Escrow PackPTS move onto the wallet. Progress is not dropped. |

`/sets` and a set page do not open the hard modal on load. It opens when they tap Play, or when the server refuses the start.

## Soft modal

- **Title:** Save your PackPTS
- **Body:** You finished a guest round. Create a free account or sign in and we will add these PackPTS to your wallet. You can play one more round before registering.
- **Primary:** Create account and claim PackPTS
- **Sign in:** Sign in and claim PackPTS
- **Secondary:** Play one more round
- **Banner** (solo setup, Daily 5 preview, Daily 5 results): Guest round saved. One more round, then create a free account to keep playing.

The modal can be dismissed. Play one more round starts (or returns to) that next round. It is not a wall.

## Hard wall

- **Title:** Register to keep playing
- **Body (two rounds):** Guest play covers two rounds. Your PackPTS are saved — create a free account or sign in to add them to your wallet and start another game.
- **Body (next day):** Welcome back. Guest rounds do not carry into a new day. Sign in or create a free account to claim your PackPTS and play.
- **Primary:** Create account and claim PackPTS
- **Sign in:** Sign in and claim PackPTS
- No Play Again, no Skip, no “play one more.”

Replace the start / Play Again control with this wall. An in-progress Daily 5 can still be finished. A solo round that already started can still be answered.

## Do not say

- Guest play is unlimited, or Play Again never requires an account.
- PackPTS are already in the wallet. They are saved (escrow) until register or sign-in.
- “250 free PackPTS” as the gate headline. The existing welcome bonus still applies on a new account; the gate’s job is to claim the guest score.
- That anonymous visitors are registered users. Admin `registeredUsersNonStaff` stays non-staff, non-bot `users` only. The separate card is **Anon → register** (`anonConversion`). Do not add those identities to the registered-user number.
- Anything that sends people to `/make` or asks them to publish a card. Users play Daily 5 and sets that are already in PackPTS.

## Where it shows

- `SignupModal` variant `soft` or `hard` (`dialog-anon-soft-gate`, `dialog-anon-hard-gate`)
- Solo setup banner and hard wall; solo game-over modal
- Daily 5 preview hard wall (`wall-anon-hard-gate`) and soft banner; Daily 5 results
- `/sets` and `/sets/:id` Play, after the tap
