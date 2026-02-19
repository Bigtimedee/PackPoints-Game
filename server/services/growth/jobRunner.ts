import { db } from "../../db";
import { growthJobRuns } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { isOpen, recordFailure, recordSuccess } from "./circuitBreaker";
import crypto from "crypto";

export interface JobContext {
  runId: string;
  jobName: string;
  idempotencyKey: string;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, any>>;

const registeredJobs = new Map<string, JobHandler>();

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
    if (existing.status === "SKIPPED" || existing.status === "FAILED") {
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
    details: { idempotencyKey },
  }).returning();

  try {
    const details = await handler({ runId: run.id, jobName, idempotencyKey });

    const finalStatus = details.skipped ? "SKIPPED" : "SUCCEEDED";
    await db.update(growthJobRuns)
      .set({ status: finalStatus, endedAt: new Date(), details: { ...details, idempotencyKey } })
      .where(eq(growthJobRuns.id, run.id));

    if (!details.skipped) {
      recordSuccess();
    }
    console.log(`[GrowthJobRunner] Job ${jobName} ${finalStatus} (run=${run.id})${details.reason ? ` - ${details.reason}` : ""}`);
    return { runId: run.id, status: finalStatus, details };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    await db.update(growthJobRuns)
      .set({ status: "FAILED", endedAt: new Date(), error: errorMsg, details: { idempotencyKey } })
      .where(eq(growthJobRuns.id, run.id));
    recordFailure();
    console.error(`[GrowthJobRunner] Job ${jobName} failed (run=${run.id}):`, errorMsg);
    return { runId: run.id, status: "FAILED", error: errorMsg };
  }
}

export function getRegisteredJobs(): string[] {
  return Array.from(registeredJobs.keys());
}
