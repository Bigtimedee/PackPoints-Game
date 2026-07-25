# PackPTS Collector Intelligence — Strategy & Build Plan

> **Board-level thesis.** PackPTS is not a trivia game. It is, inadvertently, the only company generating **demand-side attention and recognition data** for the sports-card market at the individual player/set/card level. This document is the plan to deliberately turn that exhaust into a governed, compounding, exportable data asset — the asset that makes PackPTS a *must-own* for Fanatics, Inc. at a $100M+ strategic premium in 18–24 months.

---

## 1. The Acquisition Thesis (why this is worth $100M+ to Fanatics specifically)

Fanatics owns the **supply and transaction** side of trading cards: Topps (what gets printed), Fanatics Collect / PWCC (what sells, at what price). Their blind spot is the **demand side that *precedes* the transaction** — which players collectors recognize, which cards command attention, and which attention converts to purchase intent — measured continuously, at scale, per card.

PackPTS produces exactly that signal as a byproduct of play:

- Every masked-card guess is a **recognition measurement** for a specific athlete.
- Every card shown, revealed, and lingered on is an **attention measurement** for a specific card/set/era.
- Every post-answer "Find this card" click is a **purchase-intent measurement** tied to that card.

No competitor has this. Fanatics cannot easily build it — it requires an engaged consumer game, which they do not operate. **The valuation is not a multiple of PackPTS revenue; it is a strategic premium for a unique, non-replicable, compounding dataset that de-risks Fanatics' card production, pack composition, pricing, and marketing decisions across a $40B+ market.**

The single sentence that closes the deal: *"PackPTS attention leads market price — here is the 18-month proof."*

## 2. The Crown-Jewel Insight (and the one thing that must happen immediately)

**The asset's value is a function of time-depth, and time-depth cannot be backfilled.** A 24-month longitudinal record of card attention — and its correlation with subsequent price movements — is the one thing a competitor starting later can never replicate, and the one thing money cannot buy at diligence time.

Therefore the #1 priority, ahead of every dashboard, is **bulletproof event instrumentation and daily market-price capture, starting now.** Every month of delay is permanent, unrecoverable asset value destroyed. Build the boring pipes first; the beautiful dashboards can come later because they query history — but only if the history exists.

## 3. Design Principles

1. **Instrument before you analyze.** Capture the full-fidelity event stream first (Prompts 1–2); indices and dashboards are derived views, never the source of truth.
2. **Clean signal is the product.** A buyer's diligence will stress-test data quality. Bot/fraud/flagged users are excluded from the *credible* analytics layer from day one; we keep raw and clean views side by side.
3. **Time-series over snapshots.** Everything is stored as a daily (or finer) time-series so trends, velocity, and lead/lag correlations are computable. Snapshots are worthless for the alpha story.
4. **Productized, not just reported.** The endpoint state is an exportable, documented, access-controlled read API — provable IP, not internal BI. This is what gets licensed or acquired.
5. **Privacy-clean by construction.** Analytics marts key on hashed user IDs; no email/PII in the analytical asset. Survives legal diligence and future regulation.
6. **Two audiences, one spine.** The same event spine powers *internal operating dashboards* (run the business better today) and the *acquisition data room* (sell the asset tomorrow).

## 4. The Signature Indices (the IP that headlines the data room)

| Index | Definition | Why an acquirer pays for it |
|---|---|---|
| **Card Attention Index (CAI)** | Normalized 0–100 score per (player, set, era) from recency-weighted play volume, unique reach, and reveal rate | A proprietary, continuous demand gauge per card — informs what Topps prints and features |
| **Recognition Index (RI)** | % of users who correctly identify a player, with confidence intervals + breakout velocity | A leading indicator of an athlete's cultural momentum — informs licensing, marketing, rookie card bets |
| **Commerce Intent Funnel** | play → correct → reveal → listing impression → click → attributed purchase, per card/set | A measured demand-to-dollars funnel no one else has — proves the audience buys |
| **Attention Alpha** | Lead/lag correlation of CAI time-series vs. CardHedge market price | The predictive signal — reframes PackPTS as card-market intelligence, not a game |
| **Trending / Market Pulse** | Rising/falling players, sets, eras with velocity + significance | The weekly artifact a Fanatics merchandiser would pay to receive |

Secondary compounding asset: **user-created sets (the Making Layer) are a proprietary, crowd-sourced taxonomy of what collectors care enough about to build** — a second, unique demand signal layered on the first.

## 5. The Admin Analytics Product

A new **Analytics** section in the Admin Dashboard, access-gated by an `analyst`/`investor` role:

- **Pulse** (home): headline CAI movers, recognition breakouts, funnel conversion, trending eras — the daily operating view.
- **Cards & Players**: searchable CAI + RI leaderboards, per-entity time-series drill-downs.
- **Sets**: engagement, completion, play-depth, user-created-set trends.
- **Commerce**: the intent funnel, top converting cards, attributed revenue.
- **Attention Alpha**: the correlation engine + backtest — the crown-jewel view.
- **Data Room**: the diligence-ready executive view + exports + API docs.

---

## 6. The Build Sequence (executable prompts)

Each prompt is self-contained. Do not start a prompt until the previous one's gate is verified. **Prompts 1, 2, and the price-capture note are time-critical — they start the longitudinal clock and should ship first, in parallel with everything else the company is doing.**

### Prompt 1 — The Analytics Event Spine (instrument first)

**Objective:** Capture every high-signal moment as an append-only, dimensioned event stream. This is the foundation; everything else is derived from it.

**Tasks:**
1. Add an `analytics_events` table (append-only): `id, event_type, occurred_at, user_hash (sha256 of userId+salt, never raw), session_id, is_clean (bool, false if user is flagged/frozen/bot per risk state), player_key (normalized sport:name), game_set_id, set_name, sport, brand, year, card_id, is_user_created_set, latency_ms (nullable), payload jsonb`. Indexes on `(event_type, occurred_at)`, `(player_key, occurred_at)`, `(game_set_id, occurred_at)`.
2. Add `server/services/analytics/track.ts` with a fire-and-forget `track(event)` that never blocks or throws into the request path (queue + batch insert; drop on failure with a counter).
3. Instrument these events at their existing call sites: `card_shown`, `answer_submitted` (with `{outcome: correct|incorrect|skipped, latency_ms}`), `reveal_shown`, `listing_impression`, `listing_click` (reuse the `set-reveal` outbound path), `set_selected`, `set_started`, `set_completed`, `set_published`.
4. Derive `is_clean` from `userRiskState` (NORMAL = clean) so the credible layer is separable from raw.
5. Backfill what is safely reconstructable from `game_sessions.questions` history (one-time script) — clearly flagged as backfilled, not live-captured.

**Verify:** Play a full game and complete a redemption; confirm one row per real action with correct dimensions, and that flagged-user actions are marked `is_clean = false`.

**⚠️ Parallel immediate action (do not defer):** Add a daily job that snapshots CardHedge market prices for all played players/sets into a `card_price_history` time-series. Attention Alpha (Prompt 6) is impossible without a price time-series, and it cannot be backfilled. Start capturing now.

---

### Prompt 2 — Dimensional Rollup Marts

**Objective:** Aggregate the raw event spine into fast, durable, query-optimized daily marts so dashboards never scan raw events and the indices are reproducible.

**Tasks:**
1. Create marts: `card_attention_daily`, `player_recognition_daily`, `set_engagement_daily`, `commerce_funnel_daily` — each keyed by entity + `date`, storing the day's counts (plays, unique users, correct/incorrect/skipped, avg latency, reveals, listing impressions, clicks, attributed purchases, revenue cents).
2. Build an idempotent incremental rollup worker (hourly for today, nightly finalize) reading the event spine; store both `all` and `clean` variants.
3. One-time backfill from the event spine (and the Prompt 1 backfill) so history exists from day one.
4. Reconciliation check: mart sums must equal raw event counts for a sampled day.

**Verify:** Marts reconcile to raw counts; a 90-day query returns in <100ms.

---

### Prompt 3 — The Card Attention Index (signature metric)

**Objective:** Define and ship the headline number — a normalized attention score per (player, set, era) with trend and velocity.

**Tasks:**
1. Define CAI = normalized 0–100 from recency-weighted plays, unique-user reach, and reveal rate; compute trailing 7/30/90-day values and Δ-velocity per entity. Document the formula in a data dictionary.
2. Admin API `GET /api/admin/analytics/attention` (leaderboard, filters: sport/era/set/window) and `GET /api/admin/analytics/attention/:playerKey` (time-series).
3. Flagship Admin page: CAI leaderboard, per-entity sparkline drill-down, movers.
4. Compute over the **clean** layer by default; expose an `all` toggle.

**Verify:** Leaderboard matches hand-computed CAI for a sampled player; velocity flags a synthetically boosted player.

---

### Prompt 4 — The Recognition Index

**Objective:** Ship the athlete cultural-momentum signal — recognition rate and breakout detection.

**Tasks:**
1. RI = % correct identification per player over time, with a volume floor and Wilson confidence intervals so low-sample players are not noise.
2. Breakout detection: rising RI-velocity above a significance threshold → a weekly "Recognition Breakouts" list (the rookie-momentum signal).
3. Admin API + page with confidence-banded time-series.

**Verify:** A known-famous player shows high RI with tight bands; a synthetic rising player triggers a breakout.

---

### Prompt 5 — The Commerce Intent Funnel

**Objective:** Measure attention → dollars, per card/set/player.

