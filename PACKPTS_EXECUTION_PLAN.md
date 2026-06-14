# PackPTS Execution Plan — Audit, Fixes, and Organic Marketing Roadmap

> Generated 2026-06-14 from a direct inspection of the live `PackPoints-Game` repository (HEAD `4e516a8b`, branch `main`), the canonical `PACKPTS_PROJECT_CONTEXT.md`, and the acquisition thesis memo. Every claim below was verified against the actual code, not the documentation. Where I could not verify something, I say so and assign a confidence level.

---

## PART 0 — THE REALITY CHECK (read this before you touch anything)

You asked for an unfiltered assessment. Here it is.

### 0.1 The acquisition thesis is a narrative, not a model

The internal memo is well-written and the strategic logic — "own the discovery moment, own the intent graph" — is directionally coherent. It is also, in its current numeric form, fiction. The problem is not the story; it is that the story is attached to numbers that have no anchor in anything PackPTS has actually demonstrated. Treat the following as the strongest case against your own memo, which you should be able to answer before you ever put it in front of a corp-dev team at Fanatics or eBay.

**The KPI model assumes Wordle-tier virality with zero evidence it exists.** The model jumps to 1,000,000 registered users and 400,000 MAU in twelve months. There is nothing in this codebase or its history that establishes a baseline DAU, a retention curve, a viral coefficient, or a single cohort. A 38% DAU/MAU ratio is not a target you set; it is an outcome you measure. Asserting it as a Month-12 number with no Month-1 data point is the single fastest way to get a sophisticated acquirer to discount everything else you say. **Confidence: high.**

**The revenue math is internally optimistic at every step and the errors compound.** Walk the affiliate funnel: 30M card views → 6% CTR → 1.8M outbound clicks → 2.5% purchase conversion → 45,000 purchases × $80 AOV × 3.5% = $126k/mo. A 6% click-through from gameplay to an outbound marketplace link is aggressive; a 2.5% conversion on a high-consideration $80 collectible purchase from a referred click is aggressive; both being true simultaneously is multiplicatively unlikely. The subscription line (4% of 1M users paying $9.99 = $4.8M ARR) assumes both the 1M-user number *and* a 4% paid conversion, which for a free casual game is at the top of the plausible range. The honest version of this model carries a confidence interval, and the bottom of that interval is roughly an order of magnitude below the headline. **Confidence: high.**

**The valuation multiple is the weakest link.** "$7.5M ARR × 15x = $112M, then 'easily $500M+', then '$1B ceiling'" is three unjustified leaps in one sentence. The 15x is applied to *projected* ARR you have not earned; the jump from $112M to $500M is asserted, not derived; and the $1B figure has no mechanism behind it other than "if GMV scales." Strategic acquirers do pay premiums for engagement and data, but they pay them on *demonstrated* engagement and *proven* attribution, not on a spreadsheet. **Confidence: high.**

**What would actually make this thesis bankable** is the part the memo waves at and the codebase has not yet proven: closed-loop commerce attribution (a real, instrumented path from "played this card" → "clicked out" → "purchased," with the affiliate postback wired and reconciled), and a published retention cohort that holds above ~20% at D30 for even a few thousand real users. Those two artifacts are worth more than the entire 12-month KPI table. The plan below prioritizes building the *machinery that produces the proof*, because proof is the only thing that converts this memo from pitch into price.

### 0.2 The codebase is more mature than the thesis, and quietly broken in ways that matter

This is genuinely a large, serious application: ~55,700 lines of server TypeScript, ~31,800 lines of client TypeScript, 144+ tables, a real append-only ledger, FIFO bucket accounting, a margin-guardrail system, and an autonomous social agent. That is not a prototype. But it is shipping with a set of defects that range from embarrassing to financially dangerous, and the "canonical brain" document undersells some while overstating others.

Verified findings, in priority order, follow. Confidence is "high" for everything I reproduced directly.

**FE/BE-1 — The project does not type-check. `npm run check` fails with 7 errors.** Verified by running `npx tsc`:
- `server/routes.ts:1091, 1092, 1124` — `Type '{}' is not assignable to type 'number'` (three places).
- `server/routes.ts:1940` — function called with 5 arguments where 2–4 are expected.
- `server/services/profitGuardrailService.ts:143` — Drizzle insert shape mismatch (`marginPoolCents` / `userId` not in the inferred insert type). **This is in the margin-ledger path — a financial control.**
- `server/services/videoFactory/compositor.ts:12` — missing type declarations for `fluent-ffmpeg`.

The reason these have shipped is that your build (`script/build.ts`) uses esbuild, which strips types and **never type-checks**. So `npm run build` is green while `npm run check` is red. You have been deploying code the compiler rejects. The margin-ledger one in particular means a financial-control code path may be silently mistyped in production. **Confidence: high.**

**FE/BE-2 — There is a debug payload leaking internal auth/session state to unauthenticated callers.** `server/routes/friends.ts` (the `isAuthenticated` helper, ~line 13) returns a `_probe` object on every 401 containing `sentinel: "friends-auth-2026-05-24"`, plus booleans for `hasReqUser`, `hasClaimsSub`, `hasWorkosUserId`, and the full list of `req.session` keys. This was committed as a "temporary 401 probe payload to verify deploy" and never removed. It is live, it advertises your session internals to anyone who hits a friends endpoint logged out, and it makes you look amateur to anyone inspecting the network tab. **Confidence: high.**

**FE/BE-3 — The "canonical project brain" is not under version control.** `git status` shows `PACKPTS_PROJECT_CONTEXT.md`, `PACKPTS_GROWTH_STRATEGY.md`, `docs/30_DAY_CONTENT_LIBRARY.md`, `docs/GROWTH_AUTOMATION_SETUP.md`, and the new Daily-5 scripts as **untracked**, and `CLAUDE.md` as modified-uncommitted. The document that opens with "Every future session must read this file before making changes" and "update this file in the same session" has itself never been committed. The instruction is unenforceable because the artifact is invisible to anyone who clones the repo. **Confidence: high.**

**FE/BE-4 — The FIFO point-expiration job is still not scheduled.** Confirmed: `server/index.ts` schedules Notion sync, growth jobs, and a weekly newsletter via `scheduleRecurringJob`, but contains no reference to `expirationEngine` or `runExpiration`. The engine and the standalone job script exist; nothing calls them on a timer. Every day this runs unscheduled, your outstanding-points liability grows without the contractual expiry that your own liability model assumes (25% breakage). This is a balance-sheet problem disguised as a missing cron line. **Confidence: high.**

