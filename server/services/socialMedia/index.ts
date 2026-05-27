import { db } from "../../db";
import { sql, eq } from "drizzle-orm";
import { agentConfig } from "./config";
import { createLogger } from "./logger";
import { cardSearchSorted } from "../../services/cardhedge/client";
import { verifyCreatorInfo } from "./publisher/tiktok";
import { verifyWebhook as verifyDiscordWebhook } from "./publisher/discord";
import { startDailyQueueBuilder, startPublisherLoop, startAnalyticsFetcher, startPromptEvolutionLoop } from "./scheduler";
import { campaignRewards, socialPosts } from "@shared/schema";
import { count } from "drizzle-orm";

const logger = createLogger("SocialMediaAgent");

let twitterEnabled = false;
let tiktokEnabled = false;
let discordEnabled = false;
let agentRunning = false;
let startedAt: Date | null = null;

export interface AgentStatusResponse {
  running: boolean;
  dryRun: boolean;
  twitter: boolean;
  tiktok: boolean;
  discord: boolean;
  startedAt: string | null;
}

async function seedCampaignRewards(): Promise<void> {
  const result = await db.select({ cnt: count() }).from(campaignRewards);
  if ((result[0]?.cnt ?? 0) > 0) return;

  await db.insert(campaignRewards).values([
    {
      campaignId: "new-user-acquisition-v1",
      rewardType: "SIGNUP_BONUS",
      rewardDescription: "Welcome bonus for new PackPTS registrations",
      rewardValue: "500",
      isActive: true,
    },
    {
      campaignId: "new-user-acquisition-v1",
      rewardType: "STREAK_REWARD",
      rewardDescription: "First 7-day streak completion reward",
      rewardValue: "250",
      isActive: true,
    },
  ]);

  logger.info("campaign_rewards_seeded");
}

export async function initSocialMediaAgent(): Promise<void> {
  if (!agentConfig.enabled) {
    logger.info("agent_disabled", { reason: "SOCIAL_MEDIA_AGENT_ENABLED != true" });
    return;
  }

  logger.info("agent_starting");

  // 1. Verify DB — HARD FAIL
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    logger.error("db_check_failed", { error: String(err) });
    throw new Error("[SocialMediaAgent] DB connectivity check failed");
  }

  // 2. Verify CardHedge — SOFT FAIL (image composition will fail per-post if unavailable)
  try {
    await cardSearchSorted({ page: 1, page_size: 1, category: "Baseball" });
  } catch (err) {
    logger.warn("cardhedge_check_failed", { error: String(err) });
  }

  // 3. Verify Twitter — SOFT FAIL
  try {
    const { TwitterApi } = await import("twitter-api-v2");
    const { twitter } = agentConfig;
    if (twitter.apiKey && twitter.accessToken) {
      const client = new TwitterApi({
        appKey: twitter.apiKey,
        appSecret: twitter.apiSecret,
        accessToken: twitter.accessToken,
        accessSecret: twitter.accessTokenSecret,
      });
      await client.v2.me();
      twitterEnabled = true;
    } else {
      logger.warn("twitter_creds_missing");
    }
  } catch (err) {
    logger.warn("twitter_check_failed", { error: String(err) });
  }

  // 4. Verify TikTok — SOFT FAIL
  try {
    if (agentConfig.tiktok.accessToken) {
      const ok = await verifyCreatorInfo();
      tiktokEnabled = ok;
      if (!ok) logger.warn("tiktok_check_failed");
    } else {
      logger.warn("tiktok_creds_missing");
    }
  } catch (err) {
    logger.warn("tiktok_verify_error", { error: String(err) });
  }

  // 4b. Verify Discord — SOFT FAIL
  try {
    if (agentConfig.discord.webhookUrl) {
      const ok = await verifyDiscordWebhook();
      discordEnabled = ok;
      if (!ok) logger.warn("discord_check_failed");
    } else {
      logger.warn("discord_webhook_missing");
    }
  } catch (err) {
    logger.warn("discord_verify_error", { error: String(err) });
  }

  logger.info("startup_summary", {
    db: "✓",
    cardhedge: "✓",
    twitter: twitterEnabled ? "✓" : "✗",
    tiktok: tiktokEnabled ? "✓" : "✗",
    discord: discordEnabled ? "✓" : "✗",
    dryRun: agentConfig.dryRun,
  });

  if (agentConfig.dryRun) {
    logger.info("dry_run_mode", { message: "DRY RUN MODE — no posts will be published" });
  }

  // 5. Seed rewards
  try {
    await seedCampaignRewards();
  } catch (err) {
    logger.warn("seed_rewards_failed", { error: String(err) });
  }

  // 5b. Recover posts stuck in PUBLISHING state from previous crash
  await db.update(socialPosts)
    .set({ status: 'QUEUED', updatedAt: new Date() })
    .where(eq(socialPosts.status, 'PUBLISHING'));
  logger.info('Recovered stuck PUBLISHING posts to QUEUED');

  // 5c. Block any queued posts with visual copy but no media
  try {
    const { auditBlockedPosts } = await import("./preflight");
    const { blocked } = await auditBlockedPosts();
    if (blocked > 0) logger.warn("startup_audit_blocked_posts", { blocked });
  } catch (err) {
    logger.warn("startup_audit_failed", { error: String(err) });
  }

  // 6. Start loops
  startPromptEvolutionLoop();
  startDailyQueueBuilder();
  startPublisherLoop();
  startAnalyticsFetcher();

  agentRunning = true;
  startedAt = new Date();
  logger.info("agent_started");
}

export function getSocialAgentStatus(): AgentStatusResponse {
  return {
    running: agentRunning,
    dryRun: agentConfig.dryRun,
    twitter: twitterEnabled,
    tiktok: tiktokEnabled,
    discord: discordEnabled,
    startedAt: startedAt?.toISOString() ?? null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  initSocialMediaAgent().catch(err => {
    console.error('[SocialMedia] Fatal error:', err);
    process.exit(1);
  });
}
