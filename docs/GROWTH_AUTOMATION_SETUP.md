# PackPTS Growth Automation Setup

## Overview

This document describes the automated posting infrastructure for PackPTS growth.

Three layers of automation exist:

1. **Social Media Agent** (in-process, server-side) — Autonomous Twitter + TikTok posting
2. **Growth Agent** (triggered, server-side) — AI content plan generation + manual posting queue
3. **External Automation** (cron/scripts) — Daily 5 announcements, Discord posting, channel-specific scheduling

---

## Layer 1: Social Media Agent (Server-Side)

### Activation Steps

1. Set in Railway:
   ```
   SOCIAL_MEDIA_AGENT_ENABLED=true
   AGENT_DRY_RUN=true              # Start in dry-run mode
   OPENAI_API_KEY=sk-...           # GPT-4o-mini for content generation
   ```

2. Configure Twitter (if posting to X):
   ```
   TWITTER_API_KEY=...
   TWITTER_API_SECRET=...
   TWITTER_ACCESS_TOKEN=...
   TWITTER_ACCESS_TOKEN_SECRET=...
   TWITTER_BEARER_TOKEN=...
   ```

3. Configure TikTok (if posting photo cards):
   ```
   TIKTOK_CLIENT_KEY=...
   TIKTOK_CLIENT_SECRET=...
   TIKTOK_ACCESS_TOKEN=...
   TIKTOK_REFRESH_TOKEN=...
   ```

4. Deploy: `git push main` (Railway auto-deploys)

5. Verify: Check the `/api/admin/social-agent/status` endpoint or server logs
   for startup summary showing which platforms are enabled.

6. When confident, disable dry run:
   ```
   AGENT_DRY_RUN=false
   ```

### What It Does Automatically

- **2 AM EST daily:** Builds a queue of 2-4 posts per platform
- **8 AM, 12 PM, 4 PM, 8 PM EST:** Scheduled post delivery
- **Every 60 seconds:** Checks for due posts and publishes them
- **Every 6 hours:** Fetches post analytics from Twitter/TikTok
- **1 AM EST daily:** Runs prompt evolution (generates next-gen copy from A/B test winners)

### Admin Dashboard

Navigate to `/admin/growth` to:
- View generated content plans and items
- Review and edit content before posting
- Trigger manual content generation for a specific date
- View job run logs and errors
- See growth flywheel metrics (DAU, k-factor, shares)

---

## Layer 2: Growth Agent (Manual Trigger)

### Usage

From the admin dashboard or via API:

```bash
# Trigger content generation for today
curl -X POST https://packpts.com/api/admin/growth/trigger \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-05-26"}'
```

This generates:
- A daily content plan with themes and goals
- Per-platform content items (TikTok scripts, Instagram captions, X tweets, Reddit posts)
- Publishing queue entries for manual posting

### Platform Toggles

Set in Railway to control which platforms get content items:
```
GROWTH_TIKTOK_ENABLED=true
GROWTH_INSTAGRAM_ENABLED=true
GROWTH_X_ENABLED=true
GROWTH_REDDIT_ENABLED=true
```

---

## Layer 3: External Automation Scripts

### Daily 5 Announcements

**Morning Announcement (8 AM ET):**
```bash
python3 scripts/daily5_announcement.py --type morning --format text
```

**Evening Recap (9 PM ET):**
```bash
python3 scripts/daily5_announcement.py --type recap --format text
```

### Discord Posting

Requires `DISCORD_WEBHOOK_URL` env var.

```bash
# Post a direct message
python3 scripts/discord_post.py --message "Daily 5 is live!"

# Post from Daily 5 announcement output
python3 scripts/daily5_announcement.py --type morning > /tmp/daily5.json
python3 scripts/discord_post.py --file /tmp/daily5.json --platform discord

# Pipe directly
echo "New card set dropping tomorrow!" | python3 scripts/discord_post.py
```

### Hermes Cron Jobs

To set up automated Daily 5 posting via Hermes Agent:

**Daily 5 Morning Announcement (8 AM ET daily):**
```
Schedule: 0 12 * * *  (8 AM ET = 12:00 UTC)
Script: scripts/daily5_announcement.py --type morning --format text
Action: Post the "discord" platform text to Discord webhook
```

**Daily 5 Evening Recap (9 PM ET daily / 1 AM UTC next day):**
```
Schedule: 0 1 * * *  (9 PM ET = 01:00 UTC next day)
Script: scripts/daily5_announcement.py --type recap --format text
Action: Post the "discord" platform text to Discord webhook
```

---

## Posting Schedule (All Times ET)

| Time | Source | Platform | Content |
|------|--------|----------|---------|
| 1 AM | Social Media Agent | Internal | Prompt evolution (nightly) |
| 2 AM | Social Media Agent | Internal | Daily queue build |
| 8 AM | Social Media Agent | Twitter/TikTok | Scheduled post slot 1 |
| 8 AM | External Script | Discord | Daily 5 morning announcement |
| 12 PM | Social Media Agent | Twitter/TikTok | Scheduled post slot 2 |
| 4 PM | Social Media Agent | Twitter/TikTok | Scheduled post slot 3 |
| 8 PM | Social Media Agent | Twitter/TikTok | Scheduled post slot 4 |
| 9 PM | External Script | Discord | Daily 5 evening recap |

---

## Content Steering

### prompt_program.md

Edit `prompt_program.md` in the project root to steer the prompt evolution
direction. The Social Media Agent reads this file nightly and uses it to
generate next-generation copy variants. This is the primary lever for
controlling what kind of content gets produced.

### Campaign Alternation

The Social Media Agent alternates between two campaigns:
- **Even days:** New User Acquisition (TRIVIA_CARD, NEW_USER_ACQUISITION, CHALLENGE, etc.)
- **Odd days:** Retention (STREAK_MILESTONE, REWARD_ANNOUNCEMENT, CHALLENGE, etc.)

### Content Library

For manual posting (Reddit, Instagram, Discord), use the 30-day content library
at `docs/30_DAY_CONTENT_LIBRARY.md`. This has ready-to-post copy for all channels
organized by week and day.

---

## Monitoring

### Key Logs to Watch

Server logs (Railway):
- `[SocialMedia]` — All social media agent activity
- `[Scheduler]` — Queue building and publishing
- `[ContentGenerator]` — AI content generation
- `[FactChecker]` — Claim verification
- `[Preflight]` — Post blocking
- `[PromptEvolution]` — Nightly copy evolution

### Admin Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/admin/social-agent/status` | Agent running state |
| `GET /api/admin/growth/plans` | Content plans |
| `GET /api/admin/growth/queue` | Publishing queue |
| `GET /api/admin/growth/job-runs` | Job execution history |
| `GET /api/admin/growth/flywheel` | Growth metrics (DAU, k-factor) |
| `GET /api/admin/growth/flywheel/top-users` | Top growth-driving users |
| `GET /api/admin/growth/flywheel/top-assets` | Most-shared content |
| `POST /api/admin/growth/trigger` | Trigger content generation |
| `POST /api/admin/growth/flywheel/compute` | Compute rollup metrics |

---

## Checklist: Going Live

- [ ] OPENAI_API_KEY set in Railway
- [ ] SOCIAL_MEDIA_AGENT_ENABLED=true in Railway
- [ ] AGENT_DRY_RUN=true initially
- [ ] Twitter credentials configured (if posting to X)
- [ ] TikTok credentials configured (if posting to TikTok)
- [ ] Discord webhook URL configured (for Daily 5 announcements)
- [ ] Deploy via git push main
- [ ] Verify agent status at /api/admin/social-agent/status
- [ ] Check /admin/growth for queued content
- [ ] Monitor logs for first 24 hours
- [ ] Disable dry run when satisfied: AGENT_DRY_RUN=false
- [ ] Set up external cron for Daily 5 Discord announcements