**FE/BE-5 — An auth provider was just ripped out, and nothing here proves login still works.** The last ~10 commits are a "forbidden vendor name purge": `strip third-party OIDC code`, `remove forbidden vendor login buttons`, `rename server auth module`, `strip forbidden vendor name from identity provider enum`. Removing an OIDC path and SSO buttons in a hurry is exactly how you end up with a broken or half-broken signup funnel — and a broken funnel makes every marketing dollar and every growth-agent post worthless. There is no test artifact in the history demonstrating that local login + WorkOS SSO + session creation still work end-to-end after the purge. The context doc still describes WorkOS SSO as a live alternative path; that claim is now unverified. **Confidence: high that the risk exists; unknown whether auth is actually broken — it must be tested.**

**FE/BE-6 — Tests exist but are neither runnable in CI nor enforced.** The context doc claims "no unit test suite exists." That is false: `server/tests/` contains 11 spec files (`wallet.test.ts`, `purchaseFulfillment.test.ts`, `card-image-pipeline.test.ts`, `growthFlywheel.test.ts`, `socialPublishing.test.ts`, and more), and `tests/e2e/` has Playwright specs. But there is **no `.github/workflows` directory — no CI at all** — so nothing runs them on push. And in a clean environment they currently fail to even start (`vitest` aborts with `Cannot find module '@rollup/rollup-linux-arm64-gnu'`, an optional-dependency/platform issue). So: the doc is wrong about tests not existing, *and* the tests are effectively dead weight because nothing enforces them and they don't run cleanly. **Confidence: high.**

**Documented gaps I did not independently re-verify but which remain open per the doc (treat as moderate confidence):** no ELO-wired matchmaking, no AI fallback opponent, wager settlement incomplete, no automated risk scoring, no automated chargeback→freeze, no hold period on purchased points before redemption, Goldin listings manually curated rather than live-API, no marketplace listing-price validation, default hash salt and JWT dev-fallback needing production overrides.

### 0.3 The order of operations the memo gets backwards

The memo optimizes for the acquisition narrative. The correct order is the inverse: **stabilize the machine, instrument the proof, then grow into the numbers.** You cannot sell an "intent engine" whose compiler is red, whose auth was just gutted, whose liability clock isn't running, and whose attribution loop isn't reconciled. Every phase below is sequenced so that the thing an acquirer would actually diligence — clean code, working auth, real retention data, reconciled commerce attribution — gets built before you spend a dollar or a day on top-of-funnel.

---

## PART I — HOW TO USE THIS PLAN

This plan is a sequence of prompts. Paste them **one at a time** into your Claude CLI, in order, on your own machine (where `git push` works and Railway auto-deploys — not in any sandbox). Do not paste the next prompt until the previous one's "Definition of Done" is satisfied.

### Conventions every prompt assumes

Each prompt ends with the same **Standard Footer** so you don't have to repeat it. The footer encodes the project's non-negotiable rules:

> **Standard Footer (applies to every prompt):**
> 1. Before starting, run `git pull --rebase` so the push won't be rejected.
> 2. Make the smallest change that satisfies the task. Touch only what the task requires (Surgical Changes rule).
> 3. Do not use `await import()` for `@shared/*` modules in server code; static imports only. Do not statically import native modules (`sharp`, `ffmpeg`) in route files; lazy-import them.
> 4. Write or update a test that proves the change, and run it locally until green.
> 5. End-to-end verify per the prompt's "Verify" block before committing.
> 6. Update `PACKPTS_PROJECT_CONTEXT.md` to reflect the new true state (move items out of "Known Bugs," update "Last verified" date, adjust any section the change touched). This file must end the task committed, not untracked.
> 7. Commit with a clear message, push to `main`, wait for Railway to deploy, then confirm the deploy is live by hitting `GET /api/version` and checking the canary matches the new build before declaring done.
> 8. If anything is ambiguous or you discover the task is larger than described, stop and report what you found instead of guessing.

### Phase map

- **Phase 1 — Stabilize (do first, in order).** Make it compile, stop the leak, get the brain into git, start the liability clock, prove auth survived the purge. Prompts 1–7.
- **Phase 2 — Trust & reliability.** CI that actually runs the tests, fill the critical test gaps (masking, scoring, wallet, webhook idempotency), wire the financial-safety flows. Prompts 8–14.
- **Phase 3 — Engagement & retention (this is where growth actually comes from).** Onboarding, push/notifications, ELO + AI-fallback matchmaking, the share loop, and — most importantly — the **attribution instrumentation** that turns the thesis into evidence. Prompts 15–22.
- **Phase 4 — Commerce & monetization hardening.** Redemption hold periods, marketplace price validation, subscription lifecycle verification. Prompts 23–27.
- **Marketing track (runs in parallel from Phase 2 onward).** Organic-first roadmap with near/medium/long-term actions, plus the CLI prompts that build the automation it depends on.

A note on sequencing discipline: **do not start the Marketing track until Phase 1 is fully merged.** Driving traffic to an app with a broken compiler, leaking debug data, and unverified auth converts curiosity into churn and burns the goodwill of exactly the small, opinionated collector communities you most need.

---

## PHASE 1 — STABILIZE

### Prompt 1 — Make the project type-check, and make the build refuse to ship type errors

```
Read PACKPTS_PROJECT_CONTEXT.md and CLAUDE.md first.

The project does not type-check. `npm run check` (tsc) currently fails with these errors:
- server/routes.ts:1091, 1092, 1124 — Type '{}' is not assignable to type 'number'
- server/routes.ts:1940 — a function is called with 5 args but expects 2–4
- server/services/profitGuardrailService.ts:143 — Drizzle insert shape mismatch: 'marginPoolCents' and 'userId' do not exist on the inferred insert type for that table
- server/services/videoFactory/compositor.ts:12 — missing type declarations for 'fluent-ffmpeg'

Fix each error at its root cause, not by casting to `any` or `@ts-ignore`:
- For the routes.ts:1091/1092/1124 cases, trace where the '{}' value originates and give it a real numeric type or proper parse/validation.
- For routes.ts:1940, inspect the called function's real signature and fix the call site (or the signature if the call site is correct).
- For profitGuardrailService.ts:143, reconcile the insert object with the actual Drizzle table definition in shared/schema.ts. This touches the margin ledger — a financial control — so verify the column names and types against the schema and do NOT silently drop fields. If a column is genuinely missing from the schema, stop and report rather than guessing.
- For fluent-ffmpeg, install @types/fluent-ffmpeg if it exists, otherwise add a minimal local declaration file.

Then make CI-grade safety permanent: add `tsc --noEmit` as a required step in the build so that a type error fails the build. Wire it so `npm run build` runs the typecheck before esbuild bundles, and document this in CLAUDE.md.

Verify:
- `npm run check` exits 0 with zero errors.
- `npm run build` succeeds and now fails fast if you intentionally introduce a type error (test this, then revert the intentional error).
- Confirm no `any`/`@ts-ignore` was added as a shortcut.

Then apply the Standard Footer.
```

