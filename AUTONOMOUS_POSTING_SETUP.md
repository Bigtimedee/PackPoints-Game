# Autonomous Social Media Posting Setup

## Overview

PackPTS Growth Engine now supports **fully autonomous posting** to all social media platforms with ZERO human intervention. The agent posts content automatically according to the daily schedule.

---

## ✅ Currently Working (Auto-Posting Enabled)

### X/Twitter
- **Status:** ✅ ACTIVE
- **Credentials:** Already configured and validated
- **Posts:** Daily threads, trivia, announcements

### Discord
- **Status:** ✅ ACTIVE
- **Credentials:** Webhook configured
- **Posts:** Community updates, announcements

---

## ⚙️ Setup Required for Full Automation

### Instagram Auto-Posting

**Required Environment Variables:**
```bash
INSTAGRAM_BUSINESS_ACCOUNT_ID=your_instagram_business_account_id
INSTAGRAM_ACCESS_TOKEN=your_long_lived_access_token
```

**How to Get Credentials:**

1. **Convert to Business Account:**
   - Go to Instagram → Settings → Account → Switch to Professional Account
   - Choose "Business"

2. **Connect to Facebook Page:**
   - Create a Facebook Page if you don't have one
   - Link your Instagram Business account to the Facebook Page

3. **Get Access Token:**
   - Go to https://developers.facebook.com/tools/explorer
   - Select your Facebook App (or create one)
   - Get User Token with permissions: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`
   - Exchange for Long-Lived Token (60 days): https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived

4. **Get Instagram Business Account ID:**
   ```bash
   curl "https://graph.facebook.com/v21.0/me/accounts?access_token=YOUR_TOKEN"
   # Get the page ID, then:
   curl "https://graph.facebook.com/v21.0/{PAGE_ID}?fields=instagram_business_account&access_token=YOUR_TOKEN"
   ```

5. **Add to Railway:**
   ```
   INSTAGRAM_BUSINESS_ACCOUNT_ID=17841...
   INSTAGRAM_ACCESS_TOKEN=EAAx...
   ```

**Supports:**
- ✅ Photos (with captions, hashtags)
- ✅ Reels (short-form videos)
- ✅ Automatic publishing after processing

---

### Facebook Auto-Posting

**Required Environment Variables:**
```bash
FACEBOOK_PAGE_ID=your_facebook_page_id
FACEBOOK_PAGE_ACCESS_TOKEN=your_page_access_token
```

**How to Get Credentials:**

1. **Create Facebook Page:** https://www.facebook.com/pages/creation

2. **Create Facebook App:**
   - Go to: https://developers.facebook.com/apps/
   - Click "Create App" → Business → Next
   - Name: "PackPTS Content Manager"
   - Add "Facebook Login" and "Pages API" products

3. **Get Page Access Token:**
   - Go to Graph API Explorer: https://developers.facebook.com/tools/explorer
   - Select your app
   - Get User Access Token with permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`
   - Click "Get Page Access Token"
   - Select your page
   - Copy the token

4. **Get Page ID:**
   ```bash
   curl "https://graph.facebook.com/v21.0/me/accounts?access_token=YOUR_USER_TOKEN"
   ```

5. **Add to Railway:**
   ```
   FACEBOOK_PAGE_ID=10801234567890
   FACEBOOK_PAGE_ACCESS_TOKEN=EAAx...
   ```

**Supports:**
- ✅ Text posts
- ✅ Photo posts
- ✅ Video posts

---

### TikTok Auto-Posting

**Required Environment Variables:**
```bash
TIKTOK_ACCESS_TOKEN=your_tiktok_access_token
```

**How to Get Credentials:**

1. **Create TikTok Developer Account:**
   - Go to: https://developers.tiktok.com/
   - Sign up with your TikTok account

2. **Create an App:**
   - Click "Manage apps" → "+ Connect an app"
   - Name: "PackPTS Content Manager"
   - Select "Content Posting API"

3. **Get Authorization:**
   - Follow OAuth 2.0 flow: https://developers.tiktok.com/doc/login-kit-web/
   - Request scopes: `video.publish`, `video.upload`
   - User must authorize your app

4. **Exchange Code for Access Token:**
   ```bash
   curl -X POST "https://open.tiktokapis.com/v2/oauth/token/" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "client_key=YOUR_CLIENT_KEY" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=AUTHORIZATION_CODE" \
     -d "grant_type=authorization_code"
   ```

5. **Add to Railway:**
   ```
   TIKTOK_ACCESS_TOKEN=act.xxxxx...
   ```

**Supports:**
- ✅ Video posts (up to 60 seconds)
- ✅ Captions and hashtags
- ✅ Privacy settings (public/friends/private)

**Note:** TikTok access tokens expire after 24 hours. You'll need to implement token refresh or re-authorize daily. Alternatively, use a service like **Ayrshare** or **Hookle** that handles TikTok OAuth for you.

---

## Alternative: Third-Party Posting Services

If you prefer not to manage individual API credentials, use a unified social media API:

