# Design HOME_VANITY_QUARANTINE — home marketing counters

Eng-ready contract for packpts.com home. Do not fabricate or inflate Cap / play counts. Users never create cards; SoR remains Daily 5 + Beat-me + play integrated `/sets`.

## 1. Play vanity (Total Games Played + Cards Guessed)

Hide both rows until **`totalGames ≥ HOME_PLAY_VANITY_MIN_GAMES` (500)** **or** staff feature flag **`home.show_play_vanity`**.

Below the gate (including while `/api/home-stats` is loading):

- **Omit the rows entirely**
- No `"—"`, no zeros, no `"Coming soon"`

Gate lives in `shared/homePlayVanity.ts`: `HOME_PLAY_VANITY_MIN_GAMES` + `shouldShowHomePlayVanity`. Staff override is `feature_flags.key = home.show_play_vanity` (`enabled = true`), surfaced as `staffPlayVanityOverride` on `GET /api/home-stats`.

## 2. Founders FOMO

The home “Limited Founder spots” / depleting progress bar is **hidden**. Cap API (`GET /api/access/cap`) stays real for auth, waitlist, and admin Cap UX. Do not amplify `currentActive / maxActive` as home-hero theater.

## 3. Welcome credit is not home copy

`POST /api/auth/register` still credits **250 PackPTS**: `walletService.earn(..., 250, ..., welcome_bonus:{userId})`.

Home does **not** advertise that credit. Guest hero and the mid-page account card use quiet copy (create a free account / play a round first). Banned on `client/src/pages/home.tsx`:

- `New players get 250 free PackPTS on signup`
- `Claim 250 Free PackPTS`
- `Start with 250 Free PackPTS`
- sibling claims (`we'll credit 250`, `free PackPTS`, `button-claim-bonus`, `button-signup-bonus`)

Rules:

- Spelling is **PackPTS**, never PackPoints
- The account card stays **separate** from play-vanity counters
- Do not put the 250 grant, a claim CTA, or signup-bonus theater back on home
- Gate plaque, `SignupModal`, `OnboardingModal`, and `/invite` referral rewards are outside this section

## 4. Acceptance checklist

- [ ] `HOME_PLAY_VANITY_MIN_GAMES === 500` is the named gate
- [ ] Below gate (and while loading): vanity rows are absent from the DOM — no em dash, zero, or Coming soon
- [ ] Staff flag `home.show_play_vanity` shows the real counts before 500 games
- [ ] Home does not mount Founders FOMO / spots-remaining / countdown theater
- [ ] `/api/access/cap` is unchanged for Cap UX elsewhere
- [ ] Register still earns 250; home does not advertise it (no 250 / claim / free PackPTS); copy says PackPTS; not inside the vanity grid
- [ ] No Maker Rate, no ≥10 UGC volume claims, no PackPoints spelling, no FireMarket/Norma
- [ ] `/make` is catalog-match only (no create/publish). Home still does not link to `/make` or ask users to create cards.