### Prompt 2 — Remove the production debug leak in the friends auth guard

```
Read PACKPTS_PROJECT_CONTEXT.md first.

server/routes/friends.ts contains an `isAuthenticated` helper that returns a `_probe` object on 401 responses, exposing session internals (sentinel "friends-auth-2026-05-24", hasWorkosUserId, the full list of req.session keys, etc.). This is a leftover "verify deploy" probe and is leaking internal auth/session state to unauthenticated callers in production.

Remove the entire `_probe` object so the 401 response body is a clean `{ error: "Unauthorized" }` (match the shape used by other route guards in the codebase — check server/middleware and other route files for the canonical unauthorized response and use that).

Then grep the entire server/ and client/ trees for other leftover debug probes/sentinels (search for "_probe", "sentinel", "verify deploy", "TODO", "FIXME", "console.log" in auth/session/wallet/payment paths). Report everything you find. Remove only the obvious debug leftovers; for anything ambiguous, list it and ask before deleting.

Verify:
- Hitting any /api/friends* endpoint while logged out returns a clean 401 with no internal fields.
- No remaining "_probe"/"sentinel" strings in server/.

Then apply the Standard Footer.
```

### Prompt 3 — Commit the canonical context doc and the rest of the untracked brain into git

```
Read PACKPTS_PROJECT_CONTEXT.md first.

These files are currently UNTRACKED or uncommitted in git, including the file the whole team is told is canonical:
- PACKPTS_PROJECT_CONTEXT.md (untracked)
- PACKPTS_GROWTH_STRATEGY.md (untracked)
- docs/30_DAY_CONTENT_LIBRARY.md (untracked)
- docs/GROWTH_AUTOMATION_SETUP.md (untracked)
- scripts/daily5_announcement.py, scripts/discord_post.py (untracked)
- CLAUDE.md (modified, uncommitted)

First, inspect each untracked file to confirm none of them contain secrets (API keys, tokens, DB URLs, Stripe keys). If any do, stop and report — do not commit secrets. For any config that legitimately needs an example, create a sanitized *.example version and add the real one to .gitignore.

Assuming they are clean, commit them so the "canonical brain" is actually in version control. Add a short note to CLAUDE.md stating that PACKPTS_PROJECT_CONTEXT.md is tracked and must be committed in the same change as any behavior change.

Verify:
- `git status` is clean (nothing untracked except intentionally-ignored files).
- `git ls-files` includes PACKPTS_PROJECT_CONTEXT.md.

Then apply the Standard Footer (note: the doc-update step is largely satisfied by this task itself; still bump the "Last verified" date).
```

### Prompt 4 — Schedule the FIFO point-expiration job so the liability clock actually runs

```
Read PACKPTS_PROJECT_CONTEXT.md, especially sections 9 (Wallet/Ledger) and the note that expiration is implemented but not scheduled.

The expiration engine exists (server/services/expirationEngine.ts with runExpirationJob() and runInactivityExpiration(); standalone script server/jobs/runExpiration.ts) but is NOT scheduled. server/index.ts schedules other recurring jobs via scheduleRecurringJob from ./jobs/pgJobQueue. Wire the expiration job into that same scheduler.

Requirements:
- Schedule runExpirationJob to run daily (pick a low-traffic hour; make the interval/cron configurable via an env var with a sane default).
- Use the SAME scheduling mechanism (pgJobQueue scheduleRecurringJob) the other jobs use, so it survives restarts and doesn't double-run across instances. Verify how pgJobQueue guarantees single execution and confirm expiration is safe under it.
- Expiration mutates the ledger and wallet balances. Confirm it writes proper append-only ledger entries (entryType EXPIRE) with idempotency keys, and that it respects the grace period and policy in packptsExpirationPolicy. Do NOT change expiration math — only schedule it.
- Add structured logging so each run reports how many buckets expired and total points removed.

Verify:
- On a local/staging DB with seeded expired buckets, the scheduled job (or a manual trigger of the same function) expires them, writes EXPIRE ledger entries, and balances reconcile (wallet balance == sum of ledger).
- Confirm via logs the job is registered on startup.
- Re-running is idempotent (no double expiry).

Then apply the Standard Footer.
```

### Prompt 5 — Prove (or fix) auth end-to-end after the OIDC/vendor purge

```
Read PACKPTS_PROJECT_CONTEXT.md section 13 (Auth) first.

The last several commits stripped a third-party OIDC provider and removed SSO login buttons ("strip third-party OIDC code", "remove forbidden vendor login buttons", "rename server auth module", "strip forbidden vendor name from identity provider enum"). There is no test proving auth still works after this. The context doc still references WorkOS SSO as a live path; that may now be stale.

Do a full audit of the current auth surface and produce the ground truth:
1. Enumerate every auth entry point that still exists: local username/password signup + login, password reset, WorkOS SSO (if still wired), session creation, and the friends/wallet route guards that depend on req.user / req.session.
2. For each, trace the flow end-to-end and confirm it still functions after the purge. Identify any dangling references to the removed provider (imports, enum values, env vars, client buttons, redirect routes) that are now dead or broken.
3. Write a Playwright E2E test that covers: signup -> logout -> login -> access an authenticated endpoint (e.g. /api/friends) -> password reset request. Run it.
4. Fix anything broken. If WorkOS SSO is no longer wired, either restore it correctly or update PACKPTS_PROJECT_CONTEXT.md to stop claiming it exists — do not leave the doc lying.

Verify:
- The new E2E auth test passes locally.
- No dead references to the removed provider remain (grep to confirm).
- PACKPTS_PROJECT_CONTEXT.md section 13 matches reality.

Then apply the Standard Footer.
```

### Prompt 6 — Enforce production secrets: no default salts, no JWT dev fallback in prod

```
Read PACKPTS_PROJECT_CONTEXT.md section 20 (Env Vars) and 15 (Fraud/Risk) first.

The codebase has a default hash salt ("default-ip-salt-change-in-production" in server/utils/hash.ts) and a JWT_SECRET dev fallback. In production these must never silently fall back to defaults.

Change behavior so that in production (NODE_ENV/APP_ENV === production) the server FAILS FAST at startup with a clear error if any of these required secrets are missing or equal to a known default: the IP hash salt, JWT_SECRET, SESSION_SECRET, and any Stripe/webhook secret the server needs to operate safely. In development, keep the fallbacks but log a loud warning.

Inventory every secret read from process.env across server/ and produce a checklist in PACKPTS_PROJECT_CONTEXT.md section 20 marking which are required-in-prod. Cross-check against RAILWAY_ENV_SETUP.md.

Verify:
- Starting the server in production mode with a default/missing salt or secret exits non-zero with a descriptive message.
- Starting in dev still works and warns.
- Do NOT print secret values in logs — only their presence/absence.

Then apply the Standard Footer.
```