### Option 1: Ayrshare (Recommended)
- **Website:** https://www.ayrshare.com/
- **Cost:** $49/month for 100 posts/day
- **Supports:** TikTok, Instagram, Facebook, X, LinkedIn, YouTube
- **Benefits:** Single API for all platforms, handles OAuth, token refresh, rate limiting

**Setup:**
```bash
AYRSHARE_API_KEY=your_api_key
```

Then modify platformAdapters.ts to use Ayrshare's unified API.

### Option 2: Hookle
- **Website:** https://hookle.net/
- Similar to Ayrshare, supports all major platforms

---

## Testing the Autonomous Agent

Once credentials are configured:

1. **Verify in Railway Logs:**
   ```
   [GrowthAgent] x credentials: VALID
   [GrowthAgent] Instagram/Facebook: AUTONOMOUS AUTO-POSTING ENABLED
   [GrowthAgent] TikTok: ENABLED (autonomous mode)
   ```

2. **Trigger Manual Test Run:**
   ```bash
   railway run node -e "
   const { executeJob } = require('./dist/server/services/growth');
   executeJob('auto_post_ready_content').then(console.log);
   "
   ```

3. **Monitor Auto-Posting:**
   - Auto-posting runs at **2:00 PM** and **6:00 PM** Chicago time daily
   - Check Railway logs:
     ```bash
     railway logs --filter "AutoPoster"
     ```

4. **Check Posted Content:**
   - X/Twitter: https://twitter.com/PackPTS
   - Instagram: https://instagram.com/PackPTS
   - Facebook: https://facebook.com/PackPTS
   - TikTok: https://tiktok.com/@PackPTS

---

## Posting Schedule

| Time (Chicago) | Content Type | Platforms |
|---------------|-------------|-----------|
| 1:05 AM | Daily 5 Announcement | Discord, X |
| 5:00 AM | Daily 5 Recap | Discord, X |
| 9:00 AM | "Only Real Fans" TikTok | TikTok, Instagram Reels |
| 10:00 AM | Trivia Challenge | TikTok, Instagram, Facebook, X |
| 12:00 PM | "Memory Shock" TikTok | TikTok, Instagram Reels |
| 1:00 PM | Daily Plan | Discord |
| 2:00 PM | **AUTO-POST RUN #1** | All enabled platforms |
| 3:00 PM | "Pack Pull Drama" TikTok | TikTok, Instagram Reels |
| 5:00 PM | "Difficulty Ladder" TikTok | TikTok, Instagram Reels |
| 6:00 PM | **AUTO-POST RUN #2** | All enabled platforms |
| 7:00 PM | "Era Wars" TikTok | TikTok, Instagram Reels |
| 8:00 PM | Daily 5 Announcement | TikTok, Instagram, Facebook, X |
| 9:00 PM | Leaderboard Spotlight | TikTok, Instagram, Facebook, X |
| 9:30 PM | "Leaderboard Flex" TikTok | TikTok, Instagram Reels |

---

## Troubleshooting

### "Instagram credentials invalid"
- Access token expired (60 days max). Get a new long-lived token.
- Check permissions: needs `instagram_content_publish`

### "Facebook credentials invalid"
- Page access token expired. Regenerate from Graph API Explorer.
- Ensure app has `pages_manage_posts` permission

### "TikTok credentials invalid"
- Access token expired (24 hours). Implement token refresh flow.
- Or switch to Ayrshare which handles this automatically.

### "Circuit breaker open"
- Too many failed posts triggered safety mechanism
- Check Railway logs: `railway logs --filter "CircuitBreaker"`
- Reset: POST to `/api/admin/growth/circuit-breaker/reset`

### Content not posting automatically
1. Check `postingMode` is "AUTO" not "MANUAL_QUEUE"
2. Verify `status` is "READY" not "FAILED" or "POSTED"
3. Check platform is not in `MANUAL_ONLY_PLATFORMS` array (should be empty)

---

## Environment Variables Summary

**Required for Full Autonomy:**
```bash
# X/Twitter (already configured)
TWITTER_API_KEY=...
TWITTER_API_SECRET=...
TWITTER_ACCESS_TOKEN=...
TWITTER_ACCESS_SECRET=...

# Instagram
INSTAGRAM_BUSINESS_ACCOUNT_ID=...
INSTAGRAM_ACCESS_TOKEN=...

# Facebook
FACEBOOK_PAGE_ID=...
FACEBOOK_PAGE_ACCESS_TOKEN=...

# TikTok
TIKTOK_ACCESS_TOKEN=...

# Optional: Discord (already configured)
DISCORD_WEBHOOK_URL=...

# Optional: Reddit
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USERNAME=...
REDDIT_PASSWORD=...
REDDIT_TARGET_SUBREDDITS=baseballcards,sportscards
```

---

## Next Steps

1. ✅ Code is ready for autonomous posting
2. ⚠️ Add Instagram credentials to Railway
3. ⚠️ Add Facebook credentials to Railway
4. ⚠️ Add TikTok credentials to Railway (or use Ayrshare)
5. ✅ Deploy and monitor logs
6. ✅ Verify posts appear on all platforms automatically

**Once credentials are added, the agent will handle all posting with ZERO human intervention!** 🚀
