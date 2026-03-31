import { db } from "../../db";
import { socialPosts } from "@shared/schema";
import { eq, and, lte, gte, sql, count } from "drizzle-orm";
import { agentConfig } from "./config";
import { createLogger } from "./logger";
import { generateDraftPost, type Platform } from "./contentGenerator";
import { composePostImage } from "./imageComposer";
import { getOrCreateAbTest } from "./abTesting/manager";
import { publishTweet } from "./publisher/twitter";
import { publishPhoto } from "./publisher/tiktok";
import { fetchAnalyticsForRecentPosts } from "./analytics";
import { newUserAcquisitionCampaign } from "./campaigns/newUserAcquisition";
import { retentionCampaign } from "./campaigns/retention";
import { runPromptEvolution } from "./promptEvolution";

const logger = createLogger("Scheduler");

// Post time slots in Eastern hours
const TIME_SLOTS_EST = [8, 12, 16, 20];

function getEasternOffsetMs(): number {
  const now = new Date();
  const easternDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(now);
  const parts = Object.fromEntries(easternDate.map(p => [p.type, p.value]));
  const easternMs = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`).getTime();
  return now.getTime() - easternMs;
}

function buildScheduledTime(hourEst: number): Date {
  const now = new Date();
  const todayEst = new Date(now.getTime() + getEasternOffsetMs());
  const year = todayEst.getUTCFullYear();
  const month = todayEst.getUTCMonth();
  const day = todayEst.getUTCDate();
  // Build UTC time for the Eastern hour; carry over to next day if utcHour >= 24
  const utcHour = hourEst + getEasternOffsetMs() / (60 * 60 * 1000);
  const dayOffset = Math.floor(utcHour / 24);
  return new Date(Date.UTC(year, month, day + dayOffset, utcHour % 24, 0, 0, 0));
}

function todayStartUtc(): Date {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now;
}

function todayEndUtc(): Date {
  const now = new Date();
  now.setUTCHours(23, 59, 59, 999);
  return now;
}

async function countTodaysPosts(platform: Platform): Promise<number> {
  const result = await db
    .select({ cnt: count() })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.platform, platform),
        sql`${socialPosts.status} IN ('PUBLISHED', 'SKIPPED')`,
        gte(socialPosts.scheduledAt, todayStartUtc()),
        lte(socialPosts.scheduledAt, todayEndUtc()),
      ),
    );
  return result[0]?.cnt ?? 0;
}

function isRetentionDay(): boolean {
  // Alternate campaigns by day: even days = acquisition, odd days = retention
  return new Date().getDate() % 2 !== 0;
}

async function buildQueueForPlatform(platform: Platform): Promise<void> {
  const existing = await countTodaysPosts(platform);
  if (existing >= agentConfig.maxPostsPerDay) return;

  const n = Math.floor(
    Math.random() * (agentConfig.maxPostsPerDay - agentConfig.minPostsPerDay + 1)
  ) + agentConfig.minPostsPerDay;
  const needed = Math.max(0, n - existing);
  const slots = TIME_SLOTS_EST.slice(0, needed);

  const useRetention = isRetentionDay();
  const campaign = useRetention ? retentionCampaign : newUserAcquisitionCampaign;
  const rotation = useRetention ? retentionCampaign.contentTypeRotation : undefined;

  logger.info("building_queue", { platform, existing, target: n, slots, campaign: campaign.campaignId });

  for (const hour of slots) {
    try {
      // Pick content type from campaign rotation if available
      const contentType = rotation
        ? rotation[Math.floor(Math.random() * rotation.length)]
        : undefined;

      const draft = await generateDraftPost(platform, contentType);
      const composed = await composePostImage({
        platform,
        contentType: draft.contentType,
        cardQuery: draft.cardQueryParams as any,
      });

      const { abTestId } = await getOrCreateAbTest(
        campaign.campaignId,
        draft.contentType as any,
      );

      await db.insert(socialPosts).values({
        platform,
        contentType: draft.contentType as any,
        status: "QUEUED",
        abGroup: draft.abGroup as any,
        abTestId,
        campaignId: campaign.campaignId,
        cardId: composed.cardId,
        cardImageUrl: composed.cardImageUrl,
        composedImagePath: composed.imagePath,
        cardQueryParams: draft.cardQueryParams,
        copyText: draft.copyText,
        hashtags: draft.hashtags,
        scheduledAt: buildScheduledTime(hour),
        factCheckPassed: draft.factCheckPassed ?? false,
        factCheckLog: draft.factCheckLog ?? [],
      });

      logger.info("post_queued", { platform, contentType: draft.contentType, hour, campaign: campaign.campaignId });
    } catch (err) {
      logger.error("queue_build_error", { platform, hour, error: String(err) });
    }
  }
}

let lastQueueBuildDate = "";

export function startDailyQueueBuilder(): void {
  const intervalMs = 5 * 60 * 1000; // 5 minutes

  const tick = async () => {
    const today = new Date().toISOString().slice(0, 10);
    if (lastQueueBuildDate === today) return;

    const estNow = new Date(Date.now() + getEasternOffsetMs());
    const estHour = estNow.getUTCHours();
    if (estHour < agentConfig.dailyQueueBuildHour) return;

    lastQueueBuildDate = today;
    logger.info("daily_queue_build_start", { date: today });

    try {
      await buildQueueForPlatform("TWITTER");
    } catch (err) {
      logger.error("queue_build_twitter_failed", { error: String(err) });
    }
    try {
      await buildQueueForPlatform("TIKTOK");
    } catch (err) {
      logger.error("queue_build_tiktok_failed", { error: String(err) });
    }

    logger.info("daily_queue_build_complete", { date: today });
  };

  setInterval(async () => {
    try { await tick(); } catch (err) {
      logger.error("daily_queue_tick_error", { error: String(err) });
    }
  }, intervalMs);

  logger.info("daily_queue_builder_started", { intervalMs });
}

// ---------------------------------------------------------------------------
// Prompt evolution loop — runs nightly at 1am EST, one hour before queue build.
// Reads A/B test winners, generates next-generation copy via OpenAI, writes to DB.
// Human steering: edit /prompt_program.md to change research direction.
// ---------------------------------------------------------------------------
let lastEvolutionDate = "";

export function startPromptEvolutionLoop(): void {
  const EVOLUTION_HOUR_EST = 1; // 1am EST — runs before the 2am queue build
  const intervalMs = 5 * 60 * 1000; // Check every 5 minutes

  const tick = async () => {
    const today = new Date().toISOString().slice(0, 10);
    if (lastEvolutionDate === today) return;

    const estNow = new Date(Date.now() + getEasternOffsetMs());
    const estHour = estNow.getUTCHours();
    if (estHour < EVOLUTION_HOUR_EST) return;

    lastEvolutionDate = today;
    try {
      await runPromptEvolution();
    } catch (err) {
      logger.error("prompt_evolution_failed", { error: String(err) });
    }
  };

  setInterval(async () => {
    try { await tick(); } catch (err) {
      logger.error("prompt_evolution_tick_error", { error: String(err) });
    }
  }, intervalMs);

  logger.info("prompt_evolution_loop_started", { hourEst: EVOLUTION_HOUR_EST });
}

export function startPublisherLoop(): void {
  const intervalMs = 60 * 1000; // 60 seconds

  const tick = async () => {
    const now = new Date();
    const duePosts = await db
      .select()
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.status, "QUEUED"),
          lte(socialPosts.scheduledAt, now),
        ),
      )
      .limit(5);

    for (const post of duePosts) {
      if (agentConfig.dryRun) {
        logger.info("dry_run_skip", { postId: post.id, platform: post.platform });
        await db.update(socialPosts).set({ status: "SKIPPED", updatedAt: new Date() }).where(eq(socialPosts.id, post.id));
        continue;
      }

      // Optimistic lock: set PUBLISHING
      const updated = await db
        .update(socialPosts)
        .set({ status: "PUBLISHING", updatedAt: new Date() })
        .where(
          and(eq(socialPosts.id, post.id), eq(socialPosts.status, "QUEUED")),
        )
        .returning({ id: socialPosts.id });

      if (updated.length === 0) continue; // Another worker grabbed it

      try {
        let platformPostId: string;

        if (post.platform === "TWITTER") {
          platformPostId = await publishTweet(post.copyText, post.hashtags ?? []);
        } else {
          const publicUrl = `${agentConfig.siteUrl}${post.composedImagePath}`;
          platformPostId = await publishPhoto(post.copyText.slice(0, 150), publicUrl);
        }

        await db.update(socialPosts).set({
          status: "PUBLISHED",
          platformPostId,
          publishedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(socialPosts.id, post.id));

        logger.info("post_published", { postId: post.id, platform: post.platform, platformPostId });
      } catch (err) {
        const attempts = (post.attemptCount ?? 0) + 1;
        const isFinal = attempts >= 3;
        const retryAt = new Date(Date.now() + 30 * 60 * 1000);

        await db.update(socialPosts).set({
          status: isFinal ? "FAILED" : "QUEUED",
          attemptCount: attempts,
          errorMessage: String(err),
          scheduledAt: isFinal ? post.scheduledAt : retryAt,
          updatedAt: new Date(),
        }).where(eq(socialPosts.id, post.id));

        logger.error("publish_failed", {
          postId: post.id,
          platform: post.platform,
          attempt: attempts,
          final: isFinal,
          error: String(err),
        });
      }
    }
  };

  setInterval(async () => {
    try { await tick(); } catch (err) {
      logger.error("publisher_tick_error", { error: String(err) });
    }
  }, intervalMs);

  logger.info("publisher_loop_started", { intervalMs });
}

export function startAnalyticsFetcher(): void {
  const intervalMs = 6 * 60 * 60 * 1000; // 6 hours

  setInterval(async () => {
    try {
      await fetchAnalyticsForRecentPosts();
    } catch (err) {
      logger.error("analytics_tick_error", { error: String(err) });
    }
  }, intervalMs);

  logger.info("analytics_fetcher_started", { intervalMs });
}