### Prompt 7 — Phase 1 closeout: green-build canary and a deploy verification routine

```
Read PACKPTS_PROJECT_CONTEXT.md first.

Confirm GET /api/version returns a build/version identifier that changes per deploy (a git SHA or build timestamp). If it does not reliably change per deploy, fix it so it embeds the current commit SHA at build time, so future prompts can use it as a deploy canary.

Then write a short, repeatable verification checklist into PACKPTS_PROJECT_CONTEXT.md section 24 (Deployment) describing how to confirm a deploy is live: push -> wait -> curl /api/version -> confirm SHA matches HEAD before testing. This operationalizes the "verify deploy before testing" rule.

Verify:
- /api/version returns the current commit SHA after a deploy.
- The checklist is committed.

Then apply the Standard Footer. After this prompt, Phase 1 is complete: the project type-checks, the build blocks type errors, the debug leak is gone, the brain is in git, the liability clock runs, auth is proven, secrets are enforced, and deploys are verifiable.
```

---

## PHASE 2 — TRUST & RELIABILITY

### Prompt 8 — Stand up CI that actually runs the tests on every push

```
Read PACKPTS_PROJECT_CONTEXT.md section 23 (Testing) first. Note the doc currently claims "no unit test suite exists" — that is FALSE; server/tests/ has 11 vitest specs and tests/e2e/ has Playwright specs. The real problem is (a) there is no CI running them and (b) vitest currently fails to start in a clean environment with "Cannot find module '@rollup/rollup-linux-arm64-gnu'" (an optional-dependency/platform issue).

Do two things:
1. Fix the vitest startup failure so the suite runs cleanly from a fresh `npm ci`. Diagnose the rollup optional-dependency problem (likely a lockfile/platform/optionalDependencies issue) and make `npx vitest run` work on a clean checkout. Do not paper over it by deleting tests.
2. Add a GitHub Actions workflow (.github/workflows/ci.yml) that on every push and PR to main runs, in order: `npm ci`, `npm run check` (tsc), `npx vitest run`, and a build. Fail the workflow on any failure. (Do not run Playwright E2E in CI yet if it needs a live server/DB — gate that for a later prompt, but leave a clearly-marked stub job.)

Then correct PACKPTS_PROJECT_CONTEXT.md section 23 to describe the tests that actually exist and the new CI.

Verify:
- `npm ci && npx vitest run` passes on a clean checkout.
- The CI workflow runs green on a trivial PR and red when you introduce a deliberate failure (test this, then revert).

Then apply the Standard Footer.
```

### Prompt 9 — Critical test: masking never leaks the answer (the product's whole premise)

```
Read PACKPTS_PROJECT_CONTEXT.md section 7 (Name Masking — MISSION CRITICAL) in full first.

Write automated tests that enforce the non-negotiable masking rules. At minimum:
- A server test asserting that the "get next question" API payload (solo + 1v1 + Daily 5 paths) does NOT include the correct answer / player name field before submission, only after.
- A test asserting answer options are randomized (correct answer is not in a fixed position).
- A test for the card-replacement flow asserting a replacement question also withholds the answer.
- If feasible, a Playwright DOM test asserting the player name does not appear anywhere in the rendered DOM (alt text, title, aria-label, data attrs) or in the question network response before submission.

These tests must be wired into CI from Prompt 8. If you discover an actual leak while writing them, STOP and report it as a critical finding before "fixing" anything else — a real leak is a P0.

Verify:
- New masking tests pass and run in CI.
- Document in section 7 that these tests now exist and what they guard.

Then apply the Standard Footer.
```

### Prompt 10 — Critical test: scoring matches the reward policy exactly

```
Read PACKPTS_PROJECT_CONTEXT.md section 8 (Scoring/Economy) first.

Write unit tests for server/services/rewardEngine.ts covering:
- basePts formula across fame extremes (fame 0.1 obscure vs 0.9 famous) matches minPts + (maxPts-minPts)*(1-fame)^gamma.
- vintage multiplier buckets (pre-1980, 1980-1999, 2000-2019, 2020+).
- rarity multiplier lookup (base vs SP etc.).
- maxAwardCap clamps a single award.
- perMatchPointsCap and dailyPointsCap enforcement (userPointsCounters).
Use the actual default rewardPolicy values; if policy is DB-driven, inject/mocked policy fixtures.

Verify all tests pass in CI. Document coverage in section 8.

Then apply the Standard Footer.
```

### Prompt 11 — Critical test: wallet/ledger integrity and idempotency

```
Read PACKPTS_PROJECT_CONTEXT.md sections 9 and 22 first.

Strengthen and/or extend server/tests/wallet.test.ts to assert:
- Ledger idempotency: the same idempotencyKey applied twice yields exactly one ledger entry and one balance change.
- Wallet balance equals the running sum of ledger entries (balanceAfter consistency).
- A frozen/suspended wallet cannot earn or spend (walletService.earn checks isUserFrozen).
- FIFO bucket depletion draws from oldest open bucket first and records packptsSpendAllocation correctly.
- EXPIRE entries (from the now-scheduled expiration job) reconcile.

Verify all pass in CI. Document in section 9.

Then apply the Standard Footer.
```

### Prompt 12 — Critical test + verification: Stripe webhook idempotency and checkout lifecycle

```
Read PACKPTS_PROJECT_CONTEXT.md section 10 (Payments) and section 22 first.

Extend server/tests/purchaseFulfillment.test.ts (or add a new spec) to assert:
- Replaying the same Stripe webhook event (same eventId) credits points exactly once (purchaseEvents.eventId idempotency).
- checkout.session.completed fulfills the correct product/points bundle.
- Checkout session lifecycle transitions (CREATED -> PAID / CANCELED / EXPIRED) are handled.
- A product failing margin guardrails (guardrailsStatus BLOCK) cannot be purchased.

Use Stripe fixtures/mocks; do not hit live Stripe. Then run scripts/stripe-smoke.ts against test mode to confirm the live path still works.

Verify tests pass in CI; document in section 10.

Then apply the Standard Footer.
```

### Prompt 13 — Wire the automated chargeback → wallet freeze flow

