# Complete Fix Plan: Growth Engine + Notion Integration

## 🎯 Your Goal
Enable Notion to manage all PackPTS social media posting across TikTok, Instagram, Facebook, and X/Twitter.

## 📋 Current State Analysis

### ✅ What's Working
- GitHub integration is perfect (confirmed from screenshots)
- Railway deployment is successful
- Database is connected
- App is running

### ❌ What's Broken
- **Growth Engine failing with "Connection error"**
- Root cause: No OpenAI API key configured after migrating away from the legacy host's managed AI integration
- Cascading failures: `generate_daily_plan` → `generate_content_items` → All downstream jobs

---

## 🚀 PHASE 1: Fix Growth Engine (Do This First)

### Step 1: Add OpenAI API Key

1. **Get API key:** https://platform.openai.com/api-keys
2. **Add to Railway:**
   ```
   OPENAI_API_KEY=sk-proj-xxxxx...
   ```
3. **Wait 2 minutes** for restart
4. **Verify logs:**
   ```bash
   railway logs --filter "OpenAI"
   ```

**Expected:** `[OpenAI/Growth] Connectivity check PASSED`

### Step 2: Trigger Manual Job Run

Force a fresh daily plan generation:

```bash
# SSH into Railway
railway shell

# Run node script
node -e "
const { db } = require('./dist/server/db');
const { growthJobRuns } = require('./dist/shared/schema');
await db.insert(growthJobRuns).values({
  jobName: 'generate_daily_plan',
  status: 'PENDING',
  startedAt: new Date()
});
console.log('Job queued');
"
```

OR via admin UI:
- Go to: `https://packpoints-game-production.up.railway.app/admin/growth`
- Click **"Force Daily Plan"** button

### Step 3: Confirm All Jobs Green

Check admin dashboard:
- Daily Plan Generation: 🟢 GREEN
- Content Item Generation: 🟢 GREEN
- Auto-Posting: 🟢 GREEN
- Daily 5 Announcement: 🟢 GREEN
- Daily 5 Recap: 🟢 GREEN

---

## 🤖 PHASE 2: Add Notion Integration

### Architecture Overview

```
PackPTS Growth Engine
    ↓ (generates content)
PostgreSQL publishing_queue table
    ↓ (every 15 minutes)
Notion Database (via sync job)
    ↓ (manual or Notion automation)
Social Media Platforms
    ↓ (webhook callback)
PackPTS (marks as posted)
```

### Step 1: Install Notion SDK

```bash
cd ~/Projects/PackPoints-Game
npm install @notionhq/client
git add package.json package-lock.json
git commit -m "Add Notion SDK for social media workflow"
git push
```

### Step 2: Create Notion Integration

1. Go to: https://www.notion.so/my-integrations
2. Click **"+ New integration"**
3. Name: `PackPTS Content Manager`
4. Capabilities:
   - ✅ Read content
   - ✅ Update content
   - ✅ Insert content
5. Copy **Internal Integration Token** (starts with `secret_...`)

### Step 3: Create Notion Database

1. Create new Notion page: **"PackPTS Social Media Queue"**
2. Create database with these properties:

| Property | Type | Options |
|----------|------|---------|
| Content ID | Title | - |
| Platform | Select | TikTok, Instagram, Facebook, X, Discord |
| Type | Select | Daily5, Trivia, Streak, Leaderboard, Recap |
| Status | Select | Ready, In Progress, Posted, Failed |
| Caption | Text | - |
| Hashtags | Text | - |
| Media URL | URL | - |
| Scheduled | Date | - |
| Posted At | Date | - |
| Posted URL | URL | - |

3. **Share database with integration:**
   - Click **"Share"** in top right
   - Invite `PackPTS Content Manager`
   - Copy **Database ID** from URL:
     ```
     https://notion.so/yourworkspace/DATABASE_ID?v=...
     ```

### Step 4: Add Environment Variables to Railway

```bash
NOTION_API_KEY=secret_xxxxx...
NOTION_CONTENT_DATABASE_ID=xxxxx...
```

### Step 5: Run Database Migration

```bash
cd ~/Projects/PackPoints-Game

# Review migration
cat migrations/add_notion_fields_to_publishing_queue.sql

# Run on Railway
railway run psql $DATABASE_URL < migrations/add_notion_fields_to_publishing_queue.sql
```

OR use Drizzle:
```bash
railway run npx drizzle-kit push
```

### Step 6: Deploy Notion Service

Files already created for you:
- ✅ `server/services/notion/client.ts` - Notion SDK wrapper
- ✅ `server/services/notion/exportContentToNotion.ts` - Sync job
- ✅ `server/services/notion/webhookHandler.ts` - Webhook for posting updates

Now integrate into growth scheduler:

**Edit:** `server/services/growth/scheduler.ts`

Add:
```typescript
import { syncContentToNotion } from '../notion/exportContentToNotion';

// Add new cron job - every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('[Scheduler] Running Notion content sync...');
  try {
    const result = await syncContentToNotion();
    console.log(`[Scheduler] Notion sync complete: ${result.synced} synced, ${result.errors} errors`);
  } catch (err) {
    console.error('[Scheduler] Notion sync failed:', err);
  }
});
```

**Edit:** `server/routes.ts`

Add webhook endpoints:
```typescript
import { handleNotionPostComplete, getPendingContentForNotion } from './services/notion/webhookHandler';

// Add to routes
app.post('/webhooks/notion/post-complete', handleNotionPostComplete);
app.get('/api/notion/pending-content', getPendingContentForNotion);
```

