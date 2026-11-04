# PackPTS Aha Moment Onboarding Plan

## Purpose

This document defines a proposed onboarding redesign for PackPTS. It is a plan only. It does not authorize implementation.

The objective is to move onboarding from explanation before value to value before explanation.

The current product already contains important foundations that should be preserved and reused.

- The home page already sends visitors directly to Solo play through Play Now.
- Anonymous play already exists for Solo, Sets, and Daily 5.
- Guest PackPTS are already held in escrow through the anonymous identity system.
- The anonymous gate already allows one completed guest round before the first soft registration prompt and blocks new starts after the second completed guest round.
- Guest Daily 5 progress can already be claimed into a registered account.
- The current OnboardingModal opens on the home page after a short delay and explains four concepts before the user experiences the product.

The redesign should therefore simplify and reorder the experience rather than rebuild anonymous play.

## The Aha Moment

The primary Aha Moment should be defined as

> I recognized a player from the card, made the guess, immediately saw that my sports card knowledge produced PackPTS, and understood that I can keep proving what I know.

The first meaningful value event is not registration. It is the first answered card.

The first activation event should be stronger than a single click. Recommended activation definition

> A visitor answers at least three cards and sees an accumulated PackPTS result.

A completed first round remains a stronger activation milestone and should be tracked separately.

## Current onboarding problem

The existing OnboardingModal presents four explanatory steps.

1. Guess the Player
2. Earn PackPTS
3. Browse Real Listings
4. Create a Free Account

That sequence teaches the experience before the visitor has felt it.

For a new visitor, every additional explanatory screen delays the core value event.

The proposed redesign should make gameplay itself the onboarding.

## Proposed first session

### Step 1

The visitor lands on PackPTS.

The first screen should emphasize one dominant action.

> Play your first cards

Do not require account creation.

Do not require a tutorial carousel.

Do not require the visitor to understand Marketplace, PackPTS economics, multiplayer, or Daily 5 before playing.

### Step 2

Send the visitor directly into a guest play experience using the anonymous identity infrastructure that already exists.

The first card should load as quickly as possible.

The screen should teach by doing.

- Masked card
- Four answers
- One clear question
- Submit

### Step 3

After the first accepted answer, provide immediate feedback.

If correct

> Correct. +X PackPTS.

If incorrect

> The answer was [player]. Next card.

The PackPTS balance or escrow amount should become visible at this moment.

This is the first economic reinforcement.

### Step 4

Allow the visitor to continue immediately.

Do not interrupt after one card.

The target is at least three cards before introducing any account conversion request.

The product should create momentum before asking the visitor to stop and register.

### Step 5

After three answered cards, show a lightweight progress moment.

Example

> 2 of 3 correct

> 180 PackPTS held

> Keep playing

This is not yet the hard registration gate.

### Step 6

At first completed guest round, use the existing soft gate, but change the framing from account administration to value preservation.

Primary message

> Keep what you earned

Supporting message

> Create your free PackPTS account to save your PackPTS, streak, Daily 5 history, and sets.

Primary action

> Save my PackPTS

Secondary action

> Continue once more

This maps closely to the existing anonymous escrow design and should require little or no change to the underlying anonymous identity model.

### Step 7

After registration, claim anonymous escrow using the existing claim path.

The visitor should land on a personalized success state, not the generic home page.

Recommended message

> Your PackPTS are saved.

Then present exactly one recommended next action.

Priority order

1. Daily 5 if available and unplayed
2. Continue the set just played
3. Start another Solo match

## What should happen to the current OnboardingModal

The current modal should not appear automatically before first play.

Recommended future state

- Remove automatic first visit presentation
- Preserve the educational content behind an optional How PackPTS Works action
- Allow Admin or Help surfaces to reuse the content
- Never place it between landing and the first playable card

This document does not implement that change.

## Anonymous play architecture to preserve

The existing anonymous identity architecture is valuable and should remain the foundation.

Relevant current capabilities

- HttpOnly anonymous identity cookie
- Fingerprint recovery support
- Escrow PackPTS
- Guest completion counts
- Daily 5 guest runs
- Soft registration gate
- Hard registration gate
- Idempotent escrow claim
- Conversion summary support

The onboarding redesign should use these capabilities rather than create a parallel guest system.

## Registration timing

Do not force registration before value.

Recommended sequence

Landing
→ first card
→ first answer
→ immediate result
→ additional cards
→ completed guest round
→ soft save prompt
→ registration
→ escrow claim
→ Daily 5 or continued play

## PackPTS messaging

Before the visitor has played, avoid explaining the entire PackPTS economy.

Before first answer

> Correct guesses earn PackPTS.

After first correct answer

> +X PackPTS

After first round

> You earned X PackPTS. Save them with a free account.

This makes the economic concept concrete before it becomes explanatory.

## Marketplace timing

Marketplace should not be part of the initial onboarding sequence.

Marketplace becomes relevant only after the visitor understands gameplay and PackPTS.