```
Read PACKPTS_PROJECT_CONTEXT.md sections 9 (Fraud Holds) and 25 (Known Bugs: no automated chargeback->freeze) first.

Implement the missing flow: when Stripe sends a dispute/chargeback webhook (charge.dispute.created), the corresponding user's wallet is frozen and a REVERSAL ledger entry reverses the credited points (respecting idempotency and append-only rules). Admin should be able to see the freeze reason. Do not auto-unfreeze; that stays manual.

Confirm the webhook is subscribed/handled, the REVERSAL math is correct (reverse exactly what that purchase credited, even if partially spent — define and document the partial-spend policy; if points were already spent below the reversal amount, drive balance negative or flag for admin per an explicit, documented choice — ask if unsure).

Test: replay a dispute event in test mode -> wallet frozen, REVERSAL entry written once, balance correct. Add to CI.

Document the new flow in sections 9, 10, and remove the item from section 25.

Then apply the Standard Footer.
```

### Prompt 14 — Add a hold period on purchased points before redemption eligibility

```
Read PACKPTS_PROJECT_CONTEXT.md sections 9, 11 (Marketplace/Redemption), 25 first.

Implement a configurable hold period (env-driven, sensible default e.g. 7 days) during which PURCHASED points (packptsBucket.sourceType PURCHASED) cannot be redeemed in the marketplace, to blunt buy->redeem->chargeback fraud. EARNED points are not held. Redemption logic must check bucket eligibility and exclude held purchased buckets from the redeemable balance, with a clear user-facing message about when they unlock.

Test: purchased points within the hold window are not redeemable; after the window they are; earned points are always redeemable; FIFO still correct. Add to CI.

Document in sections 9 and 11; remove the item from section 25.

Then apply the Standard Footer.
```

---

## PHASE 3 — ENGAGEMENT, RETENTION & THE ATTRIBUTION PROOF

> This is where "growth" actually lives. The memo's entire valuation rests on two artifacts it doesn't yet have: a real retention curve and a reconciled commerce-attribution loop. Prompts 15 and 22 build exactly those. Treat them as the highest-value items in the whole plan — they are what convert the thesis from pitch to price.

### Prompt 15 — Instrument the attribution loop end-to-end (the single most valuable thing in this plan)

```
Read PACKPTS_PROJECT_CONTEXT.md sections 11 (Marketplace/Affiliate) and the analyticsService first.

Build the closed-loop attribution the acquisition thesis depends on but cannot currently prove. The goal: for any purchase driven through PackPTS, you can trace card-played -> card-viewed -> outbound-click -> (affiliate postback) -> attributed purchase, and report conversion rates at each stage with real numbers.

Implement:
1. A canonical event funnel (card_view, card_outbound_click, with the card/player/set context and user/session) persisted and queryable. Reuse existing analytics tables if present; only add what's missing.
2. Guarantee affiliate attribution params (eBay EPN, Goldin) are preserved on every outbound URL — add a test that fails if any outbound marketplace link drops its attribution params (this protects a non-negotiable rule).
3. A daily rollup producing the real funnel metrics the memo asserts (views, CTR, outbound clicks) — actual measured values, not targets.
4. Where affiliate networks support postback/conversion reporting, ingest it (or stub the ingestion with a clearly-marked TODO and a manual import path) so purchase conversion can eventually be reconciled.

Verify: funnel events are recorded during a real playthrough; outbound links retain attribution params (tested); the rollup produces non-null metrics; an admin view or query can surface them.

Document the new attribution model in section 11. This is the data asset that makes PackPTS acquirable — treat it accordingly.

Then apply the Standard Footer.
```

### Prompt 16 — Publish a real retention cohort dashboard (D1/D7/D30) for admins

```
Read PACKPTS_PROJECT_CONTEXT.md sections 14 (Admin) and 16 (Architecture) first.

Build an admin-only retention cohort report: by signup-week cohort, show D1/D7/D30 retention, DAU, WAU, MAU, and DAU/MAU. Compute from real session/activity data already captured (find the activity timestamp source; if none exists, add minimal session-activity logging). Do NOT fabricate or seed fake numbers — if the data is thin because the user base is small, show the thin real numbers. The point is an honest instrument.

Verify the report renders for an admin and the math matches a hand-checked sample. Document in section 14.

This dashboard is what you will screenshot for investors/acquirers instead of the fictional KPI table. Make it trustworthy.

Then apply the Standard Footer.
```

### Prompt 17 — Onboarding: first-session tutorial that gets a new user to a correct answer fast

```
Read PACKPTS_PROJECT_CONTEXT.md section 3 (Core UX) and the existing OnboardingModal component first.

Improve first-run onboarding so a brand-new user understands the loop and earns their first PackPTS within ~60 seconds: a 1-card guided tutorial (easy/famous card), an explainer of masking and scoring, and an immediate, visible reward + a clear next action (play more / start a streak). Keep it skippable. Measure completion (fire an onboarding_completed event into the funnel from Prompt 15).

Verify on mobile + desktop viewports; confirm the tutorial card is genuinely easy and that the event fires. Document in section 3.

Then apply the Standard Footer.
```

### Prompt 18 — Push / re-engagement notifications (streak reminder, daily challenge, match invite)

```
Read PACKPTS_PROJECT_CONTEXT.md sections 25/27 (push notifications listed as not implemented) and the retentionEmails service first.

Implement a re-engagement layer. Given this is currently a web app (native iOS is a separate, long plan), start with what works on the web today: web push (where supported) plus the existing email channel for streak-at-risk reminders, daily-challenge availability, and pending friend/match invites. Make cadence and opt-out configurable and respect user preferences; do not spam. Tie sends to real triggers (streak about to break, Daily 5 live, invite received).

Verify a streak-at-risk trigger produces exactly one notification per user per day and respects opt-out. Add a test for the trigger logic. Document in section 27 (move from planned to implemented for web).

Then apply the Standard Footer.
```

### Prompt 19 — Wire ELO to matchmaking (schema exists, logic doesn't)

```
Read PACKPTS_PROJECT_CONTEXT.md sections 5 and 12 (Matchmaking) first. The playerRatings table with ELO fields exists (default 1200, tiers BRONZE..LEGEND) but the random-match queue does not filter by rating.

Wire ELO into the matchmaking queue: pair players within an expanding rating band (start narrow, widen over wait time to avoid starvation in a low-population queue). Update ratings after each ranked match using a standard ELO update with a documented K-factor. Do not break the existing friend-match (direct invite) path.

Verify with simulated queues that close-rated players pair preferentially, that wait-time widening prevents starvation, and that ratings update correctly after a match (unit test the ELO math). Document in section 12; remove from section 25.

Then apply the Standard Footer.
```

