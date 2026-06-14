# PackPTS Growth Strategy — Consolidated Briefing

> **This file is the single source of truth for all PackPTS growth, marketing, monetization, and competitive strategy.** Hand this to any agent, team member, or AI assistant working on growth. It consolidates: CONTENT_MARKETING_30_DAY.md, REDDIT_STRATEGY.md, MONETIZATION_PLAN.md, COMPETITOR_ANALYSIS.md, GROWTH_AGENT.md, and the growth sections of PACKPTS_PROJECT_CONTEXT.md.

**Product:** PackPTS — a competitive trading-card recognition game at packpts.com
**Stack:** React 18 + Express.js + PostgreSQL + Stripe + Railway
**Current state:** Live, pre-scale, Founders Pass phase

---

## 1. Product Thesis & Positioning

PackPTS taps trading-card nostalgia and transforms it into a competitive, mobile-first game. Users see real card images with the player name masked, guess the player from multiple-choice options, and earn PackPTS (points) based on difficulty, rarity, card vintage, and player fame.

**Commercial flywheel:** Users play free → earn points → want more points → buy bundles → spend points in marketplace (eBay/Goldin affiliate) → PackPTS earns affiliate commissions and retains margin on point sales. Subscriptions add recurring revenue. iOS will add IAP revenue.

**Positioning sweet spot:** High skill ceiling + real-world monetary value + free entry. No competitor owns this quadrant.

```
                HIGH REAL-WORLD VALUE
                        |
            Sorare      |    PackPTS ← WE ARE HERE
          (high cost)   |    (free, knowledge-based)
                        |
LOW SKILL ──────────────┼──────────────── HIGH SKILL
                        |
      Topps App         |    Stadium Talk
    (brand loyalty)     |    (pure community)
                        |
                LOW REAL-WORLD VALUE
```

---

## 2. Competitive Landscape

### Direct Competitors

**Sorare** — Fantasy sports + NFT cards. Pay-to-win, crypto-native complexity. Different audience (speculators vs trivia enthusiasts). PackPTS angle: "You don't need to buy anything to start. If you know your cards, you earn."

**Whatnot** — Live auction + social selling. Passive consumption, no skill element. Same collector audience, different use case. PackPTS angle: "Whatnot is for watching. PackPTS is for proving you know your stuff."

**Card Ladder / PWE / Market Movers** — Card valuation tools. Utility-first, no entertainment. Partial overlap — users who track values are deep collectors who'd excel at PackPTS trivia. Angle: "You already know the comps. Now prove you know the players."

**Fanatics / Topps App** — Official publisher apps. Walled garden, heavy upsell. PackPTS is platform-agnostic and offers real discounts vs in-app currency.

**DraftKings / FanDuel** — Daily fantasy sports. We borrow their "daily contest" mechanic (Daily 5) without gambling regulation complexity. Free-to-play, knowledge-rewarding, not chance-based.

### Indirect Competitors (Attention)
- Pokémon TCG Pocket: different IP, our users are real-card collectors
- Bleacher Report Card Trader: digital-only, no real-world card value
- Sporcle: no collecting angle, no earnings, no community

---

## 3. Game Modes & Engagement Loops

**Solo Play** — Select card set → select card count (5/10/15/20) → play through cards → results screen. Server-side scoring with fame, vintage, rarity multipliers. Per-match cap 1,000 pts, daily cap 5,000 pts.

**Daily 5 Challenge** — Same 5 cards for all users each day, daily leaderboard. Key virality mechanic.

**1v1 Friend Match** — Create lobby with 6-char join code, share with friend, compete real-time via WebSocket.

**1v1 Random Match** — Matchmaking queue, paired with random opponent.

**Streaks** — Daily play maintains streak; milestones grant bonus points; freeze tokens protect streaks.

**Marketplace** — Browse eBay/Goldin listings contextually matched to gameplay; redeem PackPTS as discounts.

**Store** — Purchase PackPTS bundles or subscriptions via Stripe.

---

## 4. Monetization Model

### Product Catalog

