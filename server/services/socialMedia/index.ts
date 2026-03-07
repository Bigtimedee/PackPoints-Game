import { db } from "../../db";
import { sql } from "drizzle-orm";
import { agentConfig } from "./config";
import { createLogger } from "./logger";
import { cardSearchSorted } from "../../services/cardhedge/client";
import { verifyCreatorInfo } from "./publisher/tiktok";
import { startDailyQueueBuilder, startPublisherLoop, startAnalyticsFetcher } from "./scheduler";
import { campaignRewards } from "@shared/schema";
import { count } from "drizzle-orm";

const logger = createLogger("SocialMediaAgent");

let twitterEnabled = false;
let tiktokEnabled = false;
let agentRunning = false;
let startedAt: Date | null = null;

export interface AgentStatusResponse {
  running: boolean;
  dryRun: boolean;
  twitter: boolean;
  tiktok: boolean;
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

  // 2. Verify CardHedge — HARD FAIL
  try {
    await cardSearchSorted({ page: 1, page_size: 1 });
  } catch (err) {
    logger.error("cardhedge_check_failed", { error: String(err) });
    throw new Error("[SocialMediaAgent] CardHedge connectivity check failed");
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

  logger.info("startup_summary", {
    db: "✓",
    cardhedge: "✓",
    twitter: twitterEnabled ? "✓" : "✗",
    tiktok: tiktokEnabled ? "✓" : "✗",
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

  // 6. Start loops
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
    startedAt: startedAt?.toISOString() ?? null,
  };
}
