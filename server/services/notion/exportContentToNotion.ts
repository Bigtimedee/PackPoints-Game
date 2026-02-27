import { getNotionClient, isNotionEnabled } from './client';
import { db } from '../../db';
import { publishingQueue } from '@shared/schema';
import { eq, and, isNull, or } from 'drizzle-orm';

interface NotionSyncResult {
  synced: number;
  skipped: number;
  errors: number;
}

export async function syncContentToNotion(): Promise<NotionSyncResult> {
  if (!isNotionEnabled()) {
    console.log('[NotionSync] Disabled (missing env vars)');
    return { synced: 0, skipped: 0, errors: 0 };
  }

  const notion = getNotionClient();
  if (!notion) {
    return { synced: 0, skipped: 0, errors: 0 };
  }

  const databaseId = process.env.NOTION_CONTENT_DATABASE_ID!;
  const result: NotionSyncResult = { synced: 0, skipped: 0, errors: 0 };

  try {
    // Get all content items in MANUAL_QUEUE status that haven't been synced to Notion
    const items = await db.select().from(publishingQueue)
      .where(
        and(
          eq(publishingQueue.postingStatus, 'MANUAL_QUEUE'),
          or(
            isNull(publishingQueue.notionPageId),
            eq(publishingQueue.notionSyncStatus, 'PENDING')
          )
        )
      )
      .limit(20); // Process 20 at a time

    console.log(`[NotionSync] Found ${items.length} items to sync`);

    for (const item of items) {
      try {
        const metadata = item.metadata as any;

        // Create Notion page
        const page = await notion.pages.create({
          parent: { database_id: databaseId },
          properties: {
            'Content ID': {
              title: [{ text: { content: `${item.id}` } }]
            },
            'Platform': {
              select: { name: item.platform }
            },
            'Type': {
              select: { name: metadata.contentType || 'Unknown' }
            },
            'Status': {
              select: { name: 'Ready' }
            },
            'Caption': {
              rich_text: [{ text: { content: metadata.caption?.slice(0, 2000) || '' } }]
            },
            'Hashtags': {
              rich_text: [{ text: { content: metadata.hashtags?.join(' ')?.slice(0, 2000) || '' } }]
            },
            'Media URL': {
              url: metadata.videoUrl || metadata.imageUrl || null
            },
            'Scheduled': {
              date: item.scheduledFor ? { start: item.scheduledFor.toISOString() } : null
            },
          },
        });

        // Update PackPTS record with Notion page ID
        await db.update(publishingQueue)
          .set({
            notionPageId: page.id,
            notionSyncStatus: 'SYNCED',
            notionSyncedAt: new Date(),
          })
          .where(eq(publishingQueue.id, item.id));

        result.synced++;
        console.log(`[NotionSync] ✅ Synced content ${item.id} → Notion page ${page.id}`);

      } catch (err: any) {
        result.errors++;
        console.error(`[NotionSync] ❌ Failed to sync content ${item.id}:`, err.message);

        // Update error status
        await db.update(publishingQueue)
          .set({
            notionSyncStatus: 'ERROR',
            notionSyncError: err.message?.slice(0, 500),
          })
          .where(eq(publishingQueue.id, item.id));
      }
    }

    console.log(`[NotionSync] Complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`);
    return result;

  } catch (err: any) {
    console.error('[NotionSync] ❌ Sync failed:', err.message);
    throw err;
  }
}

export async function markAsPostedInNotion(contentId: number, postedUrl: string): Promise<void> {
  if (!isNotionEnabled()) return;

  const notion = getNotionClient();
  if (!notion) return;

  try {
    // Get the content item to find its Notion page ID
    const [item] = await db.select().from(publishingQueue)
      .where(eq(publishingQueue.id, contentId))
      .limit(1);

    if (!item?.notionPageId) {
      console.log(`[NotionSync] No Notion page ID for content ${contentId}`);
      return;
    }

    // Update Notion page status
    await notion.pages.update({
      page_id: item.notionPageId,
      properties: {
        'Status': { select: { name: 'Posted' } },
        'Posted At': { date: { start: new Date().toISOString() } },
        'Posted URL': { url: postedUrl },
      },
    });

    console.log(`[NotionSync] ✅ Marked content ${contentId} as Posted in Notion`);

  } catch (err: any) {
    console.error(`[NotionSync] ❌ Failed to update Notion for content ${contentId}:`, err.message);
  }
}