| SKU | Name | Type | PackPTS | Price |
|-----|------|------|---------|-------|
| packpts_100 | Starter Pack | packpts_pack | 100 | $0.99 |
| packpts_500 | Value Pack | packpts_pack | 500 | $4.99 |
| packpts_1200 | Super Pack | packpts_pack | 1,200 | $9.99 |
| packpts_2500 | Mega Pack | packpts_pack | 2,500 | $19.99 |
| pro_monthly | Pro Monthly | subscription | 200/mo bonus | $4.99/mo |
| pro_yearly | Pro Yearly | subscription | 200/mo bonus | $39.99/yr |

### Revenue Streams
1. **Point pack sales** via Stripe (web) and IAP (iOS planned)
2. **Subscriptions** with monthly PackPTS bonus + unlimited games + bonus multiplier
3. **Affiliate commissions** from eBay/Goldin marketplace purchases
4. **Margin retention** on point-to-discount conversions

### Wallet Architecture
- Append-only ledger (no direct balance updates)
- FIFO point-bucket expiration
- Database transactions for atomicity
- Per-match and daily caps enforced server-side
- Admin controls for balance adjustment, refunds, clawbacks

### Entitlements

| Entitlement | Requirement |
|-------------|------------|
| premium_cards | Subscription active |
| unlimited_games | Subscription active |
| bonus_multiplier (1.5x) | Subscription active |
| 1v1_mode | Subscription OR 100 PackPTS |
| tournament_entry | 500 PackPTS entry fee |

### Purchase Verification Flow
Client initiates purchase → Platform SDK → Receipt sent to /api/purchases/verify → Server verifies with platform API (Apple/Google/Stripe) → Credit PackPTS to wallet via ledger → Return success.

---

## 5. Growth Agent System (Automated)

AI-powered content generation and social media automation built into the platform.

### Architecture
```
Scheduler (ticks every 60s)
  └─> Job Runner (idempotent, DB-backed)
       ├─> generate_daily_plan  → AI creates theme + hook for the day
       ├─> generate_content     → AI creates per-platform content items
       ├─> daily5_announcement  → Generates Daily 5 challenge teaser
       ├─> daily5_recap         → Generates yesterday's Daily 5 results post
       └─> auto_post            → Publishes READY items to configured platforms
```

### Content Pipeline
1. Plan Generation: AI generates daily plan with theme, hook, target platforms
2. Content Generation: Per-platform content items created (Discord, X, Instagram, Reddit)
3. Compliance Validation: Second AI pass checks brand rules, auto-rewrites violations
4. Diversity Checking: Prevents duplicate hooks (2-day window), repeated player names (72-hour window)
5. Context Enrichment: Prompts enriched with in-app events (Daily 5 winners, card set themes, seasonal moments)
6. Auto-Posting: AUTO mode items published; MANUAL_QUEUE items go to admin queue

### Safety Systems
- Circuit Breaker: 5 failures in 30 minutes pauses auto-posting for 30 minutes
- Zod Validation: All AI outputs validated against strict schemas
- Compliance Validator: Brand rules enforcement with auto-rewrite
- Diversity Tracker: Prevents repetitive content

### Required Environment Variables
- `GROWTH_AGENT_ENABLED=true`
- `OPENAI_API_KEY` (GPT-4o-mini for content generation)
- Discord: `DISCORD_WEBHOOK_URL`
- X/Twitter: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`
- Instagram: `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN`
- Reddit: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_TARGET_SUBREDDITS`

### Admin Dashboard
Navigate to `/admin/growth`. Tabs: Overview, Plans, Content, Queue, Job Logs. Manual job triggers available.

---

## 6. Content Marketing — 30-Day Launch Strategy

**Objective:** 500+ new registrations and 200+ DAU within 30 days through organic content.
**Channels:** X/Twitter, Reddit, TikTok, Instagram, Discord, Email.
**Voice:** Confident, collector-to-collector, trivia-nerd energy — never corporate.

### Week 1 — Seed (Days 1-7): Establish Presence

Goal: Publish consistently. No paid spend. Get first 50 organic users from collector communities.

