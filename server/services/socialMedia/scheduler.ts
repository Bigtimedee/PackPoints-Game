import { db } from "../../db";
import { socialPosts } from "@shared/schema";
import { eq, and, lte, gte, sql, count } from "drizzle-orm";
import { agentConfig, isPlatformConfigured, type SocialPlatform } from "./config";
import { createLogger } from "./logger";
import { generateDraftPost, type Platform, type CardContext } from "./contentGenerator";
import { composePostImage } from "./imageComposer";
import { getOrCreateAbTest } from "./abTesting/manager";
import { publishTweet } from "./publisher/twitter";
import { publishPhoto } from "./publisher/tiktok";
import { publishDiscordMessage } from "./publisher/discord";
import { validatePostForPublishing, isVisualContentType } from "./preflight";
import { fetchAnalyticsForRecentPosts } from "./analytics";
import * as fs from "fs";
import { runPromptEvolution } from "./promptEvolution";
import {
  AUTO_CAMPAIGN_ID,
  AUTO_CONTENT_TYPE,
  type Daily5Ritual,
} from "./marketingSor";

const logger = createLogger("Scheduler");

/** Platforms we have already logged as unconfigured this process (avoid per-minute spam). */
const unconfiguredLogged = new Set<string>();

function logUnconfiguredOnce(scope: string, platform: SocialPlatform, extra?: Record<string, unknown>): void {
  const key = `${scope}:${platform}`;
  if (unconfiguredLogged.has(key)) return;
  unconfiguredLogged.add(key);
  logger.warn("platform_unconfigured_skipped", {
    scope,
    platform,
    message: `${platform} credentials missing — skipping (logged once)`,
    ...extra,
  });
}



/** Daily 5 ritual slots in America/Chicago (product day key). Announcement 8 AM CT, recap 9 PM CT. */
const DAILY5_SLOTS_CT: { hour: number; ritual: Daily5Ritual }[] = [
  { hour: 8, ritual: "announcement" },
  { hour: 21, ritual: "recap" },
];
const DAILY5_TIMEZONE = "America/Chicago";

function getZoneOffsetMs(timeZone: string): number {
  const now = new Date();
  const zoned = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const parts = Object.fromEntries(zoned.map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const zonedMs = new Date(`${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`).getTime();
  return now.getTime() - zonedMs;
}

function chicagoDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY5_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function buildScheduledTimeCt(hourCt: number): Date {
  const now = new Date();
  const todayCt = new Date(now.getTime() + getZoneOffsetMs(DAILY5_TIMEZONE));
  const year = todayCt.getUTCFullYear();
  const month = todayCt.getUTCMonth();
  const day = todayCt.getUTCDate();
  const utcHour = hourCt + getZoneOffsetMs(DAILY5_TIMEZONE) / (60 * 60 * 1000);
  const dayOffset = Math.floor(utcHour / 24);
  const normalizedHour = ((utcHour % 24) + 24) % 24;
  return new Date(Date.UTC(year, month, day + dayOffset, normalizedHour, 0, 0, 0));
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
        sql`${socialPosts.status} IN ('PUBLISHED', 'SKIPPED', 'QUEUED', 'BLOCKED', 'PUBLISHING')`,
        gte(socialPosts.scheduledAt, todayStartUtc()),
        lte(socialPosts.scheduledAt, todayEndUtc()),
      ),
    );
  return result[0]?.cnt ?? 0;
}

async function buildQueueForPlatform(platform: Platform): Promise<void> {
  if (!isPlatformConfigured(platform)) {
    logUnconfiguredOnce("queue_build", platform);
    return;
  }

  const existing = await countTodaysPosts(platform);
  if (existing >= DAILY5_SLOTS_CT.length) return;

  const slots = DAILY5_SLOTS_CT.slice(existing);

  logger.info("building_queue", {
    platform,
    existing,
    target: DAILY5_SLOTS_CT.length,
    slots: slots.map((s) => s.hour),
    campaign: AUTO_CAMPAIGN_ID,
  });

  for (const slot of slots) {
    try {
      const contentType = AUTO_CONTENT_TYPE;
      let composed: Awaited<ReturnType<typeof composePostImage>> | null = null;
      let cardContext: CardContext | undefined;
      try {
        composed = await composePostImage({
          platform,
          contentType,
          cardQuery: { sortBy: "sales_7day", category: "Baseball" },
        });
        cardContext = {
          player: composed.cardPlayer,
          set: composed.cardSet,
          cardPrice: composed.cardPrice,
          cardSales7d: composed.cardSales7d,
        };
      } catch (imageErr) {
        if (platform === "TIKTOK") throw imageErr;
        if (isVisualContentType(contentType)) {
          logger.warn("image_compose_failed_visual_slot_skipped", {
            platform,
            hour: slot.hour,
            contentType,
            error: String(imageErr),
          });
          continue;
        }
        logger.warn("image_compose_skipped_text_only", { platform, hour: slot.hour, error: String(imageErr) });
      }

      const draft = await generateDraftPost(platform, contentType, undefined, cardContext, slot.ritual);

      const preflightAtQueue = validatePostForPublishing({
        copyText: draft.copyText,
        contentType: draft.contentType,
        composedImagePath: composed?.imagePath ?? null,
        mediaRequired: isVisualContentType(draft.contentType),
        hashtags: draft.hashtags,
      });
      if (preflightAtQueue.blocked) {
        logger.warn("queue_slot_rejected_sor", {
          platform,
          hour: slot.hour,
          ritual: slot.ritual,
          reason: preflightAtQueue.reason,
        });
        continue;
      }

      const { abTestId } = await getOrCreateAbTest(AUTO_CAMPAIGN_ID, draft.contentType as any);

      const resolvedContentType = draft.contentType as string;
      const mediaRequired = isVisualContentType(resolvedContentType);
      await db.insert(socialPosts).values({
        platform,
        contentType: resolvedContentType as any,
        status: "QUEUED",
        abGroup: draft.abGroup as any,
        abTestId,
        campaignId: AUTO_CAMPAIGN_ID,
        cardId: composed?.cardId ?? null,
        cardImageUrl: composed?.cardImageUrl ?? null,
        composedImagePath: composed?.imagePath ?? null,
        cardQueryParams: draft.cardQueryParams,
        copyText: draft.copyText,
        hashtags: draft.hashtags,
        scheduledAt: buildScheduledTimeCt(slot.hour),
        factCheckPassed: draft.factCheckPassed ?? false,
        factCheckLog: draft.factCheckLog ?? [],
        mediaRequired,
        mediaStatus: composed ? "GENERATED" : "NOT_REQUIRED",
      });

      logger.info("post_queued", {
        platform,
        contentType: draft.contentType,
        hour: slot.hour,
        ritual: slot.ritual,
        campaign: AUTO_CAMPAIGN_ID,
        hasImage: !!composed,
      });
    } catch (err) {
      logger.error("queue_build_error", { platform, hour: slot.hour, ritual: slot.ritual, error: String(err) });
    }
  }
}

let lastQueueBuildDate = "";

