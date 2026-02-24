import { scheduleJob, startScheduler, stopScheduler, getSchedule } from "./scheduler";
import { executeJob, getRegisteredJobs, startRetryWorker, stopRetryWorker } from "./jobRunner";
import { getStatus as getCircuitBreakerStatus, reset as resetCircuitBreaker } from "./circuitBreaker";
import { checkOpenAIConnectivity, getOpenAIHealthStatus } from "./openaiAdapter";
import { getPipelineHealth } from "./pipelineHealth";
import { getTikTokConfig } from "./tiktokConfig";

import "./contentJobs";
import "./autoPoster";
import "./tiktokJobs";
import "./crossPostJobs";
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

  const { validateAllCredentials: checkCreds } = await import("./platformAdapters");
  const credResults = await checkCreds();
  for (const cr of credResults) {
    if (cr.valid) {
      console.log(`[GrowthAgent] ${cr.platform} credentials: VALID`);
    } else if (cr.error === "Credentials not configured") {
      console.log(`[GrowthAgent] ${cr.platform} credentials: NOT CONFIGURED`);
    } else {
      console.error(`[GrowthAgent] WARNING: ${cr.platform} credentials INVALID — ${cr.error}`);
      console.error(`[GrowthAgent] ACTION REQUIRED: Update ${cr.platform} API credentials in Secrets tab. Posts will fail until fixed.`);
    }
  }

  const igAutopost = process.env.GROWTH_IG_AUTOPOST === "true";
  const fbAutopost = process.env.GROWTH_FB_AUTOPOST === "true";
  console.log(`[GrowthAgent] Instagram auto-post: ${igAutopost ? "ENABLED" : "DISABLED"}`);
  console.log(`[GrowthAgent] Facebook auto-post: ${fbAutopost ? "ENABLED" : "DISABLED"}`);

  scheduleJob("generate_daily_plan", 13, 0);
  scheduleJob("generate_content_items", 13, 15);
  scheduleJob("generate_daily5_announcement", 1, 5);
  scheduleJob("generate_daily5_recap", 5, 0);
  scheduleJob("auto_post_ready_content", 14, 0);
  scheduleJob("auto_post_ready_content", 18, 0);

  if (tiktokCfg.enabled) {
    scheduleJob("generate_tiktok_packages", 13, 20);
    scheduleJob("generate_viral_tiktok_packages", 13, 25);
    scheduleJob("render_tiktok_videos", 13, 35);
  }

  if (igAutopost || fbAutopost) {
    scheduleJob("crosspost_to_ig_fb", 13, 40);
    scheduleJob("auto_post_ready_content", 14, 15);
  }

  startScheduler();
  startRetryWorker();
  initialized = true;

  const jobs = getRegisteredJobs();
  const schedule = getSchedule();
  console.log(`[GrowthAgent] Ready: ${jobs.length} jobs, ${schedule.length} scheduled tasks`);
  console.log(`[GrowthAgent] Jobs: ${jobs.join(", ")}`);
}

export { executeJob, getRegisteredJobs } from "./jobRunner";
export { getSchedule } from "./scheduler";
export { getStatus as getCircuitBreakerStatus, reset as resetCircuitBreaker } from "./circuitBreaker";
export { postToDiscord, postToFacebook, validateAllCredentials, validateTwitterCredentials, validateInstagramCredentials, validateFacebookCredentials, clearCredentialCache } from "./platformAdapters";
export { checkOpenAIConnectivity, getOpenAIHealthStatus } from "./openaiAdapter";
export { getPipelineHealth } from "./pipelineHealth";
export { getTikTokConfig } from "./tiktokConfig";
