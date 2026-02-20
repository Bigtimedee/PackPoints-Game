import { db } from "../db";
import { growthContentItems, publishingQueue } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { registerJob, type JobContext } from "../services/growth/jobRunner";
import { generateVideoForContentItem, isVideoFactoryEnabled } from "./index";

const MAX_RENDERS_PER_RUN = 3;
const CONCURRENCY = 1;

registerJob("render_tiktok_videos", async (ctx: JobContext) => {
  if (!isVideoFactoryEnabled()) {
    return { skipped: true, reason: "Video Factory disabled (set VIDEO_FACTORY_ENABLED=true)" };
  }

  const readyItems = await db.select({
    queueId: publishingQueue.id,
    contentItemId: publishingQueue.contentItemId,
  })
    .from(publishingQueue)
    .innerJoin(growthContentItems, eq(publishingQueue.contentItemId, growthContentItems.id))
    .where(
      and(
        eq(publishingQueue.platform, "tiktok"),
        eq(publishingQueue.status, "READY"),
        sql`(${growthContentItems.metadata}->>'video_asset') IS NULL`,
        sql`(${growthContentItems.metadata}->>'video_error') IS NULL OR 
            (${growthContentItems.metadata}->>'video_error')::jsonb->>'at' < ${new Date(Date.now() - 3600000).toISOString()}`
      )
    )
    .limit(MAX_RENDERS_PER_RUN);

  if (readyItems.length === 0) {
    return { skipped: true, reason: "No TikTok items need rendering" };
  }

  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  for (const item of readyItems) {
    if (!item.contentItemId) continue;

    try {
      console.log(`[VideoFactory/Worker] Rendering video for content item ${item.contentItemId}`);
      const result = await generateVideoForContentItem(item.contentItemId);
      results.push({
        id: item.contentItemId,
        success: result.success,
        error: result.error,
      });

      if (!result.success) {
        console.warn(`[VideoFactory/Worker] Failed: ${result.error}`);
      }
    } catch (err: any) {
      console.error(`[VideoFactory/Worker] Error rendering ${item.contentItemId}:`, err?.message);
      results.push({ id: item.contentItemId, success: false, error: err?.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    processed: results.length,
    succeeded,
    failed,
    results,
  };
});
