import { scheduleJob, startScheduler, stopScheduler, getSchedule, startNotionSync, stopNotionSync } from "./scheduler";
import { executeJob, getRegisteredJobs, startRetryWorker, stopRetryWorker } from "./jobRunner";
import { getStatus as getCircuitBreakerStatus, reset as resetCircuitBreaker } from "./circuitBreaker";
import { checkOpenAIConnectivity, getOpenAIHealthStatus } from "./openaiAdapter";
import { getPipelineHealth } from "./pipelineHealth";
import { getTikTokConfig } from "./tiktokConfig";

import "./contentJobs";
import "./autoPoster";
import "./tiktokJobs";
import "./crossPostJobs";
import "./notionSyncJob";
import "./dmJobs";
import "../../videoFactory/workerJob";

let initialized = false;

export async function initGrowthAgent(): Promise<void> {
  if (initialized) return;

  const enabled = process.env.GROWTH_AGENT_ENABLED === "true";
  if (!enabled) {
    console.log("[GrowthAgent] Disabled (set GROWTH_AGENT_ENABLED=true to enable)");
    return;
  }

  console.log("[GrowthAgent] Initializing...");

  const connectivityResult = await checkOpenAIConnectivity();
  if (!connectivityResult.ok) {
    console.error(`[GrowthAgent] WARNING: OpenAI connectivity check FAILED: ${connectivityResult.error}`);
    console.error("[GrowthAgent] Content generation jobs will fail until OpenAI access is restored.");
  } else {
    console.log(`[GrowthAgent] OpenAI connected via: ${connectivityResult.source}`);
  }

  const tiktokCfg = getTikTokConfig();
  console.log(`[GrowthAgent] TikTok: ${tiktokCfg.enabled ? "ENABLED (manual mode)" : "DISABLED"}`);

  const { validateTwitterCredentials } = await import("./platformAdapters");
  const twitterCreds = await validateTwitterCredentials();
  if (twitterCreds.valid) {
    console.log(`[GrowthAgent] x credentials: VALID`);
  } else if (twitterCreds.error === "Credentials not configured") {
    console.log(`[GrowthAgent] x credentials: NOT CONFIGURED`);
  } else {
    console.error(`[GrowthAgent] WARNING: x credentials INVALID — ${twitterCreds.error}`);
    console.error(`[GrowthAgent] ACTION REQUIRED: Update x API credentials in Secrets tab. Posts will fail until fixed.`);
  }
  console.log(`[GrowthAgent] Instagram/Facebook: AUTONOMOUS AUTO-POSTING ENABLED`);

  scheduleJob("generate_daily_plan", 12, 0);
  scheduleJob("generate_content_items", 12, 30);
  scheduleJob("generate_daily5_announcement", 1, 5);
  scheduleJob("generate_daily5_recap", 5, 0);
  scheduleJob("auto_post_ready_content", 14, 0);
  scheduleJob("auto_post_ready_content", 18, 0);
  scheduleJob("send_follower_dms", 8,  0);
  scheduleJob("send_follower_dms", 12, 0);
  scheduleJob("send_follower_dms", 16, 0);
  scheduleJob("send_follower_dms", 20, 0);

  if (tiktokCfg.enabled) {
    scheduleJob("generate_tiktok_packages", 13, 20);
    scheduleJob("generate_viral_tiktok_packages", 13, 25);
    scheduleJob("render_tiktok_videos", 13, 35);
    scheduleJob("crosspost_to_ig_fb", 13, 40);
  }

  scheduleJob("auto_post_ready_content", 10, 0);

  startScheduler();
  startRetryWorker();
  startNotionSync();
  initialized = true;

  const jobs = getRegisteredJobs();
  const schedule = getSchedule();
  console.log(`[GrowthAgent] Ready: ${jobs.length} jobs, ${schedule.length} scheduled tasks`);
  console.log(`[GrowthAgent] Jobs: ${jobs.join(", ")}`);

  // On every startup: generate today's content if none exists, then immediately
  // promote any MANUAL_QUEUE backlog and post whatever is READY.
  // Both jobs are fully idempotent — safe to run on every deploy.
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  setTimeout(() => {
    executeJob("generate_content_items", { idempotencyKey: `startup_content_${todayKey}` })
      .then(() => executeJob("auto_post_ready_content", { idempotencyKey: `startup_autopost_${todayKey}_${Date.now()}` }))
      .catch(err => console.warn("[GrowthAgent] Startup bootstrap run:", err?.message));
  }, 90_000);
}

export { executeJob, getRegisteredJobs } from "./jobRunner";
export { getSchedule } from "./scheduler";
export { getStatus as getCircuitBreakerStatus, reset as resetCircuitBreaker } from "./circuitBreaker";
export { postToDiscord, postToFacebook, validateAllCredentials, validateTwitterCredentials, validateInstagramCredentials, validateFacebookCredentials, clearCredentialCache } from "./platformAdapters";
export { checkOpenAIConnectivity, getOpenAIHealthStatus } from "./openaiAdapter";
export { getPipelineHealth } from "./pipelineHealth";
export { getTikTokConfig } from "./tiktokConfig";