| Day | Theme | Primary Channel |
|-----|-------|----------------|
| 1 | Launch post — "We built the game collectors have wanted forever" | X, Reddit r/baseballcards |
| 2 | Trivia Tuesday — Show cropped card, ask followers to guess | X, Instagram |
| 3 | How it works — 3-step explainer (Guess → Earn → Redeem) | TikTok, Instagram Reel |
| 4 | Set spotlight — 1989 Topps deep-dive trivia fact | Reddit, Discord |
| 5 | Early access hook — "First 100 to register get Founder status" | X, Discord |
| 6 | Weekend card porn — Beautiful card image + guess the player | Instagram, X |
| 7 | Week 1 recap — "X people played this week, here's what we learned" | X |

### Week 2 — Amplify (Days 8-14): Find Best Content, Repeat

Goal: Identify 1-2 post formats that drove most clicks. Double down. Target 150 registered users.

| Day | Content | Hook |
|-----|---------|------|
| 8 | Daily 5 launch post | X, Reddit |
| 9 | Leaderboard screenshot — Top 5 players | X, Discord |
| 10 | Myth vs Reality — "Think you know your 90s inserts?" | X, TikTok |
| 11 | Player spotlight — Feature top-scoring user | Instagram, X |
| 12 | Set announcement — "Adding [set] next week" | Reddit, Discord |
| 13 | Weekend challenge — Screenshot Daily 5 score + share | X, Instagram |
| 14 | Stats post — "This week: X games played, most-missed card was…" | X |

### Week 3 — Convert (Days 15-21): Awareness → Registrations

Goal: Make registration the obvious next step. Target 300 total registered users.

Key moves:
1. "You already play this game in your head" post — "Every time you see a card at a show and think 'I know that guy'… you're already playing PackPTS."
2. Stats bomb X thread — Most-missed card stats, fastest guess records, top requests
3. Reddit AMA in r/baseballcards: "I built a card trivia game — AMA"
4. Referral social proof posts — "[User] just hit [N] PackPTS. That's [discount] toward their next Goldin pickup."

### Week 4 — Compound (Days 22-30): Build the Loop

Goal: Current users bring new users. Launch referral content hooks. Hit 500 registrations.

Share loop content:
1. Daily 5 share card → post to X/Instagram
2. Streak milestone posts — "X is on a 7-day streak"
3. Set completion badge — "Completed the full 1989 Topps set"
4. Top-scorer weekly callout — leaderboard top 10

Distribution mix target:

| Channel | Posts/Week | Primary Goal |
|---------|-----------|-------------|
| X | 7 (1/day) | Brand discovery, card trivia engagement |
| Reddit | 2-3 | High-intent collector acquisition |
| TikTok | 3 | Top-of-funnel reach, 18-35 demos |
| Instagram | 4 | Card visual content, share-card reposting |
| Discord | Daily | Community retention, feedback loop |
| Email | 1 newsletter | Week-over-week progress, top plays |

### Email Sequences for New Registrants
- Day 0: Welcome + how to earn your first 100 PackPTS
- Day 1 (if no game played): "Your first game takes 2 minutes — here's why it's worth it"
- Day 3 (if no game played): Re-engagement with "today's hardest card" teaser
- Day 7: Streak reminder + "players who play daily earn 3x more PackPTS"

### Metrics to Track Weekly

| Metric | Week 1 | Week 4 |
|--------|--------|--------|
| New registrations | 50 | 500 |
| DAU | 30 | 200 |
| Daily 5 completion rate | — | 40% of DAU |
| Organic social reach | 2,500 | 25,000 |
| Email open rate | — | 45% |
| Content pieces published | 15 | 60 total |

---

## 7. Reddit Strategy (Detailed)

### Target Subreddits — Primary (Sports Cards)

| Subreddit | Members | Focus |
|-----------|---------|-------|
| r/baseballcards | 400K+ | Baseball card collecting — primary |
| r/footballcards | 200K+ | Football card collecting |
| r/basketballcards | 150K+ | Basketball card collecting |
| r/sportscards | 300K+ | General sports cards |
| r/sportscardsgg | 100K+ | General + marketplace |

### Secondary (Sports Fans)

| Subreddit | Members |
|-----------|---------|
| r/baseball | 1.8M |
| r/nba | 5M |
| r/nfl | 4M |

