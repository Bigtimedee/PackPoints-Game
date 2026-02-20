# Growth Agent System

AI-powered content generation and social media automation for PackPTS.

## Overview

The Growth Agent generates daily content plans, creates platform-specific posts, and auto-publishes to configured social platforms. It runs on a scheduler with circuit-breaker protection and supports manual triggering from the admin dashboard.

## Architecture

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

1. **Plan Generation**: AI generates a daily content plan with theme, hook, and target platforms
2. **Content Generation**: Per-platform content items are created (Discord, X, Instagram, Reddit, etc.)
3. **Compliance Validation**: Second AI pass checks brand rules and auto-rewrites violations
4. **Diversity Checking**: Database queries prevent duplicate hooks (2-day window) and repeated player names (72-hour window)
5. **Context Enrichment**: Prompts are enriched with in-app events (Daily 5 winners, card set themes, seasonal moments)
6. **Auto-Posting**: Items with AUTO posting mode are published to configured platforms
7. **Manual Queue**: Items with MANUAL_QUEUE mode appear in the admin queue for review/copy

### Safety Systems

- **Circuit Breaker**: 5 failures in 30 minutes pauses auto-posting for 30 minutes
- **Zod Validation**: All AI outputs validated against strict schemas before database insertion
- **Compliance Validator**: Checks content against brand rules, auto-rewrites once if violations found
- **Diversity Tracker**: Prevents repetitive content by tracking recent hooks, themes, and player names

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `GROWTH_AGENT_ENABLED` | Set to `true` to enable the scheduler. Default: `false` |

### Platform Credentials

#### Discord
| Variable | Description |
|---|---|
| `DISCORD_WEBHOOK_URL` | Discord webhook URL for auto-posting |

#### X / Twitter
| Variable | Description |
|---|---|
| `TWITTER_API_KEY` | Twitter API consumer key |
| `TWITTER_API_SECRET` | Twitter API consumer secret |
| `TWITTER_ACCESS_TOKEN` | Twitter user access token |
| `TWITTER_ACCESS_SECRET` | Twitter user access secret |

#### Instagram
| Variable | Description |
|---|---|
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Facebook Business Account ID |
| `INSTAGRAM_ACCESS_TOKEN` | Facebook Graph API access token (long-lived) |

#### Reddit
| Variable | Description |
|---|---|
| `REDDIT_CLIENT_ID` | Reddit OAuth app client ID |
| `REDDIT_CLIENT_SECRET` | Reddit OAuth app client secret |
| `REDDIT_USERNAME` | Reddit account username |
| `REDDIT_PASSWORD` | Reddit account password |
| `REDDIT_TARGET_SUBREDDITS` | Comma-separated list of target subreddits (default: `baseballcards`) |
| `REDDIT_USER_AGENT` | Custom user agent string (default: `PackPTS Growth Agent/1.0`) |

## Database Tables

| Table | Purpose |
|---|---|
| `growth_content_plans` | Daily content plans with theme, hook, target platforms |
| `growth_content_items` | Individual content pieces per platform |
| `growth_job_runs` | Job execution log with status, timing, errors |
| `publishing_queue` | Manual publishing queue for non-auto platforms |

## Admin Dashboard

Navigate to `/admin/growth` (requires admin role).

### Tabs

- **Overview**: System status, circuit breaker state, platform connections, pipeline health indicator
- **Plans**: View/archive/activate content plans
- **Content**: Browse generated content items by platform and status
- **Queue**: Copy text for manual posting, mark items as posted
- **Job Logs**: View job execution history, retry failed/skipped jobs

### Manual Job Triggers

From the Overview tab, click any registered job name to run it manually. Jobs are idempotent and safe to re-run.

## Posting Modes

| Mode | Behavior | Platforms |
|---|---|---|
| `AUTO` | Published automatically by the auto_post job | Discord, X/Twitter, Instagram |
| `MANUAL_QUEUE` | Added to publishing queue for admin review | Reddit, TikTok, YouTube |

Reddit uses MANUAL_QUEUE by default due to stricter anti-spam policies. The Reddit adapter supports auto-posting when triggered manually but is rate-limited to 1 post per subreddit per day.

## TikTok Manual Mode