Recommended first Marketplace exposure

- After an earned PackPTS milestone
- After the first completed registered match
- When a card or set naturally creates purchase interest

This keeps first session cognitive load focused on the core game.

## Daily 5 integration

Daily 5 should become the primary recurring habit after initial activation.

After account claim, if today's challenge remains available

> Your PackPTS are saved. Ready for today's Daily 5?

This connects acquisition onboarding to retention onboarding.

## Multiplayer timing

Do not explain 1vFriend or 1vRandom during initial onboarding.

Introduce competitive modes only after the user has completed at least one successful Solo or Daily 5 experience.

Possible trigger

> You know the game. Challenge someone.

## Analytics requirements

Before rollout, instrument the complete onboarding funnel.

Required events

- onboarding_landing_view
- onboarding_play_clicked
- onboarding_first_card_rendered
- onboarding_first_answer_submitted
- onboarding_first_answer_correct
- onboarding_three_cards_answered
- onboarding_first_round_completed
- onboarding_soft_gate_viewed
- onboarding_soft_gate_create_clicked
- onboarding_soft_gate_continue_clicked
- onboarding_registration_started
- onboarding_registration_completed
- onboarding_escrow_claimed
- onboarding_daily5_started_after_signup

Every event should include

- anonymous or registered identity
- acquisition source
- campaign
- creative id when present
- sport
- set id
- device type
- browser
- experiment variant
- timestamp

## Core funnel metrics

Track at minimum

1. Landing to Play click
2. Play click to first card rendered
3. First card rendered to first answer
4. First answer to three answered cards
5. Three answered cards to completed round
6. Completed round to registration started
7. Registration started to registration completed
8. Registration completed to escrow claimed
9. Escrow claimed to second session
10. D1 and D7 retention by acquisition source and onboarding variant

## Recommended primary activation metric

Primary

> Percentage of new visitors who answer at least three cards in their first session.

Secondary

> Percentage of new visitors who complete one guest round.

Conversion

> Percentage of completed guest players who create an account and claim escrow.

Retention

> Percentage of newly registered players who complete Daily 5 or another game the next day.

## A B testing plan

Roll out with feature flags.

### Experiment 1

Control

Existing explanatory OnboardingModal.

Treatment

No automatic modal. Direct Play path.

Primary metric

First answer rate.

Guardrails

Card load failure rate, bounce rate, registration conversion.

### Experiment 2

Control

Soft registration prompt after full first round.

Treatment

Lightweight value reminder after three cards, followed by existing soft gate after round completion.

Primary metric

Round completion.

Guardrail

Registration conversion.

### Experiment 3

Control

Generic Create free account language.

Treatment

Save my PackPTS language with exact escrow amount.

Primary metric

Played guest to registered conversion.

### Experiment 4

After registration

Control

Return to home.

Treatment

Route directly to Daily 5 when eligible.

Primary metric

Second game start within ten minutes.

## Reliability gates before rollout

Do not expose more users to the redesigned onboarding unless these conditions hold.

- First playable card success rate at least 99.5 percent
- Player name concealment 100 percent in the launch sample
- Answer submit success at least 99.5 percent
- Guest escrow claim correctness 100 percent in automated tests
- No duplicate PackPTS credits
- Mobile gameplay fits supported viewport without blocking primary controls
- No silhouette or placeholder card can enter the first session

## Rollout plan

### Phase 0

Internal only.

Verify analytics events and escrow correctness.

### Phase 1

Ten percent of new anonymous visitors.

Run for enough sessions to detect obvious regressions.

### Phase 2

Fifty percent of new anonymous visitors.

Compare activation, registration, and D1 retention.

### Phase 3

One hundred percent only if activation and retention improve without material reliability regressions.

## Rollback criteria

Immediately revert the treatment if any of the following occur.

- Card load success materially declines
- Registration conversion declines without a compensating increase in retained users
- Escrow claim mismatches occur
- First answer submission errors increase
- Mobile abandonment increases materially
- Any financial or wallet inconsistency appears

## Implementation areas likely affected later

No changes are authorized by this plan, but likely future implementation areas include

- client/src/components/OnboardingModal.tsx
- client/src/pages/home.tsx
- client/src/pages/game.tsx
- client/src/pages/daily5.tsx
- client/src/components/anon-gate-plaque.tsx
- shared/anonGate.ts
- server/services/anonIdentity.ts
- server/services/anonDaily5.ts
- analytics tracking services
- auth success routing

## Explicit non goals

This onboarding project should not

- rebuild anonymous identity
- redesign the wallet
- alter PackPTS earning economics
- add new Marketplace mechanics
- alter multiplayer match logic
- change Daily 5 scoring
- remove the current hard guest gate without a separate product decision

## Decision standard

The redesign should ship only if it proves that more visitors reach product value faster and that this improvement survives into registration and retention.

The guiding rule is simple.

> Do not explain PackPTS before the visitor has felt PackPTS.
