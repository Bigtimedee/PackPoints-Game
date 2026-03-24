import { db } from "../../db";
import { socialPosts, postAnalytics } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { fetchMetrics as twitterFetchMetrics } from "./publisher/twitter";
import { fetchMetrics as tiktokFetchMetrics } from "./publisher/tiktok";
import { analyzeReadyTests } from "./abTesting/analyzer";
import { createLogger } from "./logger";

const logger = createLogger("Analytics");

export async function fetchAnalyticsForRecentPosts(): Promise<void> {
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);

  const recentPosts = await db
    .select()
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.status, "PUBLISHED"),
        gte(socialPosts.publishedAt, cutoff),
      ),
    );

  logger.info("fetching_analytics", { postCount: recentPosts.length });

  for (const post of recentPosts) {
    if (!post.platformPostId) continue;

    try {
      const metrics = post.platform === "TWITTER"
        ? await twitterFetchMetrics(post.platformPostId)
        : await tiktokFetchMetrics(post.platformPostId);

      if (Object.keys(metrics).length === 0) continue;

      // Upsert into post_analytics
      await db.execute(sql`
        INSERT INTO post_analytics (post_id, fetched_at, impressions, likes, shares, comments, clicks, profile_visits, new_signups_attributed)
        VALUES (
          ${post.id},
          NOW(),
          ${metrics.impressions ?? 0},
          ${metrics.likes ?? 0},
          ${metrics.shares ?? 0},
          ${metrics.comments ?? 0},
          ${metrics.clicks ?? 0},
          ${metrics.profileVisits ?? 0},
          ${metrics.newSignupsAttributed ?? 0}
        )
        ON CONFLICT (post_id, (fetched_at::date)) DO UPDATE SET
          impressions = EXCLUDED.impressions,
          engagements = EXCLUDED.engagements,
          clicks = EXCLUDED.clicks,
          shares = EXCLUDED.shares,
          raw_data = EXCLUDED.raw_data,
          fetched_at = EXCLUDED.fetched_at
      `);

      logger.info("analytics_upserted", { postId: post.id, platform: post.platform });
    } catch (err) {
      logger.warn("analytics_fetch_error", { postId: post.id, error: String(err) });
    }
  }

  // Trigger A/B test analysis
  await analyzeReadyTests();
}
