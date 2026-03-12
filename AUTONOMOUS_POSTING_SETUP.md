# Autonomous Social Media Posting Setup

PackPTS can automatically post content to Instagram, Facebook, and TikTok using AI-generated captions.

## Prerequisites

1. **OpenAI API Key** — for AI caption generation (see RAILWAY_ENV_SETUP.md)
2. **Social media business accounts** for each platform

## Instagram Setup

### Requirements
- Instagram Business or Creator account
- Facebook Page connected to your Instagram account
- Facebook Developer App with `instagram_basic`, `instagram_content_publish` permissions

### Steps
1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create a new App → Business type
3. Add Instagram Basic Display and Instagram Graph API products
4. Generate a long-lived access token (valid 60 days, must be refreshed)
5. Add to Railway: `INSTAGRAM_ACCESS_TOKEN=your_token_here`

### Testing
```bash
curl "https://graph.instagram.com/me?fields=id,username&access_token=YOUR_TOKEN"
```

## Facebook Page Setup

### Requirements
- Facebook Page (not personal profile)
- Page admin access
- Facebook App with `pages_manage_posts` permission

### Steps
1. In your Meta Developer App, add the Pages API product
2. Use Graph API Explorer to get a Page Access Token
3. Exchange for a long-lived token (never expires if Page token)
4. Add to Railway: `FACEBOOK_PAGE_ACCESS_TOKEN=your_token` and `FACEBOOK_PAGE_ID=your_page_id`

## TikTok Business Setup

### Requirements
- TikTok Business Account
- TikTok for Business developer account

### Steps
1. Go to [TikTok for Developers](https://developers.tiktok.com/)
2. Create an app and request `video.publish` scope
3. Complete the business verification process (may take 1-2 weeks)
4. Generate an access token via OAuth flow
5. Add to Railway: `TIKTOK_ACCESS_TOKEN=your_token`

## Enabling Autonomous Posting

Once credentials are set, enable the posting agent:
```
SOCIAL_MEDIA_AGENT_ENABLED=true
```

## Content Generation Schedule

The agent posts on a configurable schedule. Without OPENAI_API_KEY, posts use these templates:
- Leaderboard update: "This week's top PackPTS player: {username} with {points} points!"
- Daily challenge: "New cards loaded! Can you guess today's mystery player?"
- Streak highlight: "{username} is on a {days}-day streak!"

## Monitoring

Check posting status at: `GET /api/health` → `socialPlatforms` field
View posting history in admin panel: Admin → Social Media

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Posts not appearing | Check `SOCIAL_MEDIA_AGENT_ENABLED=true` is set |
| Token expired | Regenerate access token and update Railway env var |
| AI captions not working | Verify `OPENAI_API_KEY` is set and has credits |
| Rate limited | Reduce posting frequency in admin panel |
