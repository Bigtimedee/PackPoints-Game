import { scheduleJob, startScheduler, stopScheduler, getSchedule } from "./scheduler";
import { executeJob, getRegisteredJobs, startRetryWorker, stopRetryWorker } from "./jobRunner";
import { getStatus as getCircuitBreakerStatus, reset as resetCircuitBreaker } from "./circuitBreaker";
import { checkOpenAIConnectivity, getOpenAIHealthStatus } from "./openaiAdapter";
import { getPipelineHealth } from "./pipelineHealth";

import "./contentJobs";
import "./autoPoster";

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

  scheduleJob("generate_daily_plan", 13, 0);
  scheduleJob("generate_content_items", 13, 15);
  scheduleJob("generate_daily5_announcement", 1, 5);
  scheduleJob("generate_daily5_recap", 5, 0);
  scheduleJob("auto_post_ready_content", 14, 0);
  scheduleJob("auto_post_ready_content", 18, 0);

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
export { postToDiscord } from "./platformAdapters";
export { checkOpenAIConnectivity, getOpenAIHealthStatus } from "./openaiAdapter";
export { getPipelineHealth } from "./pipelineHealth";