### Prompt 20 — AI fallback opponent for an empty queue (kills the cold-start dead end)

```
Read PACKPTS_PROJECT_CONTEXT.md sections 5/12/25 first. With a small user base the random-match queue will frequently be empty — a dead end that kills the multiplayer hook before it can spread.

Implement an AI fallback: if no human is found within a timeout, offer a bot opponent that answers with calibrated accuracy/latency tuned to the player's ELO band (clearly labeled as a practice/bot match, with reduced or zero ranked-rating impact and a documented points policy so it can't be farmed — coordinate with the reward caps and anti-cheat). The bot must NOT see the answer in a way that could leak to the client; it operates server-side only.

Verify a solo user in an empty queue gets a bot match within the timeout, the bot's difficulty tracks the user's band, and bot matches cannot be exploited for unlimited points. Add tests for the anti-farm caps. Document in sections 5/12; remove from section 25.

Then apply the Standard Footer.
```

### Prompt 21 — Harden and finish the share/viral loop

```
Read PACKPTS_PROJECT_CONTEXT.md sections 3 (results screen, share) and the ShareAssetCard component and referrals routes first.

The memo leans on a "viral social distribution loop (score sharing + challenges)." Make it real and measurable:
- Ensure the results screen produces a clean, attractive share asset (image/card) with the score and a referral link carrying the user's referral code.
- Ensure shared/referral links land new users on a fast path to play (not a dead "link required" page), and that referral attribution is recorded into the funnel from Prompt 15.
- Verify referral rewards fire correctly and idempotently for both inviter and invitee.

Verify: generating a share asset works on mobile/desktop, the referral link attributes the new signup, and rewards are granted exactly once. Add a referral idempotency test. Document in section 3.

Then apply the Standard Footer.
```

### Prompt 22 — Define and enforce the North-Star metric and an internal weekly scorecard

```
Read PACKPTS_PROJECT_CONTEXT.md and PACKPTS_GROWTH_STRATEGY.md first.

Pick ONE North-Star metric that reflects real, retained engagement that maps to commerce intent — recommended: Weekly Active Players who completed >=1 match AND viewed >=1 marketplace card (i.e., engaged + intent-bearing). Implement an admin weekly scorecard that tracks: North-Star, new signups, D7/D30 retention (from Prompt 16), outbound-click CTR (from Prompt 15), affiliate-attributed revenue, subscription conversion, and ARPU. All from real data.

Add a section to PACKPTS_PROJECT_CONTEXT.md defining the North-Star and the scorecard so every future session optimizes the same thing. This replaces the fictional KPI table as the operating instrument.

Verify the scorecard renders with real numbers and the North-Star definition is documented and queryable.

Then apply the Standard Footer.
```

---

## PHASE 4 — COMMERCE & MONETIZATION HARDENING

### Prompt 23 — Marketplace listing price validation against market data

```
Read PACKPTS_PROJECT_CONTEXT.md sections 11 and 25 (no listing price validation) first.

Add validation so marketplace listings/redemption prices are sanity-checked against available market data (CardHedge / priceCharting service already integrated). Flag or block listings whose price deviates beyond a configurable band from reference price, to prevent manipulation and protect margin. Do not change profitPolicy.minMarginM without explicit approval — this adds a guardrail, it does not relax one.

Verify a deliberately out-of-band listing is flagged/blocked and an in-band one passes; add a test. Document in section 11; remove from section 25.

Then apply the Standard Footer.
```

### Prompt 24 — Verify and complete subscription lifecycle webhooks

```
Read PACKPTS_PROJECT_CONTEXT.md sections 10 and 25 (subscription renewal/cancellation needs verification) first.

Audit subscription lifecycle handling: customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed. Confirm entitlements are granted on payment, revoked on cancellation/expiry, and that failed-payment dunning is handled (grace vs immediate revoke — document the choice). Ensure idempotency on all of it.

Test each event in Stripe test mode -> correct entitlement state. Add tests to CI. Document in section 10; remove from section 25.

Then apply the Standard Footer.
```

### Prompt 25 — Decide and act on the dead `baseballCards` table

```
Read PACKPTS_PROJECT_CONTEXT.md section 6 (Card Data Model) first. There are two card tables; baseballCards is legacy/fallback only, playableCards is authoritative, and fallback references remain in matchService, maskingService, storage.

Make a deliberate decision and document it: either (a) formally keep baseballCards as a defensive fallback and add a clear comment + test asserting the fallback only triggers when playableCards is empty, or (b) plan its removal with a migration. Do NOT remove it casually — verify nothing live depends on it first by tracing all references. Recommend (a) now, (b) later, unless tracing shows it is truly unused.

Verify the chosen path with a test that exercises the fallback condition. Document the decision in section 6.

Then apply the Standard Footer.
```

### Prompt 26 — Automated risk scoring on top of existing event logging

```
Read PACKPTS_PROJECT_CONTEXT.md section 15 (Fraud/Risk) and 25 first. Event logging exists; scoring/auto-action does not.

Implement a basic, transparent risk-scoring pass that consumes existing rollup/event data and raises userRiskState scores for clear signals: velocity of redemptions, sudden point spikes, many accounts per device/IP cluster, rapid buy->redeem. Start with rules + thresholds (not ML), each documented and tunable. High scores flag for admin review (and optionally auto-freeze above a hard threshold — make auto-freeze opt-in via config, defaulting to flag-only to avoid false-positive lockouts).

Verify with synthetic abuse patterns that scores rise and flags appear; legitimate patterns do not trip. Add tests. Document in section 15; update section 25.

Then apply the Standard Footer.
```

### Prompt 27 — Phase 4 closeout: full regression + update the acquisition-readiness section

```
Read the entire PACKPTS_PROJECT_CONTEXT.md first.

Run the full suite (tsc, vitest, Playwright E2E) and confirm green. Then add/refresh an "Acquisition Readiness" subsection capturing the now-true state: clean compile + CI, proven auth, running liability clock, masking/scoring/wallet/webhook test coverage, chargeback+hold fraud controls, instrumented attribution loop, real retention dashboard, North-Star scorecard. For each item the memo's thesis depends on, link to the code/test that proves it. Explicitly list what is still NOT done (e.g., native iOS, live Goldin API, ML risk) so the doc never overstates readiness again.

Verify the whole suite is green and the readiness section is accurate.

Then apply the Standard Footer.
```

---

## MARKETING TRACK — ORGANIC-FIRST GROWTH ROADMAP

