import type { Request, Response } from 'express';
import { db } from '../../db';
import { publishingQueue } from '@shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Webhook handler for Notion → PackPTS updates
 *
 * When you manually post from Notion (or use Notion automation),
 * call this webhook to update PackPTS that the post succeeded.
 *
 * POST /webhooks/notion/post-complete
 * Body: { contentId: number, postedUrl: string, platform: string }
 */
export async function handleNotionPostComplete(req: Request, res: Response) {
  try {
    const { contentId, postedUrl, platform } = req.body;

    if (!contentId) {
      return res.status(400).json({ error: 'Missing contentId' });
    }

    // Update posting status in PackPTS
    await db.update(publishingQueue)
      .set({
        postingStatus: 'POSTED',
        postedAt: new Date(),
        platformPostId: postedUrl,
        metadata: db.raw(`jsonb_set(metadata, '{posted_via}', '"notion"')`),
      })
      .where(eq(publishingQueue.id, contentId));

    console.log(`[NotionWebhook] ✅ Content ${contentId} marked as posted via Notion`);

    res.json({
      success: true,
      message: `Content ${contentId} marked as posted`
    });

  } catch (err: any) {
    console.error('[NotionWebhook] ❌ Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Webhook to fetch pending content for Notion
 *
 * GET /api/notion/pending-content
 * Returns: Array of content items ready to be posted
 */
export async function getPendingContentForNotion(req: Request, res: Response) {
  try {
    const items = await db.select().from(publishingQueue)
      .where(eq(publishingQueue.postingStatus, 'MANUAL_QUEUE'))
      .orderBy(publishingQueue.createdAt)
      .limit(50);

    const formatted = items.map(item => ({
      id: item.id,
      platform: item.platform,
      caption: (item.metadata as any).caption,
      hashtags: (item.metadata as any).hashtags,
      mediaUrl: (item.metadata as any).videoUrl || (item.metadata as any).imageUrl,
      contentType: (item.metadata as any).contentType,
      scheduledFor: item.scheduledFor,
      createdAt: item.createdAt,
    }));

    res.json({
      count: formatted.length,
      items: formatted
    });

  } catch (err: any) {
    console.error('[NotionAPI] ❌ Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
