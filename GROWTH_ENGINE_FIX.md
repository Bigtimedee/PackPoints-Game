# Growth Engine Fix - Railway Deployment

## 🔴 Root Cause: OpenAI API Connection Error

Your logs show:
```
[GrowthJobRunner] Job generate_daily_plan failed: Connection error.
```

**Problem:** The Growth Engine uses OpenAI (GPT-4o-mini) to generate content. On Replit, it used the **Replit AI Integration** which doesn't exist on Railway.

**Solution:** Add your OpenAI API key to Railway environment variables.

---

## ✅ IMMEDIATE FIX - Add OpenAI API Key

### Step 1: Get OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Click **"Create new secret key"**
3. Name it: `PackPTS-Railway-Production`
4. Copy the key (starts with `sk-...`)

### Step 2: Add to Railway

1. Railway dashboard → **PackPoints-Game** service → **Variables** tab
2. Click **"+ New Variable"**
3. Add:
   ```
   OPENAI_API_KEY=sk-proj-xxxxx...your-actual-key
   ```
4. Click **"Add"**

### Step 3: Restart Service

Railway will auto-restart. Wait 2 minutes, then check logs:
```bash
railway logs --filter "OpenAI"
```

You should see:
```
[OpenAI/Growth] Using user-provided OPENAI_API_KEY ✅
[OpenAI/Growth] Connectivity check PASSED
```

---

## 📊 Verify Fix - Check Pipeline Health

### Option 1: Via Logs
```bash
railway logs --filter "GrowthJobRunner"
```

Look for:
```
✅ [GrowthJobRunner] Job generate_daily_plan SUCCEEDED
✅ [GrowthJobRunner] Job generate_content_items SUCCEEDED
```

### Option 2: Via Admin Dashboard

1. Go to: `https://packpoints-game-production.up.railway.app/admin/growth`
2. Check **Pipeline Health** banner at top
3. Should show: **GREEN** for all stages

### Option 3: Via API

```bash
curl https://packpoints-game-production.up.railway.app/api/admin/growth/overview
```

Look for `"overall": "GREEN"` in response.

---

## 🎯 Expected Behavior After Fix

### Daily Schedule (Chicago Time):

| Time | Job | Output |
|------|-----|--------|
| 7:00 AM | `generate_daily_plan` | Creates content calendar for today |
| 7:16 AM | `generate_content_items` | Generates 5-7 social posts |
| 8:00 AM | `auto_post_ready_content` | Auto-posts to X/Twitter |
| 1:00 PM | `generate_tiktok_packages` | Creates 3 TikTok content items (MANUAL) |
| 1:35 PM | `render_tiktok_videos` | Generates MP4 videos |
| 1:40 PM | `crosspost_to_ig_fb` | Creates Instagram/Facebook variants (MANUAL) |
| 6:30 PM | `generate_daily5_recap` | Recap of today's challenge |

### What Auto-Posts:
- ✅ **X/Twitter** - Automatic
- ✅ **Discord** - Automatic (if webhook configured)

### What Goes to Manual Queue:
- 📋 **TikTok** - Videos generated, you post manually
- 📋 **Instagram** - Content ready, you post manually
- 📋 **Facebook** - Content ready, you post manually

---

## 🤖 NOTION INTEGRATION - Social Media Posting Workflow

You want Notion to manage posting across all platforms. Here's how to architect this:

### Option A: Notion as Content Queue (Recommended)

**Architecture:**
```
PackPTS App → PostgreSQL → Export to Notion → Notion Workflows → Social Platforms
```

**Implementation:**

1. **Create Notion Database** with columns:
   - `Content ID` (from PackPTS)
   - `Platform` (TikTok, Instagram, Facebook, X)
   - `Post Type` (Daily5, Trivia, Streak, etc.)
   - `Status` (Ready, Posted, Failed)
   - `Caption`
   - `Media URL`
   - `Hashtags`
   - `Scheduled Time`
   - `Posted At`
   - `Posted URL`

2. **Build Notion Export Function** in PackPTS:

**Create:** `/Users/alex/Projects/PackPoints-Game/server/services/notion/exportContentToNotion.ts`

