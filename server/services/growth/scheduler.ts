import { executeJob, getRegisteredJobs } from "./jobRunner";

interface ScheduledJob {
  name: string;
  cronHour: number;
  cronMinute: number;
  lastRun: string;
}

const schedule: ScheduledJob[] = [];
let intervalHandle: NodeJS.Timeout | null = null;

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

export function getSchedule(): ScheduledJob[] {
  return [...schedule];
}