### Content Types

1. **"Can you identify this card?" posts** — Image with player name blurred. "This [year] [brand] card has stumped 70% of players. Who is it?"
2. **Trivia/Knowledge posts** — "What's the most valuable rookie card from the 1990s?"
3. **Score screenshots** — "I scored X/10 on today's PackPTS challenge"

### 4-Week Reddit Campaign
- Week 1 (Soft Launch): Post mystery cards in r/baseballcards, share quiz results in r/basketballcards, "Top 5 hardest cards" in r/sportscards
- Week 2 (Engagement): Respond to all Week 1 comments, post in r/nba about basketball cards, comment naturally on card valuation threads
- Week 3 (Cross-Subreddit): r/football + r/nfl card of the day, r/trivia challenge, r/sportscardsgg "free way to test card knowledge"
- Week 4 (Community): Ask r/sportscards "What sets should we add?", share leaderboard highlights, monthly recap

### Reddit Do's
- Provide genuine value before mentioning PackPTS
- Engage with comments authentically
- Use image posts (higher engagement)
- Add UTM params: `packpts.com?utm_source=reddit&utm_medium=post&utm_campaign=SUBREDDIT&utm_content=POST_TYPE`
- Respond within 1 hour of posting

### Reddit Don'ts
- Don't post same content to multiple subs simultaneously
- No self-promotional language ("Check out my app!")
- Don't post more than 1x/day per subreddit
- Don't ignore moderator rules
- Don't spam comments on unrelated threads

Target: 50+ Reddit-attributed signups per month by Week 8.

---

## 8. Channel-Specific Tactics

### Discord (Best for Retention)
1. Join existing collector Discord servers, post Daily 5 results nightly
2. Create PackPTS Discord: #daily-5-results, #set-requests, #trivia-challenge, #leaderboard, #general
3. Run Discord-exclusive challenges for exclusivity

### TikTok (Top of Funnel)
1. "Can you name this player in 3 seconds?" — crop card, count down
2. "The most missed card in 1989 Topps" — educational + surprising
3. "I earned $X off my last card purchase by playing trivia" — outcome-driven
4. "POV: You've been a collector for 20 years and still get stumped" — relatable
Hook formula: Open with wrong/surprising/funny answer. Never "So today I want to talk about..."

### X/Twitter (Engagement + Influencer)
1. Cropped card guesses — 3-5x normal impressions for obscure cards
2. Stats/data posts — "78% of players missed this card"
3. Hot takes — "1990 Donruss is more culturally important than 1952 Topps"
4. Score screenshots from real users

### Influencer Outreach
Target: collectors on YouTube/TikTok with 5k-100k subs (micro-influencers convert better for niche apps). Offer founder accounts with boosted points. No obligations — honest feedback approach.

---

## 9. Content Rules

### Always
- "discount toward cards" — never "earn money" or "cash equivalent" (legal safety)
- Write like a person, not a brand
- Value-first content before any PackPTS mention

### Never
- Hype unbuilt features as live
- Over-automate (Reddit/Discord smell bots)
- Engagement-bait ("retweet to win") — builds low-quality audience

### Quick Wins Available Now
1. Add packpts.com link to all personal collector social bios
2. Post in existing card Discord servers (personal account)
3. Leave helpful trivia comments in card subreddits with profile linking to game
4. Daily 5 announcement post at 8 AM ET daily (Growth Agent)
5. Screenshot and post top Daily 5 results at 9 PM ET nightly

---

## 10. Growth Flywheel Database

The platform tracks growth metrics in these tables:

| Table | Purpose |
|-------|---------|
| growth_content_plans | Daily content plans with theme, hook, target platforms |
| growth_content_items | Individual content pieces per platform |
| growth_job_runs | Job execution log with status, timing, errors |
| publishing_queue | Manual publishing queue for non-auto platforms |
| global_growth_rollups | Daily aggregated growth metrics |
| user_growth_rollups | Per-user daily growth metrics |
| share_events | Content sharing/viral tracking |

Admin API endpoints at `/api/admin/growth/*` for plans, queue, flywheel metrics, top users, top assets, and job runs.
