/**
 * Notion Integration Service
 *
 * Syncs the social media publishing queue to a Notion database for editorial review.
 * Uses native fetch() — no @notionhq/client package required.
 *
 * Setup:
 *   1. Create a Notion integration at https://www.notion.so/my-integrations
 *   2. Create a database with properties: Title (title), Status (select), Platform (select),
 *      ScheduledAt (date), Content (rich_text), PostedAt (date)
 *   3. Share the database with your integration
 *   4. Set NOTION_API_KEY and NOTION_DATABASE_ID env vars
 */

const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

interface NotionTextContent {
  type: 'text';
  text: { content: string };
}

interface NotionProperty {
  title?: { type: 'text'; text: { content: string } }[];
  rich_text?: NotionTextContent[];
  select?: { name: string };
  date?: { start: string } | null;
  number?: number;
  checkbox?: boolean;
}

interface NotionPageProperties {
  [key: string]: NotionProperty;
}

async function notionFetch(path: string, method = 'GET', body?: unknown): Promise<any> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) throw new Error('NOTION_API_KEY is not set');

  const response = await fetch(`${NOTION_API_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error ${response.status}: ${error}`);
  }

  return response.json();
}

export interface PublishingQueueItem {
  id: number;
  platform: string;
  content: string;
  status: string;
  scheduledAt: Date | null;
  postedAt: Date | null;
  notionPageId?: string | null;
}

/**
 * Create a new page in the Notion database for a publishing queue item.
 */
async function createNotionPage(item: PublishingQueueItem): Promise<string> {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) throw new Error('NOTION_DATABASE_ID is not set');

  const properties: NotionPageProperties = {
    'Title': {
      title: [{ type: 'text', text: { content: `[${item.platform.toUpperCase()}] Post #${item.id}` } }],
    },
    'Status': {
      select: { name: item.status },
    },
    'Platform': {
      select: { name: item.platform },
    },
    'Content': {
      rich_text: [{ type: 'text', text: { content: item.content.slice(0, 2000) } }],
    },
  };

  if (item.scheduledAt) {
    properties['Scheduled At'] = {
      date: { start: item.scheduledAt.toISOString() },
    };
  }

  if (item.postedAt) {
    properties['Posted At'] = {
      date: { start: item.postedAt.toISOString() },
    };
  }

  const result = await notionFetch('/pages', 'POST', {
    parent: { database_id: databaseId },
    properties,
  });

  return result.id;
}

/**
 * Update an existing Notion page with new status/postedAt.
 */
async function updateNotionPage(pageId: string, updates: Partial<PublishingQueueItem>): Promise<void> {
  const properties: NotionPageProperties = {};

  if (updates.status) {
    properties['Status'] = { select: { name: updates.status } };
  }
  if (updates.postedAt) {
    properties['Posted At'] = { date: { start: updates.postedAt.toISOString() } };
  }

  await notionFetch(`/pages/${pageId}`, 'PATCH', { properties });
}

/**
 * Sync all pending publishing queue items to Notion.
 * Should be called by the scheduled job.
 */
export async function syncPendingToNotion(): Promise<{ synced: number; errors: string[] }> {
  if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
    console.log('[Notion] Skipping sync — NOTION_API_KEY or NOTION_DATABASE_ID not set');
    return { synced: 0, errors: [] };
  }

  const { pool } = await import('../db');

  // Get items that haven't been synced to Notion yet
  const pendingResult = await pool.query(
    `SELECT id, platform, content, status, scheduled_at as "scheduledAt", posted_at as "postedAt", notion_page_id as "notionPageId"
     FROM publishing_queue
     WHERE (notion_sync_status IS NULL OR notion_sync_status = 'PENDING')
     ORDER BY created_at DESC
     LIMIT 50`
  );

  const items: PublishingQueueItem[] = pendingResult.rows;
  let synced = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      if (item.notionPageId) {
        // Update existing page
        await updateNotionPage(item.notionPageId, {
          status: item.status,
          postedAt: item.postedAt || undefined,
        });
      } else {
        // Create new page
        const pageId = await createNotionPage(item);
        await pool.query(
          `UPDATE publishing_queue SET notion_page_id = $1, notion_sync_status = 'SYNCED', updated_at = NOW() WHERE id = $2`,
          [pageId, item.id]
        );
      }
      synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Item ${item.id}: ${msg}`);
      console.error(`[Notion] Failed to sync item ${item.id}:`, msg);
    }
  }

  console.log(`[Notion] Sync complete: ${synced} synced, ${errors.length} errors`);
  return { synced, errors };
}