### Step 7: Commit and Deploy

```bash
git add .
git commit -m "Add Notion integration for social media workflow"
git push
```

Railway auto-deploys.

---

## 📊 PHASE 3: Notion Workflow Setup

### Option A: Manual Posting from Notion

**Every 15 minutes,** new content appears in Notion database with Status = "Ready"

**Your workflow:**
1. Open Notion database
2. Find rows with Status = "Ready"
3. Click Media URL → Download video/image
4. Post manually to TikTok/Instagram/Facebook
5. Copy the post URL
6. Change Status to "Posted"
7. Paste post URL in "Posted URL" field
8. Call webhook to update PackPTS:
   ```bash
   curl -X POST https://packpoints-game-production.up.railway.app/webhooks/notion/post-complete \
     -H "Content-Type: application/json" \
     -d '{"contentId": 12345, "postedUrl": "https://instagram.com/p/xxxxx"}'
   ```

### Option B: Notion Automation (Recommended)

Set up Notion database automation:

**Trigger:** When Status changes to "Posted"
**Action:** Send HTTP request

**Request config:**
- Method: POST
- URL: `https://packpoints-game-production.up.railway.app/webhooks/notion/post-complete`
- Headers: `Content-Type: application/json`
- Body:
  ```json
  {
    "contentId": {{Content ID}},
    "postedUrl": {{Posted URL}},
    "platform": {{Platform}}
  }
  ```

Now you just:
1. Post to social media
2. Mark as "Posted" in Notion
3. Webhook auto-updates PackPTS ✨

### Option C: Zapier/Make Integration (Power Users)

**Zap flow:**
1. **Trigger:** New row in Notion (Status = Ready)
2. **Action:** Post to TikTok (using TikTok integration)
3. **Action:** Post to Instagram (using Instagram integration)
4. **Action:** Update Notion (Status = Posted)
5. **Action:** Webhook to PackPTS (mark complete)

**Benefit:** Fully automated posting!

---

## 🎛️ PHASE 4: Update Schema (Optional Enhancement)

If you want to track Notion integration in your existing schema cleanly:

**Edit:** `shared/schema.ts`

Update `publishingQueue` table:
```typescript
export const publishingQueue = pgTable("publishing_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contentItemId: varchar("content_item_id").references(() => growthContentItems.id),
  platform: varchar("platform", { length: 40 }).notNull(),

  // Existing fields
  assets: jsonb("assets"),
  copyText: text("copy_text"),
  status: varchar("status", { length: 20 }).notNull().default("READY"),
  postedBy: varchar("posted_by").references(() => users.id),
  postedAt: timestamp("posted_at"),
  notes: text("notes"),

  // NEW: Notion integration fields
  notionPageId: text("notion_page_id"),
  notionSyncStatus: varchar("notion_sync_status", { length: 20 }).default("PENDING"),
  notionSyncedAt: timestamp("notion_synced_at"),
  notionSyncError: text("notion_sync_error"),

  // NEW: Enhanced posting workflow
  postingStatus: varchar("posting_status", { length: 20 }).default("MANUAL_QUEUE"),
  scheduledFor: timestamp("scheduled_for"),
  platformPostId: text("platform_post_id"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),

  createdAt: timestamp("created_at").defaultNow(),
});
```

Then run:
```bash
npx drizzle-kit generate
npx drizzle-kit push
```

---

## ✅ Success Criteria

After completing all phases:

### Growth Engine (Phase 1)
- ✅ No more "Connection error" in logs
- ✅ Daily plan generates at 7:00 AM Chicago time
- ✅ Content items generate at 7:16 AM
- ✅ TikTok videos render at 1:35 PM
- ✅ Admin dashboard shows all GREEN

### Notion Integration (Phase 2-3)
- ✅ New content appears in Notion every 15 minutes
- ✅ Content includes caption, hashtags, media URL
- ✅ Manual posting workflow is smooth
- ✅ Webhook updates PackPTS when posted
- ✅ Can track posting history in Notion

### Quality of Life
- ✅ One Notion database = command center for all platforms
- ✅ No more switching between multiple admin UIs
- ✅ Clear audit trail (when posted, who posted, post URL)
- ✅ Can batch posts (queue up multiple pieces of content)

---

## 🔧 Troubleshooting

### "OpenAI still failing"
- Check API key is correct: `railway run node -e "console.log(process.env.OPENAI_API_KEY?.slice(0,10))"`
- Check billing: https://platform.openai.com/usage
- Check rate limits: Upgrade to Tier 1+ if needed

### "Notion sync not working"
- Verify integration token: Test at https://api.notion.com/v1/databases/YOUR_DB_ID
- Check database is shared with integration
- Look for errors: `railway logs --filter "NotionSync"`

### "Webhook not updating status"
- Check webhook URL is correct
- Test manually:
  ```bash
  curl -X POST https://your-app.railway.app/webhooks/notion/post-complete \
    -H "Content-Type: application/json" \
    -d '{"contentId": 1, "postedUrl": "test"}'
  ```
- Check logs: `railway logs --filter "NotionWebhook"`

---

## 📞 Next Steps

1. **NOW:** Add `OPENAI_API_KEY` to Railway (Phase 1, Step 1)
2. **Wait 5 min:** Check logs confirm OpenAI working
3. **Tomorrow:** Set up Notion integration (Phase 2)
4. **Day after:** Configure Notion workflow (Phase 3)

---

**Questions? Check logs at any time:**
```bash
railway logs --tail 100
```

Or view in Railway dashboard → Your service → **Logs** tab.
