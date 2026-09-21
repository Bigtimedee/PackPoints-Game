# Anon registration gate — copy for Marketing and Design

Guest play on packpts.com is capped. The server enforces it. These strings are the product copy. They live in `ANON_GATE_COPY` (`shared/anonGate.ts`). Do not paraphrase them in the UI.

Day boundary is America/Chicago, same as Daily 5.

## When each surface appears

| Moment | What the guest sees |
|---|---|
| First round, still playing | Nothing. Do not interrupt a round that already started. |
| After the first Daily 5 or `/sets` Game Complete | **Soft sheet**, once. Play Again on that screen still works. |
| Completed games ≥ 2, or the next Chicago day after the first completion | **Hard wall.** No new game. Same body either way. Abandon does not count. |
| Register or sign in (local or WorkOS) | Escrow PackPTS move onto the wallet. Progress is not dropped. |

`/sets` and a set page do not open the hard modal on load. It opens when they tap Play, or when the server refuses the start.

## Soft modal

- **Headline:** Keep your PackPTS
- **Body:** Create a free account to save streak and resume where you left off.
- **Primary:** Create free account
- **Secondary:** Continue once more

Continue once more closes the sheet. It does not start a round by itself. Game Complete Play Again still restarts the same set until the hard wall. Chip: `PackPTS held` plus a quiet integer, hidden at 0.

## Hard wall

- **Headline:** Register to keep playing
- **Body:** You've played two games as a guest. Create a free PackPTS account to continue Daily 5 and sets.
- **Primary:** Create free account
- **Secondary:** Sign in
- Same body on a next Chicago day. No continue-as-guest.

Replace the start / Play Again control with this wall. An in-progress Daily 5 can still be finished. A solo round that already started can still be answered.

## Account form

Create free account and Sign in open the same `SignupModal` form (soft, hard, or the optional register path). The form reuses the locked headlines above. Held points use `PackPTS held` and stay hidden at 0. There is no green bonus banner.

Do not put these on that form:

- Save Your Points!
- +250 bonus PackPTS
- 250 free PackPTS
- Create Account & Claim Points
- Log In & Claim Points

The server still credits the existing welcome bonus on a new account. This form does not advertise it. `/invite` referral rewards are a separate page and are not this modal.

## Do not say

- Guest play is unlimited, or Play Again never requires an account.
- PackPTS are already in the wallet. They are saved (escrow) until register or sign-in.
- “250 free PackPTS” as the gate headline or on the account form. The existing welcome bonus still applies on a new account; the gate’s job is to keep the guest score in escrow until register or sign-in.
- That anonymous visitors are registered users. Admin `registeredUsersNonStaff` stays non-staff, non-bot `users` only. The separate card is **Anon → register** (`anonConversion`). Do not add those identities to the registered-user number.
- Anything that sends people to `/make` or asks them to publish a card. Users play Daily 5 and sets that are already in PackPTS.

## Where it shows

- `SignupModal` variant `soft` or `hard` (`dialog-anon-soft-gate`, `dialog-anon-hard-gate`)
- Solo setup banner and hard wall; solo game-over modal
- Daily 5 preview hard wall (`wall-anon-hard-gate`) and soft banner; Daily 5 results
- `/sets` and `/sets/:id` Play, after the tap
