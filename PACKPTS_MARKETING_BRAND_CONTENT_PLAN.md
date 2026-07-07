# PackPTS Marketing, Branding & Content Plan — July 2026

This is the umbrella plan that ties together the existing tactical documents — `PACKPTS_GROWTH_STRATEGY.md` (channel tactics, growth agents), `SOCIAL_MEDIA_CAMPAIGN.md` (30-day playbook), `MONETIZATION_PLAN.md`, and `REDDIT_STRATEGY.md` — into a single brand and acquisition-oriented narrative. Those documents remain the tactical source of truth; this one defines the strategy layer above them.

## 1. The strategic objective

Build PackPTS into an asset that multiple strategic acquirers (Fanatics, eBay, Goldin/Collectors Holdings, PSA, DraftKings, Topps) are forced to bid on within 24–36 months at a $100M+ valuation. Acquirers don't pay for revenue at this scale — they pay for three things we can manufacture: a daily-active audience inside their exact demographic (card collectors with purchase intent), proprietary engagement data (which players, sets, and eras drive attention — effectively a real-time demand signal for the $30B+ collectibles market), and a brand that owns a behavior ("the Wordle of the hobby").

Every marketing decision below is scored against one question: does it grow defensible DAU or deepen the demand-signal dataset?

## 2. Brand identity

**Positioning statement:** PackPTS is the daily skill game of the trading-card hobby. Your card knowledge earns real buying power.

**Brand pillars:**

*Knowledge pays.* The core emotional promise. Collectors have spent decades accumulating knowledge that never earned them anything. PackPTS converts hobby expertise into tangible value (points → discounts on Goldin/eBay). All copy should reinforce earned status, never gambling or luck.

*The daily ritual.* Wordle-class habit mechanics: one shared Daily 5, streaks, shareable results. The brand voice treats the daily challenge as an event ("Today's 5 is brutal — 1952 Topps deep cuts").

*Respect the hobby.* We are collectors talking to collectors. No corporate voice, no hype-bro tone, no manufactured FOMO. Vintage-card aesthetics (the blur-mask reveal is itself a brand asset — the moment of recognition is our signature visual).

**Visual identity notes:** The new pure-blur card mask is now a brand-consistent visual — a blurred name plate over an authentic vintage card should appear in every piece of social content, ads, and the App Store listing. It is instantly legible as "guess who this is." Commission a proper 1024px logo master (current icons are upscaled from a 128px favicon — this is on the engineering backlog too).

**Voice rules** (extends `SOCIAL_MEDIA_CAMPAIGN.md` §Brand Voice): first person plural, era-literate, playfully competitive, never condescending to new collectors. Banned: "web3," "to the moon," gambling language, artificial scarcity claims.

## 3. The incentive engine (never-ending signup & engagement loop)

The ask was a "never-ending series of incentives." The right structure is a quarterly-rotating calendar so incentives feel fresh but are operationally reusable:

**Always-on:** 250 PackPTS signup bonus (live), streak multipliers (live), referral rewards — raise the referral reward and make it double-sided (both parties earn) per the existing growth priority. Referral is the cheapest CAC we will ever have.

**Weekly:** Set of the Week (bonus points for a featured vintage set — also generates content and demand-signal data), Friday Rivalry (1v1 challenge pushes).

**Monthly:** themed tournaments with entry fees in points (monetization + sink), a "Rookie Class" onboarding league for that month's new signups so newcomers compete against each other, not veterans — this is the single most important retention mechanic for late adopters.

**Seasonal/event-driven:** MLB Opening Day, Hall of Fame induction weekend, World Series, National Sports Collectors Convention (July — imminent; run a "National" themed week), trade-deadline "guess the traded player" packs. Sports calendars give us a permanent event drumbeat for free.

**Milestone theater:** public counters (founders counter already exists), leaderboard immortality (monthly champions permanently displayed), physical redemption stories amplified as content ("Mike from Ohio turned 40 days of streaks into a graded '87 Topps card").

## 4. Content architecture (12-month)

Three content layers, mapped to the funnel:

**Layer 1 — Viral/top-of-funnel (daily):** The auto-generated video templates already in the codebase (difficulty ladder, memory shock, leaderboard flex, "only real fans") are the workhorse. Priority: finish TikTok/Instagram auto-posting (existing engineering priority). Format discipline: every asset ends with the blurred-card visual and "Can you name him? Play free."

**Layer 2 — Community/mid-funnel (weekly):** Reddit per `REDDIT_STRATEGY.md`, a weekly email ("The Rip") with the week's hardest card + hobby market notes, Discord events per `DISCORD_SETUP.md`. Community content should showcase player-generated moments: perfect Daily 5s, streak milestones, redemption unboxings.

**Layer 3 — Authority/acquisition-narrative (monthly):** This is the layer that builds the $100M story. Publish a monthly "PackPTS Hobby Attention Index" — which players/sets/eras our tens of thousands of daily guesses show rising or falling attention on. This is unique data nobody else has, it gets picked up by hobby media (Cllct, Sports Collectors Daily, hobby YouTube), and it demonstrates to acquirers exactly what dataset they'd be buying. CEO byline, quarterly trend reports, and eventually an API teaser.

## 5. Channel priorities and sequencing

Next 90 days: (1) ship auto-posting and run the 30-day playbook in `SOCIAL_MEDIA_CAMPAIGN.md` on repeat with weekly creative refresh; (2) double-sided referrals; (3) launch the Hobby Attention Index v1; (4) National Sports Collectors Convention activation (even just a themed in-game week + targeted content). Months 4–9: iOS app launch as a marketing event ("PackPTS in your pocket — streaks survive your commute"), App Store featuring pitch (Apple loves daily puzzle games), paid acquisition tests only after organic CAC baselines exist. Months 10–18: partnerships (card shops as referral affiliates, breaker/YouTuber co-branded challenges via `creators.tsx` infrastructure), licensed set partnerships if unit economics support it.

## 6. KPIs

North star: DAU. Guardrails: D1/D7/D30 retention (targets 45/25/12 for a daily puzzle game), streak participation rate (% of DAU with ≥3-day streak), K-factor from referrals (target ≥0.3 after double-sided launch), signup → first-game completion (>80%), and monthly redemption count (proof the "knowledge pays" promise is real — this number appears in every acquirer conversation). Instrument all of these in the existing admin metrics dashboard if not already present.

## 7. Acquisition-readiness checklist (ongoing)

Maintain a clean data room from day one: monthly KPI snapshots (automated), the Attention Index archive, cohort retention curves, unit economics per channel, and press/creator coverage log. When inbound interest arrives, the story is pre-assembled: "the daily habit of the hobby, with the demand-signal dataset for the entire collectibles market."
