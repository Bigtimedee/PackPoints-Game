import { executeJob, getRegisteredJobs } from "./jobRunner";

interface ScheduledJob {
  name: string;
  cronHour: number;
  cronMinute: number;
  lastRun: string;
}

const schedule: ScheduledJob[] = [];
let intervalHandle: NodeJS.Timeout | null = null;
let notionSyncInterval: NodeJS.Timeout | null = null;

export function scheduleJob(name: string, hour: number, minute: number): void {
  schedule.push({ name, cronHour: hour, cronMinute: minute, lastRun: "" });
  console.log(`[GrowthScheduler] Scheduled ${name} at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} UTC`);
}

function getChicagoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

async function tick(): Promise<void> {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();

  for (const job of schedule) {
    if (job.cronHour === utcHour && utcMinute >= job.cronMinute && utcMinute < job.cronMinute + 5) {
      const today = getChicagoDate();
      const key = `${job.name}_${today}`;
      if (job.lastRun === key) continue;
      job.lastRun = key;
      console.log(`[GrowthScheduler] Triggering scheduled job: ${job.name}`);
      try {
        await executeJob(job.name, { idempotencyKey: key });
      } catch (err: any) {
        console.error(`[GrowthScheduler] Error running ${job.name}:`, err?.message);
      }
    }
  }
}

export function startScheduler(): void {
  if (intervalHandle) return;
  console.log("[GrowthScheduler] Starting with", schedule.length, "scheduled jobs");
  intervalHandle = setInterval(() => {
    tick().catch(err => console.error("[GrowthScheduler] Tick error:", err));
  }, 60 * 1000);
}

export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[GrowthScheduler] Stopped");
  }
}

async function syncNotionTick(): Promise<void> {
  try {
    const { syncContentToNotion } = await import("../notion/exportContentToNotion");
    const result = await syncContentToNotion();
    console.log(`[NotionSync] ✅ Synced ${result.synced} items, ${result.errors} errors, ${result.skipped} skipped`);
  } catch (err: any) {
    console.error(`[NotionSync] ❌ Error:`, err?.message);
  }
}

export function startNotionSync(): void {
  if (notionSyncInterval) return;

  const enabled = process.env.NOTION_API_KEY && process.env.NOTION_CONTENT_DATABASE_ID;
  if (!enabled) {
    console.log("[NotionSync] Disabled (set NOTION_API_KEY and NOTION_CONTENT_DATABASE_ID to enable)");
    return;
  }

  console.log("[NotionSync] Starting sync every 15 minutes");

  // Run immediately on startup
  syncNotionTick();

  // Then every 15 minutes
  notionSyncInterval = setInterval(() => {
    syncNotionTick().catch(err => console.error("[NotionSync] Tick error:", err));
  }, 15 * 60 * 1000);
}

export function stopNotionSync(): void {
  if (notionSyncInterval) {
    clearInterval(notionSyncInterval);
    notionSyncInterval = null;
    console.log("[NotionSync] Stopped");
  }
}

export function getSchedule(): ScheduledJob[] {
  return [...schedule];
}
