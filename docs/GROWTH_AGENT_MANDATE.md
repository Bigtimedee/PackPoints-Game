# PackPTS Growth Agent Mandate

## Purpose

This document describes the production Growth Agent architecture implemented around four continuous responsibilities.

> Listen → Create → Distribute → Learn

The objective is not to maximize post volume. The objective is to increase qualified daily active users by turning real PackPTS product activity into measurable creative and then learning which creative produces actual gameplay and retention.

## 1. Listen

The listener converts real PackPTS activity into ranked growth signals.

Current internal signal sources include

- completed Daily 5 activity
- PackPTS generated score cards
- Daily 5 rank cards
- leaderboard spotlight assets
- streak badge assets
- other approved PackPTS share assets
- material streak milestones

Each signal receives a 0 to 100 score.

The listener also accepts approved external signals through the Admin API for

- trends
- anniversaries
- collector debates
- editorial opportunities

The system intentionally does not scrape social platforms. External trends are explicit inputs so PackPTS can preserve source quality, platform compliance, and factual control.

## 2. Create

The creative layer receives

- ranked real product signals
- the real PackPTS screenshot or video attached to the signal
- recent winning creative performance
- the requested platform
- a creative specific attribution URL

The AI may write the hook, caption, script, overlay, hashtags, and CTA.

It may not invent

- player facts
- scores
- leaderboard results
- streaks
- prizes
- financial outcomes
- visual content that is not actually attached

Every Growth Agent creative has a UUID. That same creative ID is written to the UTM content field.

## Media rule

The mandate will not create a publishable item without an approved PackPTS asset.

Approved assets currently include

- PackPTS generated share assets
- PackPTS generated videos
- existing PackPTS Daily 5 product screenshots
- approved PackPTS brand and Play Sets assets

An external random URL is not an approved asset.

This rule is intentional. Missing media must stop distribution rather than degrade into an embarrassing text only post that refers to a nonexistent image.

## 3. Distribute

Growth Agent creative is staged into the existing Admin Publishing Queue.

The default state is manual review.

This is deliberate because the Growth Agent should not bypass the existing media and social publishing safeguards.

TikTok remains manual by default.

Instagram, YouTube, X, and Reddit can be enabled as generation targets through environment variables. Enabling a target does not automatically bypass the publishing queue.

## 4. Learn

The Learn layer evaluates published creative against product outcomes.

For each published social post, the system uses the social post ID as the creative ID.

The CTA uses

- utm_source = platform
- utm_medium = social
- utm_campaign = growth_agent
- utm_content = creative ID

Existing first touch attribution links resulting registrations back to the creative.

The Learn layer then measures

- impressions
- clicks
- attributed signups
- game starts
- activations
- D1 retained users
- D7 retained users
- qualified DAUs per 1,000 impressions

Activation currently means an attributed user completed at least one match or Daily 5.

Qualified DAUs per 1,000 impressions is

> attributed activated users ÷ impressions × 1,000

The Growth Agent feeds the strongest recent creative performance patterns back into the next Create cycle.

It should produce variations of ideas that generate gameplay rather than continuously invent unrelated posts.

## Continuous runner

Set

`GROWTH_AGENT_MANDATE_ENABLED=true`

to enable the recurring runner.

Default interval is 60 minutes.

The interval can be configured with

`GROWTH_AGENT_INTERVAL_MINUTES`

Values below 60 are clamped to 60 minutes.

The runner has an overlap guard. A second cycle will not start while the previous cycle is still running.

## Daily creative cap

Default

`GROWTH_AGENT_MAX_CREATIVES_PER_DAY=6`

The allowed range is 1 through 20.

This prevents runaway generation and unexpected API usage.

## Winner threshold

Default

`GROWTH_AGENT_WINNER_MIN_IMPRESSIONS=100`

Creative below the threshold can still be measured, but the learning layer prefers creatives that have accumulated enough impressions to be directionally useful.

## Platform controls

- `GROWTH_TIKTOK_ENABLED`
- `GROWTH_X_ENABLED`
- `GROWTH_INSTAGRAM_ENABLED`
- `GROWTH_REDDIT_ENABLED`
- `GROWTH_YOUTUBE_ENABLED`

TikTok is enabled unless explicitly set to false to preserve compatibility with the existing Growth Agent.

Other platforms are opt in.

## Model controls

- `OPENAI_API_KEY`
- `GROWTH_AGENT_MODEL`

Default model remains `gpt-4o-mini` for compatibility with the existing codebase.

If OpenAI is unavailable, the mandate can still produce conservative deterministic fallback copy from real PackPTS signals. It does not invent facts.

## Admin controls

Admin Growth now includes a Growth Mandate tab.

It shows

- ranked current signals
- whether each signal has verified media
- creative performance
- QDAU per 1,000 impressions

Admin can also

- run the mandate cycle immediately
- recompute creative learning immediately

Additional Admin APIs

- GET `/api/admin/growth/signals`
- POST `/api/admin/growth/signals/external`
- POST `/api/admin/growth/mandate/run`
- GET `/api/admin/growth/creative-performance`
- POST `/api/admin/growth/creative-performance/compute`

All require authenticated Admin access.

## External signal payload

Example

```json
{
  "signalType": "ANNIVERSARY",
  "title": "Approved editorial fact or opportunity",
  "score": 85,
  "payload": {
    "source": "internal editorial review"
  },
  "assetPath": "/generated/share/2026-10-02/example.png"
}
```

An external signal without an approved asset may be stored and reviewed but cannot become a publishable Growth Agent creative.

## Data model

New tables

### growth_signals

Stores internal and approved external opportunities.

Important fields

- signal_key
- source
- signal_type
- title
- score
- payload
- asset_path
- observed_at
- expires_at

### growth_creative_metrics

Stores the latest measured performance for each creative.

Important fields

- creative_id
- platform
- content_type
- impressions
- clicks
- signups
- game_starts
- activations
- d1_retained
- d7_retained
- qdau_per_thousand

## Brand integrity rules

1. Real PackPTS media is mandatory for Growth Agent creative.
2. Missing media blocks creation rather than creating a text only substitute.
3. AI copy is constrained to supplied facts.
4. No guaranteed prizes.
5. No gambling language.
6. No invented performance claims.
7. Distribution uses the existing Publishing Queue.
8. The learning objective is gameplay and retention, not likes or raw views.

## Relationship to the existing Social Media Agent

The existing Social Media Agent and its platform publishers remain intact.

The Growth Agent mandate does not replace

- Twitter publisher
- TikTok publisher
- Discord publisher
- media preflight
- social analytics
- A B tests
- prompt evolution

Instead, this mandate adds a product driven intelligence layer above the existing infrastructure.

The long term direction is

PackPTS activity
→ ranked signal
→ factual creative
→ verified PackPTS media
→ Publishing Queue
→ platform distribution
→ attribution
→ activation and retention measurement
→ winning creative patterns
→ next generation creative

## Deployment sequence

1. Apply the database migration.
2. Deploy with `GROWTH_AGENT_MANDATE_ENABLED=false`.
3. Open Admin Growth and run one manual mandate cycle.
4. Confirm signals and Publishing Queue media.
5. Confirm creative attribution URLs contain the creative UUID.
6. Publish a small reviewed sample.
7. Refresh Creative Performance after platform analytics accumulate.
8. Only then enable the continuous runner.

## Operational success criterion

The Growth Agent is working when PackPTS can answer

> Which creative produces the most qualified gameplay per 1,000 impressions, and does that traffic return on D1 and D7?

If the system cannot answer that question, it should not increase creative volume.
