import { db } from "../../db";
import {
  dailyChallengeEntries,
  eventLog,
  growthCreativeMetrics,
  postAnalytics,
  socialPosts,
  userAttribution,
} from "@shared/schema";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";

export type CreativePerformance = {
  creativeId: string;
  platform: string;
  contentType: string;
  impressions: number;
  clicks: number;
  signups: number;
  gameStarts: number;
  activations: number;
  d1Retained: number;
  d7Retained: number;
  qdauPerThousand: number;
};

export function calculateQdauPerThousand(
  activations: number,
  impressions: number,
): number {
  if (!Number.isFinite(activations) || !Number.isFinite(impressions) || impressions <= 0) {
    return 0;
  }
  return Math.round((Math.max(0, activations) / impressions) * 1000 * 100) / 100;
}

function utcDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftedUtcDayKey(value: Date, days: number): string {
  return utcDayKey(new Date(value.getTime() + days * 86_400_000));
}

/**
 * LEARN
 *
 * Computes creative performance against product outcomes, not vanity metrics.
 * A creative ID is the social_posts.id and is also written into utm_content by
 * the Growth Agent. Existing first-touch attribution then links signups back to
 * the creative.
 *
 * Qualified DAUs per 1,000 impressions is currently defined as attributed
 * users who reached an activation event (completed match or Daily 5) divided
 * by platform impressions, multiplied by 1,000.
 */
export async function computeCreativePerformance(
  now = new Date(),
  lookbackDays = 30,
): Promise<CreativePerformance[]> {
  const cutoff = new Date(now.getTime() - lookbackDays * 86_400_000);

  const posts = await db
    .select()
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.status, "PUBLISHED"),
        gte(socialPosts.publishedAt, cutoff),
      ),
    )
    .orderBy(desc(socialPosts.publishedAt))
    .limit(250);

  const results: CreativePerformance[] = [];

  for (const post of posts) {
    const [latest] = await db
      .select()
      .from(postAnalytics)
      .where(eq(postAnalytics.postId, post.id))
      .orderBy(desc(postAnalytics.fetchedAt))
      .limit(1);

    const attributed = await db
      .select({
        userId: userAttribution.userId,
        createdAt: userAttribution.createdAt,
      })
      .from(userAttribution)
      .where(eq(userAttribution.utmContent, post.id));

    let gameStarts = 0;
    let activations = 0;
    let d1Retained = 0;
    let d7Retained = 0;

    for (const attribution of attributed) {
      const signupAt = attribution.createdAt ?? post.publishedAt ?? cutoff;

      const events = await db
        .select({
          eventType: eventLog.eventType,
          createdAt: eventLog.createdAt,
        })
        .from(eventLog)
        .where(
          and(
            eq(eventLog.userId, attribution.userId),
            inArray(eventLog.eventType, ["match_started", "match_completed"]),
            gte(eventLog.createdAt, signupAt),
          ),
        );

      const daily = await db
        .select({ completedAt: dailyChallengeEntries.completedAt })
        .from(dailyChallengeEntries)
        .where(
          and(
            eq(dailyChallengeEntries.userId, attribution.userId),
            isNotNull(dailyChallengeEntries.completedAt),
            gte(dailyChallengeEntries.completedAt, signupAt),
          ),
        );

      gameStarts += events.filter((event) => event.eventType === "match_started").length;

      const activityDates = new Set<string>();
      for (const event of events) {
        if (event.createdAt) activityDates.add(utcDayKey(event.createdAt));
      }
      for (const entry of daily) {
        if (entry.completedAt) activityDates.add(utcDayKey(entry.completedAt));
      }

      const activated =
        events.some((event) => event.eventType === "match_completed") ||
        daily.length > 0;
      if (activated) activations += 1;

      if (activityDates.has(shiftedUtcDayKey(signupAt, 1))) d1Retained += 1;
      if (activityDates.has(shiftedUtcDayKey(signupAt, 7))) d7Retained += 1;
    }

    const impressions = latest?.impressions ?? 0;
    const signups = Math.max(latest?.newSignupsAttributed ?? 0, attributed.length);
    const metric: CreativePerformance = {
      creativeId: post.id,
      platform: post.platform,
      contentType: post.contentType,
      impressions,
      clicks: latest?.clicks ?? 0,
      signups,
      gameStarts,
      activations,
      d1Retained,
      d7Retained,
      qdauPerThousand: calculateQdauPerThousand(activations, impressions),
    };

    results.push(metric);

    await db
      .insert(growthCreativeMetrics)
      .values({
        creativeId: metric.creativeId,
        platform: metric.platform,
        contentType: metric.contentType,
        impressions: metric.impressions,
        clicks: metric.clicks,
        signups: metric.signups,
        gameStarts: metric.gameStarts,
        activations: metric.activations,
        d1Retained: metric.d1Retained,
        d7Retained: metric.d7Retained,
        qdauPerThousand: metric.qdauPerThousand,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: growthCreativeMetrics.creativeId,
        set: {
          platform: metric.platform,
          contentType: metric.contentType,
          impressions: metric.impressions,
          clicks: metric.clicks,
          signups: metric.signups,
          gameStarts: metric.gameStarts,
          activations: metric.activations,
          d1Retained: metric.d1Retained,
          d7Retained: metric.d7Retained,
          qdauPerThousand: metric.qdauPerThousand,
          computedAt: now,
        },
      });
  }

  return results.sort((a, b) => {
    if (b.qdauPerThousand !== a.qdauPerThousand) {
      return b.qdauPerThousand - a.qdauPerThousand;
    }
    return b.activations - a.activations;
  });
}

export function selectWinningCreatives(
  metrics: CreativePerformance[],
  limit = 5,
  minImpressions = 100,
): CreativePerformance[] {
  const eligible = metrics.filter((metric) => metric.impressions >= minImpressions);
  const pool = eligible.length > 0 ? eligible : metrics;
  return [...pool]
    .sort((a, b) => {
      if (b.qdauPerThousand !== a.qdauPerThousand) {
        return b.qdauPerThousand - a.qdauPerThousand;
      }
      return b.activations - a.activations;
    })
    .slice(0, Math.max(0, limit));
}