> Built on the assumption you confirmed: near-zero budget (~$0–2k/month), founder-led, organic, community- and content-driven. This is the correct posture for PackPTS right now anyway — not because money is tight, but because **you have no proof yet that the product retains.** Spending on paid acquisition before you have a D30 retention curve above ~20% (Prompt 16) is pouring water into a bucket you haven't checked for holes. Organic forces you to earn each user, which surfaces the holes cheaply.
>
> **Hard gate:** Do not begin any outbound marketing until Phase 1 is merged (compile green, debug leak gone, auth proven). Driving the small, opinionated collector communities you most need to a broken or sketchy-looking app is a one-time mistake — these communities have long memories and they talk.

### The strategic frame the memo got right, and the one number that matters

The memo's instinct — own the "discovery moment" and the intent graph — is sound. But discovery is owned by *being where collectors already are*, not by assuming they'll come to a new daily game. Card collecting in 2025–2026 lives in a dense, identifiable set of places: r/baseballcards and sport-specific card subreddits, card-Twitter/X, breaker live streams (Whatnot, Fanatics Live), Discord servers for specific sets and players, eBay and COMC power-buyers, and card-show floors. These are small, concentrated, and reachable for free. Your job in the near term is not "1M users." It is **300 true fans who play daily and tell other collectors**, because that is the only thing that produces the retention curve and the word-of-mouth coefficient that the entire acquisition thesis is supposed to rest on.

The one number to obsess over: **D30 retention of organically-acquired users.** Everything else (CAC, virality, LTV) is unknowable and unsellable until that number is real and stable.

### NEAR-TERM (0–3 months) — Prove the loop with a hardcore core

**Goal:** 300–1,000 registered users, of whom a meaningful slice (target: 20%+ at D30) come back. A daily ritual that a small group genuinely loves. The first honest retention cohort and the first attributed outbound click.

Specific actions, in priority order:

1. **Make the Daily 5 the spearhead, Wordle-style.** A single, shared, same-for-everyone daily challenge with a shareable score grid is the most viral-capable asset you already have. Polish the share output (Prompt 21 supports this): a clean image with the day's score, a streak count, and a referral link. The "everyone plays the same 5 today" mechanic is what makes a result worth posting. Confidence this is your best near-term lever: high.

2. **Found the home Discord and seed it personally.** A dedicated PackPTS Discord where the daily challenge drops, scores are posted automatically (you already have Discord posting scripts — `scripts/discord_post.py`, `daily5_morning_discord.py`, `daily5_recap_discord.py`), and you, as founder, are present every day. The first 100 retained users will come from a place where a human (you) reacts to their scores. Do not automate away your own presence in the first 90 days.

3. **Reddit, as a participant first and a marketer fifth.** You have a `REDDIT_STRATEGY.md` — execute the patient version, not the spammy one. Spend the first weeks genuinely participating in r/baseballcards and adjacent subs, then share the Daily 5 as a "can you ID these masked cards?" post that respects the sub's culture. Card subs nuke obvious self-promo on sight; they reward genuinely fun content. One well-received post in the right sub is worth more than fifty low-effort ones. Lead with the puzzle, not the pitch.

4. **Recruit 5–10 micro-influencer collectors / small breakers as charter players.** Not paid sponsorships — invitations. Give them Founders Pass status (the exclusivity mechanic already exists), let them post their scores, and let their audiences see them play. Small breakers (a few hundred to few thousand viewers) are dramatically more accessible and more trusted within the hobby than big-name endorsers, and they cost nothing but outreach time and a little status.

5. **Ship a weekly "card of the week" hook tied to real hobby moments.** When a rookie blows up, a vintage card sells big at auction, or a player hits a milestone, that card should appear in the game that week and in your social posts. Riding the hobby's existing news cycle is free distribution. (The `add_card_of_the_day.sql` migration suggests scaffolding exists — use it.)

6. **Instrument before you amplify.** Do not scale any of the above until Prompt 15 (attribution) and Prompt 16 (retention dashboard) are live. The entire point of the near-term phase is to *generate the proof*, and you cannot generate proof you aren't measuring. This is the dependency that ties the marketing track to the engineering phases.

**Near-term success criteria (honest, falsifiable):** a real D30 cohort number (whatever it is), at least one fully-attributed outbound→marketplace path recorded, a Discord with daily organic score-posting from real users, and one Reddit/social post that drove measurable signups without getting removed.

### MEDIUM-TERM (3–9 months) — Tighten the loop and earn word-of-mouth

**Goal:** Retention that holds (D30 trending toward the 20%+ range on real cohorts), a functioning referral loop with a measurable invite-to-signup rate, the first dollars of attributed affiliate revenue, and the beginnings of a content flywheel.

Specific actions:

1. **Turn the referral loop from feature to habit.** With Prompt 21 done, make referrals rewarding and visible: bonus PackPTS for both sides, a leaderboard of top inviters, and seasonal "bring a friend" challenges. Measure invite-sent → signup → D7-retained at each step. If the invite→signup rate is low, the share asset or landing path is the problem — fix that before adding more channels.

2. **Build the content flywheel on top of the autonomous social agent — carefully.** You have a GPT-4o-mini-driven growth agent and a `30_DAY_CONTENT_LIBRARY.md`. Use it to scale *evergreen, genuinely interesting* card content (history, trivia, "guess the player," market moments) across X/Instagram/TikTok — but with a human editor in the loop. Automated social content that is obviously automated erodes trust in a hobby that prizes authenticity. The agent drafts; a human (you, early on) approves. Tie every post to the funnel so you know which content actually drives plays.

3. **Run themed weekly tournaments / leagues once the multiplayer cold-start is solved.** Only after Prompts 19 (ELO) and 20 (AI fallback) ship — because a tournament that can't fill a bracket is worse than no tournament. Themed events ("80s Topps Week," "Rookie Card Showdown") give collectors a reason to return on a schedule and a reason to recruit friends to compete.

4. **Court the breaker/streamer ecosystem as a content channel.** Get PackPTS played live on Whatnot/Fanatics-Live-adjacent streams as a between-breaks segment. A breaker challenging chat to beat their Daily 5 score is native, free, repeatable distribution to a perfectly-targeted audience. Offer them a custom referral code so attribution is clean.

5. **Start the SEO/evergreen surface.** Card-identification, set guides, and "what's this card worth"-style content rank for long-tail collector queries and compound for free over time. Even a handful of strong evergreen pages can become a steady organic-signup trickle that costs nothing after it's written.

**Medium-term success criteria:** a referral coefficient you can actually quote, first attributed affiliate revenue (real dollars, however small), a content channel with a measurable click→play rate, and at least one repeatable external distribution partner (a breaker/streamer) sending traffic.

### LONG-TERM (9–24 months) — Scale what's proven, and build the acquisition story on evidence