```typescript
import { Client } from '@notionhq/client';
import { db } from '../../db';
import { publishingQueue } from '@shared/schema';
import { eq } from 'drizzle-orm';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const NOTION_DATABASE_ID = process.env.NOTION_CONTENT_DATABASE_ID!;

export async function syncContentToNotion() {
  // Get all content items in MANUAL_QUEUE status
  const items = await db.select().from(publishingQueue)
    .where(eq(publishingQueue.postingStatus, 'MANUAL_QUEUE'));

  for (const item of items) {
    await notion.pages.create({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        'Content ID': { title: [{ text: { content: String(item.id) } }] },
        'Platform': { select: { name: item.platform } },
        'Status': { select: { name: 'Ready' } },
        'Caption': { rich_text: [{ text: { content: item.metadata.caption || '' } }] },
        'Media URL': { url: item.metadata.videoUrl || item.metadata.imageUrl || '' },
        'Hashtags': { rich_text: [{ text: { content: item.metadata.hashtags?.join(' ') || '' } }] },
      },
    });
  }
}
```

3. **Add Dependencies:**
```bash
cd ~/Projects/PackPoints-Game
npm install @notionhq/client
```

4. **Add Environment Variables to Railway:**
```bash
NOTION_API_KEY=secret_xxxxx
NOTION_CONTENT_DATABASE_ID=xxxxx
```

5. **Schedule Notion Sync:**

Add to `/Users/alex/Projects/PackPoints-Game/server/services/growth/scheduler.ts`:

```typescript
import { syncContentToNotion } from '../notion/exportContentToNotion';

// Add to cron schedule
cron.schedule('*/15 * * * *', async () => {  // Every 15 minutes
  console.log('[NotionSync] Syncing content to Notion...');
  try {
    await syncContentToNotion();
    console.log('[NotionSync] ✅ Sync complete');
  } catch (err) {
    console.error('[NotionSync] ❌ Sync failed:', err);
  }
});
```

### Option B: Notion with Zapier/Make (No Code)

**Architecture:**
```
PackPTS App → Webhook → Zapier/Make → Notion → Social Platforms
```

**Implementation:**

1. **Create Webhook Endpoint** in PackPTS:

`/Users/alex/Projects/PackPoints-Game/server/routes/webhooks.ts`:

```typescript
app.post('/webhooks/content-ready', async (req, res) => {
  const { contentId, platform, caption, mediaUrl, hashtags } = req.body;

  // Send to Zapier/Make
  await fetch(process.env.ZAPIER_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentId,
      platform,
      caption,
      mediaUrl,
      hashtags,
      scheduledTime: new Date().toISOString(),
    }),
  });

  res.json({ success: true });
});
```

2. **Create Zap:**
   - **Trigger:** Webhook (catch hook from PackPTS)
   - **Action 1:** Create Notion page
   - **Action 2:** Post to TikTok (via TikTok integration)
   - **Action 3:** Post to Instagram (via Instagram integration)
   - **Action 4:** Update PackPTS via webhook that post succeeded

### Option C: Notion AI Blocks (Simplest)

Use Notion's built-in AI features:

1. **Manual Process:**
   - Export content to Notion database (Option A)
   - Create Notion AI automation that reads each row
   - Notion AI posts to social platforms via connected integrations

2. **Notion Automations:**
   - Trigger: New row added with Status = "Ready"
   - Action: Post to platform using Notion's social media connectors
   - Update: Change Status to "Posted", set Posted At timestamp

---

## 📋 RECOMMENDED SOLUTION: Hybrid Approach

**Best of both worlds:**

1. **X/Twitter** - Keep auto-posting (it works)
2. **TikTok/Instagram/Facebook** - Export to Notion for manual/AI-assisted posting

**Why?**
- ✅ Maintains quality control for visual platforms
- ✅ Leverages existing PackPTS automation
- ✅ Gives you flexibility to edit before posting
- ✅ Notion becomes your social media command center

**Implementation Steps:**

### Step 1: Set up Notion Database

Create a Notion database with this template structure:

| Content ID | Platform | Type | Status | Caption | Media | Hashtags | Schedule | Posted |
|------------|----------|------|--------|---------|-------|----------|----------|--------|
| 12345 | TikTok | Daily5 | Ready | Check out... | [video.mp4] | #baseball #cards | 2026-02-28 | - |

### Step 2: Add Notion Integration to PackPTS

```bash
cd ~/Projects/PackPoints-Game
npm install @notionhq/client
git add package.json package-lock.json
git commit -m "Add Notion SDK for content export"
git push
```

### Step 3: Create Notion Service

I'll create the files for you:
