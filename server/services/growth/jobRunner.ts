import { db } from "../../db";
import { growthJobRuns } from "@shared/schema";
import { eq, and, sql, desc, lte } from "drizzle-orm";
import { isOpen, recordFailure, recordSuccess } from "./circuitBreaker";
import crypto from "crypto";

export interface JobContext {
  runId: string;
  jobName: string;
  idempotencyKey: string;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, any>>;

const MAX_RETRIES = 3;
const registeredJobs = new Map<string, JobHandler>();
let retryTimerHandle: ReturnType<typeof setInterval> | null = null;

function getRetryDelayMs(attempt: number): number {
  return Math.pow(2, attempt) * 60_000;
}

export function registerJob(name: string, handler: JobHandler): void {
  registeredJobs.set(name, handler);
  console.log(`[GrowthJobRunner] Registered job: ${name}`);
}

export async function executeJob(
  jobName: string,
  opts: { idempotencyKey?: string; skipCircuitBreaker?: boolean } = {}
): Promise<{ runId: string; status: string; details?: any; error?: string }> {
  const handler = registeredJobs.get(jobName);
  if (!handler) throw new Error(`Unknown job: ${jobName}`);

  if (!opts.skipCircuitBreaker && isOpen()) {
    console.warn(`[GrowthJobRunner] Circuit breaker OPEN, skipping job: ${jobName}`);
    return { runId: "", status: "SKIPPED", error: "Circuit breaker open" };
  }

  const idempotencyKey = opts.idempotencyKey || `${jobName}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  const existingRun = await db.select().from(growthJobRuns)
    .where(
      and(
        eq(growthJobRuns.jobName, jobName),
        sql`${growthJobRuns.details}->>'idempotencyKey' = ${idempotencyKey}`
      )
    )
    .limit(1);

  if (existingRun.length > 0) {
    const existing = existingRun[0];
    if (existing.status === "SKIPPED" || existing.status === "FAILED" || existing.status === "RETRY_PENDING") {
      console.log(`[GrowthJobRunner] Re-running previously ${existing.status} job: ${jobName} (key=${idempotencyKey})`);
      await db.delete(growthJobRuns).where(eq(growthJobRuns.id, existing.id));
    } else {
      console.log(`[GrowthJobRunner] Idempotency hit: ${jobName} (key=${idempotencyKey}, run=${existing.id}, status=${existing.status})`);
      return { runId: existing.id, status: existing.status, details: existing.details as any };
    }
  }

  const [run] = await db.insert(growthJobRuns).values({
    jobName,
    status: "STARTED",
    details: { idempotencyKey, retryCount: 0 },
  }).returning();

  return runJobExecution(run.id, jobName, handler, idempotencyKey, 0);
}

async function runJobExecution(
  runId: string,
  jobName: string,
  handler: JobHandler,
  idempotencyKey: string,
  retryCount: number,
): Promise<{ runId: string; status: string; details?: any; error?: string }> {
  try {
    const details = await handler({ runId, jobName, idempotencyKey });

    const finalStatus = details.skipped ? "SKIPPED" : "SUCCEEDED";
    await db.update(growthJobRuns)
      .set({
        status: finalStatus,
        endedAt: new Date(),
        details: { ...details, idempotencyKey, retryCount },
      })
      .where(eq(growthJobRuns.id, runId));

    if (!details.skipped) {
      recordSuccess();
    }
    console.log(`[GrowthJobRunner] Job ${jobName} ${finalStatus} (run=${runId}, attempt=${retryCount + 1})${details.reason ? ` - ${details.reason}` : ""}`);
    return { runId, status: finalStatus, details };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);

    if (retryCount < MAX_RETRIES) {
      const retryAt = new Date(Date.now() + getRetryDelayMs(retryCount + 1));
      await db.update(growthJobRuns)
        .set({
          status: "RETRY_PENDING",
          error: errorMsg,
          details: {
            idempotencyKey,
            retryCount: retryCount + 1,
            retryAt: retryAt.toISOString(),
            maxRetries: MAX_RETRIES,
            lastError: errorMsg,
          },
        })
        .where(eq(growthJobRuns.id, runId));
      console.warn(`[GrowthJobRunner] Job ${jobName} failed (attempt ${retryCount + 1}/${MAX_RETRIES + 1}), retry at ${retryAt.toISOString()}: ${errorMsg}`);
      return { runId, status: "RETRY_PENDING", error: errorMsg };
    }

    await db.update(growthJobRuns)
      .set({
        status: "FAILED",
        endedAt: new Date(),
        error: errorMsg,
        details: {
          idempotencyKey,
          retryCount,
          maxRetries: MAX_RETRIES,
          exhaustedRetries: true,
          lastError: errorMsg,
        },
      })
      .where(eq(growthJobRuns.id, runId));
    recordFailure();
    console.error(`[GrowthJobRunner] Job ${jobName} permanently failed after ${retryCount + 1} attempts (run=${runId}): ${errorMsg}`);
    return { runId, status: "FAILED", error: errorMsg };
  }
}

async function processRetryQueue(): Promise<void> {
  try {
    const pendingRetries = await db.select().from(growthJobRuns)
      .where(eq(growthJobRuns.status, "RETRY_PENDING"))
      .orderBy(growthJobRuns.startedAt)
      .limit(10);

    if (pendingRetries.length === 0) return;

    const now = new Date();
    for (const run of pendingRetries) {
      const details = run.details as { retryAt?: string; idempotencyKey?: string; retryCount?: number } | null;
      if (!details?.retryAt) continue;

      const retryAt = new Date(details.retryAt);
      if (retryAt > now) continue;

      const handler = registeredJobs.get(run.jobName);
      if (!handler) {
        await db.update(growthJobRuns)
          .set({ status: "FAILED", endedAt: new Date(), error: `Job handler not found: ${run.jobName}` })
          .where(eq(growthJobRuns.id, run.id));
        continue;
      }

      if (isOpen()) {
        console.warn(`[GrowthJobRunner] Circuit breaker OPEN, deferring retry: ${run.jobName}`);
        continue;
      }

      console.log(`[GrowthJobRunner] Retrying job: ${run.jobName} (run=${run.id}, attempt=${(details.retryCount || 0) + 1})`);
      await db.update(growthJobRuns)
        .set({ status: "STARTED" })
        .where(eq(growthJobRuns.id, run.id));

      await runJobExecution(
        run.id,
        run.jobName,
        handler,
        details.idempotencyKey || run.id,
        details.retryCount || 0,
      );
    }
  } catch (err) {
    console.error("[GrowthJobRunner] Retry queue processing error:", err);
  }
}

export function startRetryWorker(): void {
  if (retryTimerHandle) return;
  retryTimerHandle = setInterval(processRetryQueue, 120_000);
  console.log("[GrowthJobRunner] Retry worker started (interval: 120s)");
}

export function stopRetryWorker(): void {
  if (retryTimerHandle) {
    clearInterval(retryTimerHandle);
    retryTimerHandle = null;
  }
}

export function getRegisteredJobs(): string[] {
  return Array.from(registeredJobs.keys());
}
