import { db } from "../../db";
import { eq, and, lte, sql } from "drizzle-orm";
import { riskJobs, InsertRiskJob } from "@shared/schema";
import { computeUserRollup24h, computeDeviceRollup24h, computeIpRollup24h, getTodayWindowStart } from "./rollups24h";
import { updateRiskSnapshot } from "./snapshot";

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 5000;

let isRunning = false;
let pollTimeout: NodeJS.Timeout | null = null;

export async function enqueueRiskJob(
  jobType: InsertRiskJob["jobType"],
  options: {
    userId?: string;
    deviceId?: string;
    ipHash?: string;
    runAfter?: Date;
  } = {}
): Promise<void> {
  try {
    await db.insert(riskJobs).values({
      jobType,
      userId: options.userId || null,
      deviceId: options.deviceId || null,
      ipHash: options.ipHash || null,
      runAfter: options.runAfter || new Date(),
      status: "PENDING",
      attempts: 0,
    });
  } catch (error) {
    console.error("[RiskJobQueue] Failed to enqueue job:", error);
  }
}

export async function enqueueRiskRecalc(
  userId: string,
  deviceId?: string,
  ipHash?: string
): Promise<void> {
  await enqueueRiskJob("ROLLUP_24H", { userId, deviceId, ipHash });
  await enqueueRiskJob("UPDATE_SNAPSHOT", { userId });
}

async function claimNextJob(): Promise<typeof riskJobs.$inferSelect | null> {
  const now = new Date();

  // Use a single atomic UPDATE with subquery to claim exactly one job
  // This prevents race conditions where multiple workers claim the same job
  const result = await db.execute(sql`
    UPDATE risk_jobs
    SET 
      status = 'RUNNING',
      attempts = attempts + 1,
      updated_at = NOW()
    WHERE id = (
      SELECT id FROM risk_jobs
      WHERE status = 'PENDING' AND run_after <= ${now}
      ORDER BY run_after
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  const row = (result as any).rows?.[0];
  if (!row) return null;

  return {
    id: row.id,
    jobType: row.job_type,
    userId: row.user_id,
    deviceId: row.device_id,
    ipHash: row.ip_hash,
    status: row.status,
    attempts: row.attempts,
    runAfter: row.run_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  } as typeof riskJobs.$inferSelect;
}

async function executeJob(job: typeof riskJobs.$inferSelect): Promise<void> {
  const windowStart = getTodayWindowStart();

  switch (job.jobType) {
    case "ROLLUP_24H":
      if (job.userId) {
        await computeUserRollup24h(job.userId, windowStart);
      }
      if (job.deviceId) {
        await computeDeviceRollup24h(job.deviceId, windowStart);
      }
      if (job.ipHash) {
        await computeIpRollup24h(job.ipHash, windowStart);
      }
      break;

    case "COMPUTE_SIGNALS":
    case "UPDATE_SNAPSHOT":
      if (job.userId) {
        await updateRiskSnapshot(job.userId);
      }
      break;
  }
}

async function processJob(job: typeof riskJobs.$inferSelect): Promise<void> {
  try {
    await executeJob(job);

    await db
      .update(riskJobs)
      .set({
        status: "SUCCEEDED",
        updatedAt: new Date(),
      })
      .where(eq(riskJobs.id, job.id));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[RiskJobQueue] Job ${job.id} failed:`, errorMessage);

    const attempts = (job.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await db
        .update(riskJobs)
        .set({
          status: "FAILED",
          lastError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(riskJobs.id, job.id));
    } else {
      const backoffSeconds = Math.min(Math.pow(2, attempts) * 30, 600);
      const runAfter = new Date(Date.now() + backoffSeconds * 1000);

      await db
        .update(riskJobs)
        .set({
          status: "PENDING",
          runAfter,
          lastError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(riskJobs.id, job.id));
    }
  }
}

async function pollJobs(): Promise<void> {
  if (!isRunning) return;

  try {
    const job = await claimNextJob();
    if (job) {
      await processJob(job);
    }
  } catch (error) {
    console.error("[RiskJobQueue] Poll error:", error);
  }

  if (isRunning) {
    pollTimeout = setTimeout(pollJobs, POLL_INTERVAL_MS);
  }
}

export function startRiskJobWorker(): void {
  if (isRunning) {
    console.log("[RiskJobQueue] Worker already running");
    return;
  }

  console.log("[RiskJobQueue] Starting worker");
  isRunning = true;
  pollJobs();
}

export function stopRiskJobWorker(): void {
  console.log("[RiskJobQueue] Stopping worker");
  isRunning = false;
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }
}

export function isRiskJobWorkerRunning(): boolean {
  return isRunning;
}