**Goal:** Defensible, repeatable growth in the channels that demonstrably retain users; a behavior-and-intent dataset substantial enough to be independently valuable; and an acquisition narrative backed by instruments, not adjectives.

Specific actions:

1. **Pour fuel only on proven fires.** By now you'll know which channels produce retained users at what cost in time/money. *Only then* consider modest paid acquisition (the "$2–15k/mo" tier you didn't pick today) to accelerate channels with proven retention and a known payback. Paid before proof remains a mistake at every scale.

2. **Expand sport-by-sport, not all at once.** The schema already supports basketball/football/hockey. Each new sport is a fresh community to seed (its own subreddits, Discords, breakers) using the exact playbook that worked for baseball. Sequence them; don't dilute your founder-presence across five communities before one is self-sustaining.

3. **Productize the intent data — internally first.** The attribution loop (Prompt 15) and engagement data become the asset the memo promises. Build the recommendation/"complete this set" surfaces that turn behavioral data into commerce, and measure the lift. A demonstrated lift in marketplace conversion from your data is the single most valuable thing you can show an acquirer — it's the difference between "we have data" and "our data makes you money."

4. **Assemble the acquisition dossier from real artifacts.** Replace the fictional KPI table entirely with: the live retention dashboard, the North-Star scorecard (Prompt 22), the reconciled attribution funnel with real conversion rates, cohort LTV, and the documented fraud/financial controls. Walk into corp-dev conversations leading with proof and a defensible forward model built *from your own measured base rates* — not a 15x multiple on ARR you haven't earned. An acquirer's analyst will build their own model regardless; give them clean inputs and you control the anchor.

5. **Pursue ecosystem proximity before pursuing the term sheet.** The path to a Fanatics/eBay outcome runs through being *useful and visible to them* first — affiliate volume they can see, a presence at the card shows and events they run, integration conversations that start as partnerships. Strategic acquisitions are rarely cold; they're the formalization of a relationship and a demonstrated dependency. Build the dependency.

**Long-term success criteria:** at least one channel with a known, positive payback; a multi-sport footprint where at least baseball is self-sustaining; a demonstrated data-driven conversion lift; and an acquisition dossier composed entirely of measured artifacts.

### Marketing-supporting CLI prompts (build the automation the roadmap needs)

These slot into the Marketing track and follow the same Standard Footer (Part I). Run them after Phase 1, interleaved with Phase 2–3 as the dependencies note.

```
[Marketing Prompt A] Read PACKPTS_PROJECT_CONTEXT.md, PACKPTS_GROWTH_STRATEGY.md, and docs/GROWTH_AUTOMATION_SETUP.md first. Audit the autonomous social-media growth agent (server/services/socialMedia, growthAgent, contentFactory) and the Discord posting scripts. Produce a one-page truthful status: what posts automatically, to which platforms, on what schedule, with what human-approval step (if any). Identify anything posting unreviewed AI content publicly and add a mandatory human-approval gate before any external publish. Verify a draft cannot publish without explicit approval; add a test for the gate. Document in PACKPTS_GROWTH_STRATEGY.md. Then apply the Standard Footer.
```

```
[Marketing Prompt B] Read PACKPTS_PROJECT_CONTEXT.md section 3 and the referrals routes/ShareAssetCard first. Build a UTM/referral-tagged share + landing pipeline: every share asset and referral link carries source/medium/campaign tags that flow into the attribution funnel from Phase-3 Prompt 15, so each marketing channel's signups and retention are separable in the retention dashboard (Prompt 16). Verify a tagged link's signup is attributable to its channel end-to-end. Document the tagging scheme. Then apply the Standard Footer.
```

```
[Marketing Prompt C] Read docs/30_DAY_CONTENT_LIBRARY.md first. Wire the content library into the (now human-gated) social agent so the 30-day evergreen calendar can be scheduled, with each post tagged per Marketing Prompt B so its click->play->retain performance is measured. Do NOT enable any auto-publish without the approval gate from Marketing Prompt A. Verify scheduling works in draft mode and metrics attribute back per post. Document. Then apply the Standard Footer.
```

```
[Marketing Prompt D] Read PACKPTS_PROJECT_CONTEXT.md section 14 first. Add a "Growth Scorecard" admin view that, per acquisition channel (Reddit, Discord, X, referral, breaker codes), shows signups, D7/D30 retention, outbound-click CTR, and affiliate-attributed revenue — all from real data via the Prompt 15/16 instrumentation. This is the weekly instrument you run the organic roadmap from. Verify it renders real per-channel numbers. Document. Then apply the Standard Footer.
```

---

## APPENDIX — AUDIT EVIDENCE (what was actually checked)

Verified directly against the repo at HEAD `4e516a8b` on 2026-06-14:

- `npx tsc` → 7 errors (routes.ts:1091/1092/1124/1940; profitGuardrailService.ts:143; videoFactory/compositor.ts:12). Build (`script/build.ts`) uses esbuild and does not type-check, so these ship silently. **[verified]**
- `server/routes/friends.ts` ~line 13 → live `_probe` debug object in 401 responses exposing session internals. **[verified]**
- `git status` → `PACKPTS_PROJECT_CONTEXT.md`, `PACKPTS_GROWTH_STRATEGY.md`, `docs/30_DAY_CONTENT_LIBRARY.md`, `docs/GROWTH_AUTOMATION_SETUP.md`, and new scripts untracked; `CLAUDE.md` modified-uncommitted. **[verified]**
- `server/index.ts` → schedules Notion/growth/newsletter jobs; no reference to `expirationEngine`/`runExpiration` → expiration job unscheduled. **[verified]**
- `git log` → last ~10 commits strip a third-party OIDC provider, SSO buttons, and identity-provider enum values; no test proving auth survived. **[verified — risk; auth working state unknown]**
- `server/tests/` → 11 vitest specs exist (contradicting the doc's "no unit tests" claim); `tests/e2e/` has Playwright specs; **no `.github/workflows`** (no CI); `npx vitest run` aborts in a clean env on missing `@rollup/rollup-linux-arm64-gnu` (optional-dep/platform issue). **[verified]**
- Default IP-hash salt in `server/utils/hash.ts` and JWT dev-fallback present per doc section 25. **[doc-stated; salt presence confirmed via grep — production-override enforcement not present]**

Items in Phases 3–4 drawn from the doc's own Known-Bugs/Roadmap (ELO, AI fallback, wager settlement, risk scoring, chargeback flow, purchased-points hold, Goldin live API, price validation) were **not independently re-verified line-by-line** and are carried at moderate confidence; each prompt instructs the implementer to verify current state before acting.
