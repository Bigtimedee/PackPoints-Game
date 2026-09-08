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

## 3. 250 Free PackPTS

Keep the signup promo **only** while server signup still credits **250 PackPTS**. Local register (`POST /api/auth/register`) does: `walletService.earn(..., 250, ..., welcome_bonus:{userId})`.

- Spelling is **PackPTS**, never PackPoints
- Promo DOM stays **separate** from play-vanity counters
- If the grant is removed, delete the promo — do not leave theater

## 4. Acceptance checklist

- [ ] `HOME_PLAY_VANITY_MIN_GAMES === 500` is the named gate
- [ ] Below gate (and while loading): vanity rows are absent from the DOM — no em dash, zero, or Coming soon
- [ ] Staff flag `home.show_play_vanity` shows the real counts before 500 games
- [ ] Home does not mount Founders FOMO / spots-remaining / countdown theater
- [ ] `/api/access/cap` is unchanged for Cap UX elsewhere
- [ ] 250 promo kept iff register still earns 250; copy says PackPTS; not inside the vanity grid
- [ ] No Maker Rate, no ≥10 UGC volume claims, no PackPoints spelling, no FireMarket/Norma
- [ ] `/make` stays dark for non-staff; home does not send users to create cards