export function startDailyQueueBuilder(): void {
  const intervalMs = 5 * 60 * 1000; // 5 minutes

  const tick = async () => {
    const today = chicagoDateKey();
    if (lastQueueBuildDate === today) return;

    const ctHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: DAILY5_TIMEZONE,
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
      10,
    );
    if (ctHour < agentConfig.dailyQueueBuildHour) return;

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
    try {
      await buildQueueForPlatform("DISCORD");
    } catch (err) {
      logger.error("queue_build_discord_failed", { error: String(err) });
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
  const EVOLUTION_HOUR_CT = 1; // 1am CT — runs before the 2am CT queue build
  const intervalMs = 5 * 60 * 1000; // Check every 5 minutes

  const tick = async () => {
    const today = chicagoDateKey();
    if (lastEvolutionDate === today) return;

    const ctHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: DAILY5_TIMEZONE,
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
      10,
    );
    if (ctHour < EVOLUTION_HOUR_CT) return;

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

  logger.info("prompt_evolution_loop_started", { hourCt: EVOLUTION_HOUR_CT });
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

      // Do not attempt publish (or fail-loop) when platform credentials are missing
      if (!isPlatformConfigured(post.platform as SocialPlatform)) {
        logUnconfiguredOnce("publisher", post.platform as SocialPlatform, { postId: post.id });
        await db.update(socialPosts).set({
          status: "SKIPPED",
          errorMessage: `platform_unconfigured: ${post.platform} credentials missing`,
          updatedAt: new Date(),
        }).where(eq(socialPosts.id, post.id));
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
        // Preflight: block posts that reference visual content without media
        const preflightResult = validatePostForPublishing({
          copyText: post.copyText,
          contentType: post.contentType,
          composedImagePath: post.composedImagePath,
          mediaRequired: post.mediaRequired,
          hashtags: post.hashtags,
        });
        if (preflightResult.blocked) {
          await db.update(socialPosts).set({
            status: "BLOCKED",
            publishBlockReason: preflightResult.reason,
            preflightPassed: false,
            updatedAt: new Date(),
          }).where(eq(socialPosts.id, post.id));
          logger.warn("post_blocked_preflight", { postId: post.id, reason: preflightResult.reason });
          continue;
        }

        let platformPostId: string;

        if (post.platform === "TWITTER") {
          // Load the image buffer from the composed path so it can be uploaded
          let imageBuffer: Buffer | undefined;
          if (post.composedImagePath) {
            const p = post.composedImagePath;
            if (p.startsWith("http")) {
              const res = await fetch(p);
              imageBuffer = Buffer.from(await res.arrayBuffer());
            } else if (fs.existsSync(p)) {
              imageBuffer = fs.readFileSync(p);
            }
          }
          platformPostId = await publishTweet(post.copyText, post.hashtags ?? [], imageBuffer, post.mediaRequired ?? false);
        } else if (post.platform === "DISCORD") {
          // Discord uses webhook — pass image URL directly (no buffer needed)
          const imageUrl = post.composedImagePath?.startsWith("http")
            ? post.composedImagePath
            : post.composedImagePath
              ? `${agentConfig.siteUrl}${post.composedImagePath}`
              : undefined;
          platformPostId = await publishDiscordMessage(post.copyText, post.hashtags ?? [], imageUrl, post.mediaRequired ?? false);
        } else {
          // Use stored URL directly when it's already absolute (R2 CDN URL);
          // fall back to constructing from siteUrl for local dev paths.
          const composedPath = post.composedImagePath ?? "";
          const publicUrl = composedPath.startsWith("http")
            ? composedPath
            : `${agentConfig.siteUrl}${composedPath}`;
          platformPostId = await publishPhoto(post.copyText.slice(0, 150), publicUrl);
        }

        await db.update(socialPosts).set({
          status: "PUBLISHED",
          platformPostId,
          publishedAt: new Date(),
          updatedAt: new Date(),
          preflightPassed: true,
          mediaStatus: post.composedImagePath ? "UPLOADED" : "NOT_REQUIRED",
        }).where(eq(socialPosts.id, post.id));

        logger.info("post_published", { postId: post.id, platform: post.platform, platformPostId });
      } catch (err) {
        const errMsg = String(err);
        // Missing credentials are not transient — skip once, do not fail-loop
        if (errMsg.includes("credentials_missing") || errMsg.includes("platform_unconfigured")) {
          logUnconfiguredOnce("publisher_error", post.platform as SocialPlatform, { postId: post.id });
          await db.update(socialPosts).set({
            status: "SKIPPED",
            errorMessage: errMsg,
            updatedAt: new Date(),
          }).where(eq(socialPosts.id, post.id));
          continue;
        }

        const attempts = (post.attemptCount ?? 0) + 1;
        const isFinal = attempts >= 3;
        const retryAt = new Date(Date.now() + 30 * 60 * 1000);

        await db.update(socialPosts).set({
          status: isFinal ? "FAILED" : "QUEUED",
          attemptCount: attempts,
          errorMessage: errMsg,
          scheduledAt: isFinal ? post.scheduledAt : retryAt,
          updatedAt: new Date(),
        }).where(eq(socialPosts.id, post.id));

        logger.error("publish_failed", {
          postId: post.id,
          platform: post.platform,
          attempt: attempts,
          final: isFinal,
          error: errMsg,
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