**Tasks:**
1. Funnel from the marts: card_shown → correct → reveal → listing_impression → listing_click → attributed_purchase (join `outbound_clicks` source `set-reveal` + `attributed_purchases`).
2. Compute step conversion, click-through, and attributed revenue per entity; top-converting cards.
3. Admin page: funnel viz + converting-cards leaderboard + revenue attribution.

**Verify:** Funnel counts reconcile to `outbound_clicks`/`attributed_purchases`; a test click flows end-to-end.

---

### Prompt 6 — Attention × Market-Price Correlation Engine (crown jewel)

**Objective:** Prove PackPTS attention leads market price — the predictive-signal story.

**Tasks:**
1. Join `card_attention_daily` with `card_price_history` (from Prompt 1's parallel capture) per entity.
2. Compute lead/lag cross-correlation per card and in aggregate; identify cards where rising attention *precedes* price ("undervalued by attention").
3. Portfolio backtest: does buying the top attention-velocity decile beat the market? Report the "Attention Alpha" curve.
4. Admin "Attention Alpha" page: correlation heatmap, lead/lag distribution, the backtest curve, and a watchlist of attention-leading cards.

**Verify:** The backtest runs over available history; the lead/lag stat is reported with confidence and honest caveats about sample depth.

---

### Prompt 7 — Trending & Market Pulse

**Objective:** The real-time pulse + the weekly artifact you'd hand a Fanatics merchandiser.

**Tasks:**
1. Trending engine: rising/falling players, sets, eras over 24h/7d/30d with velocity + statistical significance; include trending user-created sets.
2. Weekly "Market Pulse" digest (dashboard + email) — the top movers, breakouts, and attention-leading cards.
3. Admin Pulse home wiring.

**Verify:** Trending list matches computed velocities; the digest renders and sends.

---

### Prompt 8 — Clean-Signal & Data Governance

**Objective:** Make the asset survive technical *and* legal diligence.

**Tasks:**
1. Enforce the raw-vs-clean split everywhere (flagged/frozen/bot users excluded from the credible layer); document exclusion rules.
2. PII governance: confirm no email/PII in any analytics mart; analytics keyed only on `user_hash`; document the hashing + salt handling.
3. Publish a data dictionary + lineage doc (every index → its formula → its source events).
4. A daily data-quality monitor (row-count anomalies, dimension-null spikes, reconciliation drift) with alerting.

**Verify:** A flagged user's activity is absent from clean marts; a PII scan of the analytics schema is empty; the data dictionary covers every published index.

---

### Prompt 9 — The Acquisition Data Room

**Objective:** The diligence-ready deliverable you screen-share in the acquisition meeting.

**Tasks:**
1. An `investor`/`analyst`-gated executive view: the headline indices, the unique-signal explainer, TAM-of-data framing, cohort segments, the Attention Alpha backtest, dataset size/growth.
2. Exports: CSV/Parquet of the marts + a documented, versioned, read-only **Analytics API** (this is the "it's a product" proof).
3. Access controls, audit logging of data-room access, and a one-page "what makes this data unique and non-replicable" narrative baked into the UI.

**Verify:** A fresh `investor` account sees only the data room; an export downloads and re-imports cleanly; the API returns documented, stable schemas.

---

## 7. 18–24 Month Value-Creation Roadmap

| Phase | Months | Prompts | Valuation milestone |
|---|---|---|---|
| **Instrument** | 0–3 | 1, 2 (+ price capture) | The unique dataset exists and begins compounding. *The clock starts.* |
| **Index** | 3–9 | 3, 4, 5 | Proprietary indices live; internal decisions improve; **attention→purchase funnel proven (revenue proof).** |
| **Predict** | 9–18 | 6, 7 | Enough history for a credible **attention→price lead (alpha proof)** — the reframe from "game" to "market intelligence." |
| **Package** | 18–24 | 8, 9 | Clean, governed, exportable, API-productized — **diligence-ready.** Open the data-room conversation with Fanatics. |

**The four proofs that justify $100M+:** (1) the dataset is unique and compounding; (2) attention converts to dollars (funnel); (3) attention leads price (alpha); (4) it is clean, governed, and productized. Prompts 1–9 deliver all four, in order.

## 8. Risks & Moat

- **Under-instrumentation risk (existential):** every un-captured month is permanent lost value. Mitigation: Prompts 1–2 and price capture ship first, non-negotiably.
- **Signal-pollution risk:** bots/farming corrupt the data a buyer scrutinizes. Mitigation: clean-layer separation from day one (leverages the risk-scan worker already shipped).
- **Privacy/regulatory risk:** PII in the asset kills a deal or invites liability. Mitigation: hashed-ID, PII-free marts by construction.
- **The moat:** proprietary demand signal × time-depth × compounding engagement × proven price-lead. None of the four is replicable by a competitor starting later — which is precisely why an acquirer buys rather than builds.
