import { db } from "../db";
import { growthContentItems, publishingQueue } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { registerJob, type JobContext } from "../services/growth/jobRunner";
import { generateVideoForContentItem, isVideoFactoryEnabled, isFFmpegAvailable, verifyFFmpeg } from "./index";

const MAX_RENDERS_PER_RUN = 3;
const CONCURRENCY = 1;

registerJob("render_tiktok_videos", async (ctx: JobContext) => {
  if (!isVideoFactoryEnabled()) {
    return { skipped: true, reason: "Video Factory disabled (set VIDEO_FACTORY_ENABLED=true)" };
  }

  if (!isFFmpegAvailable()) {
    console.warn("[VideoFactory/Worker] FFmpeg not available at job start, re-checking...");
    const nowAvailable = verifyFFmpeg();
    if (!nowAvailable) {
      console.error("[VideoFactory/Worker] FFmpeg still unavailable. Skipping render job to prevent ENOENT failures.");
      return { skipped: true, reason: "FFmpeg is not available in this environment. Install FFmpeg to enable video rendering." };
    }
    console.log("[VideoFactory/Worker] FFmpeg recovered and available again.");
  }

  const ONE_HOUR_AGO = new Date(Date.now() - 3600000).toISOString();

  const readyItems = await db.select({
    queueId: publishingQueue.id,
    contentItemId: publishingQueue.contentItemId,
    metadata: growthContentItems.metadata,
  })
    .from(publishingQueue)
    .innerJoin(growthContentItems, eq(publishingQueue.contentItemId, growthContentItems.id))
    .where(
      and(
        eq(publishingQueue.platform, "tiktok"),
        eq(publishingQueue.status, "READY"),
        sql`(${growthContentItems.metadata}->>'video_asset') IS NULL`,
        sql`(${growthContentItems.metadata}->>'video_error') IS NULL OR
            (
              (${growthContentItems.metadata}->'video_error'->>'message') ILIKE '%enoent%'
              OR (${growthContentItems.metadata}->'video_error'->>'message') ILIKE '%ffmpeg%not%available%'
            ) OR (
              (${growthContentItems.metadata}->'video_error'->>'at') IS NOT NULL
              AND (${growthContentItems.metadata}->'video_error'->>'at') < ${ONE_HOUR_AGO}
              AND COALESCE(((${growthContentItems.metadata}->'video_error'->>'retry_count')::int), 0) < 3
            )`
      )
    )
    .limit(MAX_RENDERS_PER_RUN);

  if (readyItems.length === 0) {
    return { skipped: true, reason: "No TikTok items need rendering" };
  }

  const results: Array<{ id: string; success: boolean; error?: string; retried?: boolean; retryReason?: string }> = [];

  for (const item of readyItems) {
    if (!item.contentItemId) continue;

    try {
      const metadata = (item.metadata as Record<string, any>) || {};
      const prevError = metadata.video_error;
      const isEnoentRetry = prevError?.message?.includes("ENOENT");
      const isStaleRetry = prevError && !isEnoentRetry;
      const isRetry = !!prevError;

      if (isEnoentRetry) {
        console.log(`[VideoFactory/Worker] Auto-retrying ENOENT failure for ${item.contentItemId}`);
      } else if (isStaleRetry) {
        console.log(`[VideoFactory/Worker] Retrying stale error (>1h) for ${item.contentItemId}: ${prevError?.message}`);
      }

      console.log(`[VideoFactory/Worker] Rendering video for content item ${item.contentItemId}`);
      const result = await generateVideoForContentItem(item.contentItemId, { forceRerender: isRetry });
      results.push({
        id: item.contentItemId,
        success: result.success,
        error: result.error,
        retried: isRetry,
        retryReason: isEnoentRetry ? "ffmpeg_enoent" : isStaleRetry ? "stale_error" : undefined,
      });

      if (!result.success) {
        console.warn(`[VideoFactory/Worker] Failed: ${result.error}`);
      } else if (isRetry) {
        console.log(`[VideoFactory/Worker] Retry succeeded for ${item.contentItemId} (reason: ${isEnoentRetry ? "ffmpeg_enoent" : "stale_error"})`);
      }
    } catch (err: any) {
      console.error(`[VideoFactory/Worker] Error rendering ${item.contentItemId}:`, err?.message);
      results.push({ id: item.contentItemId, success: false, error: err?.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const retried = results.filter(r => r.retried).length;

  return {
    processed: results.length,
    succeeded,
    failed,
    retried,
    results,
  };
});