TikTok integration uses **manual mode only** — there is no TikTok API auto-posting. The Growth Agent generates structured TikTok content packages (scripts, captions, hashtags, shot lists) and places them in the admin Publishing Queue for manual posting.

### Setup

| Variable | Description |
|---|---|
| `GROWTH_TIKTOK_ENABLED` | Set to `true` to enable TikTok content generation. Default: `false` |
| `GROWTH_TIKTOK_MODE` | `manual` (default) or `off`. Only `manual` mode is supported. |

### How It Works

1. When enabled, the `generate_tiktok_packages` job runs daily at 13:20 UTC (after daily plan + content generation)
2. It generates 3 TikTok packages per day:
   - **TIKTOK_DAILY5_ANNOUNCEMENT** — Announces the Daily 5 Challenge (scheduled 8 PM ET)
   - **TIKTOK_TRIVIA_CHALLENGE** — Baseball card trivia video (scheduled 10 AM ET)
   - **TIKTOK_LEADERBOARD_SPOTLIGHT** — Spotlights Daily 5 top performers (scheduled 9 PM ET)
3. Each package is saved to `growth_content_items` (platform=tiktok, postingMode=MANUAL_QUEUE, status=READY) and to `publishing_queue`
4. Deterministic dedupe keys prevent duplicate generation on re-runs

### TikTok Package Schema

Each TikTok content item has rich metadata (stored in `growth_content_items.metadata`):

```json
{
  "hook": "Attention-grabbing opening line",
  "script": "Full voiceover script (15-35 seconds)",
  "on_screen_text": ["Overlay line 1", "Overlay line 2"],
  "caption": "TikTok caption (max 2200 chars, prefer under 200)",
  "hashtags": ["#packpts", "#baseballcards", ...],
  "cta": "Call to action",
  "thumbnail_text": "Max 6 words for thumbnail",
  "format_notes": "Shot list, timing, transitions",
  "audio_notes": "Background music / sound effects",
  "asset_refs": [{ "type": "card_image", "card_id": "...", "url": "..." }],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "2025-02-20:TIKTOK_DAILY5_ANNOUNCEMENT"
}
```

### Admin Workflow

Navigate to **Admin → Growth → Queue** tab, then filter by "TikTok" platform:

1. **Copy Caption** — Copies the caption text to clipboard
2. **Copy Hashtags** — Copies hashtags joined with spaces
3. **Copy Caption + Hashtags** — Caption + newline + hashtags
4. **Copy Script** — Copies the voiceover script
5. **Download Script (.txt)** — Downloads a complete text file with hook, script, caption, hashtags, and shot list
6. **Download Asset List** — Downloads asset_refs as JSON
7. **Mark as Posted** — Updates status to POSTED with timestamp
8. **Undo Posted** — Reverts to READY
9. **Bulk actions** — Select multiple READY items for bulk mark-as-posted or bulk copy captions
10. **Manual Posting Checklist** — Step-by-step guide for posting to TikTok

## Content Schemas

All AI-generated content is validated with Zod schemas before saving:

- **Plans**: theme (string), hook (string), targetPlatforms (array of platform enums)
- **Discord/Reddit/Instagram posts**: title, body (with platform-specific length limits), hashtags
- **X Threads**: title, body (tweets separated by `\n---\n`), hashtags
- **Video Scripts**: title, body (HOOK/BODY/CTA format), hashtags
- **Daily 5 Announcements/Recaps**: title, body, hashtags
- **TikTok Packages**: hook, script, on_screen_text, caption, hashtags, cta, thumbnail_text, format_notes, audio_notes, asset_refs, legal_safe, dedupe_key

## Operational Notes

- The scheduler uses UTC-based daily scheduling with same-day deduplication
- Job runs are tracked with idempotency keys to prevent duplicate execution
- The circuit breaker automatically resets after a 30-minute cooldown
- Pipeline health is monitored: if no plan exists by 3 AM UTC or no content by 5 AM UTC, the stalled indicator shows in the admin dashboard
- Content context is enriched with real app data (yesterday's Daily 5 winners, active card sets, seasonal moments) to make posts more relevant and timely
- TikTok packages are generated independently of the main content items pipeline — they have their own dedicated job and prompt templates
