/**
 * growthAgent/index.ts
 *
 * Orchestrator for the PackPTS Growth Agent.
 * Coordinates daily plan generation, content item creation, job run tracking,
 * and publishing queue population.
 *
 * Usage:
 *   import { runDailyGrowthJob } from "./services/growthAgent";
 *   await runDailyGrowthJob("2025-04-12");
 */
import { randomUUID } from "crypto";
import { db } from "../../db";
import {
  growthContentPlans,
  growthContentItems,
  growthJobRuns,
  publishingQueue,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateDailyPlan } from "./planGenerator";
import { generateContentItems } from "./contentGenerator";

export interface GrowthJobResult {
  jobRunId: string;
  planId: string;
  itemsGenerated: number;
  status: "COMPLETE" | "FAILED";
  error?: string;
}

/**
 * Run the daily growth agent job for a given date.
 * Idempotent: if a COMPLETE plan already exists for the date, returns it.
 */
export async function runDailyGrowthJob(date: string): Promise<GrowthJobResult> {
  const jobRunId = randomUUID();
  const logs: string[] = [];

  function log(msg: string) {
    logs.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(`[GrowthAgent] ${msg}`);
  }

  // Insert job run record
  await db.insert(growthJobRuns).values({
    id: jobRunId,
    jobType: "DAILY_PLAN",
    status: "RUNNING",
    targetDate: date,
    planId: null,
    itemsGenerated: 0,
    log: "",
  });

  async function failJob(error: string, planId?: string): Promise<GrowthJobResult> {
    logs.push(`[ERROR] ${error}`);
    await db
      .update(growthJobRuns)
      .set({
        status: "FAILED",
        errorMessage: error,
        log: logs.join("\n"),
        completedAt: new Date(),
        planId: planId ?? null,
      })
      .where(eq(growthJobRuns.id, jobRunId));
    return { jobRunId, planId: planId ?? "", itemsGenerated: 0, status: "FAILED", error };
  }

  try {
    // Idempotency: check for existing complete plan
    const existing = await db
      .select()
      .from(growthContentPlans)
      .where(and(eq(growthContentPlans.date, date), eq(growthContentPlans.status, "COMPLETE")))
      .limit(1);

    if (existing.length > 0) {
      log(`Existing complete plan found for ${date} (id=${existing[0].id}), skipping.`);
      const itemCount = await db
        .select({ id: growthContentItems.id })
        .from(growthContentItems)
        .where(eq(growthContentItems.planId, existing[0].id));

      await db
        .update(growthJobRuns)
        .set({
          status: "COMPLETE",
          planId: existing[0].id,
          itemsGenerated: itemCount.length,
          log: logs.join("\n"),
          completedAt: new Date(),
        })
        .where(eq(growthJobRuns.id, jobRunId));

      return {
        jobRunId,
        planId: existing[0].id,
        itemsGenerated: itemCount.length,
        status: "COMPLETE",
      };
    }

    // Create a plan record in GENERATING state
    const planId = randomUUID();
    log(`Creating plan ${planId} for ${date}`);
    await db.insert(growthContentPlans).values({
      id: planId,
      date,
      status: "GENERATING",
    });

    // Generate plan via AI
    log("Generating daily plan via AI...");
    let planOutput;
    try {
      planOutput = await generateDailyPlan(date);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(growthContentPlans)
        .set({ status: "FAILED", errorMessage: msg, updatedAt: new Date() })
        .where(eq(growthContentPlans.id, planId));
      return failJob(`Plan generation failed: ${msg}`, planId);
    }

    log(`Plan generated. Themes: ${planOutput.themes.join(", ")}`);

    // Update plan with AI output
    await db
      .update(growthContentPlans)
      .set({
        status: "GENERATING",
        platformTargets: planOutput.platformTargets,
        themes: planOutput.themes,
        goals: planOutput.goals,
        summary: planOutput.summary,
        updatedAt: new Date(),
      })
      .where(eq(growthContentPlans.id, planId));

    // Generate content items
    log("Generating content items...");
    let items;
    try {
      items = await generateContentItems(planId, planOutput);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(growthContentPlans)
        .set({ status: "FAILED", errorMessage: msg, updatedAt: new Date() })
        .where(eq(growthContentPlans.id, planId));
      return failJob(`Content generation failed: ${msg}`, planId);
    }

    log(`Generated ${items.length} content items.`);

    // Insert content items
    const insertedIds: string[] = [];
    for (const item of items) {
      const itemId = randomUUID();
      insertedIds.push(itemId);
      await db.insert(growthContentItems).values({
        id: itemId,
        planId,
        ...item,
      });
    }

    // Auto-queue DRAFT items that succeeded
    const successItems = items
      .map((item, i) => ({ item, id: insertedIds[i] }))
      .filter(({ item }) => item.status === "DRAFT");

    for (const { id: contentItemId, item } of successItems) {
      await db.insert(publishingQueue).values({
        id: randomUUID(),
        contentItemId,
        platform: item.platform,
        status: "PENDING",
        retryCount: 0,
      });
    }

    log(`Queued ${successItems.length} items for publishing.`);

    // Mark plan COMPLETE
    await db
      .update(growthContentPlans)
      .set({ status: "COMPLETE", updatedAt: new Date() })
      .where(eq(growthContentPlans.id, planId));

    // Complete job run
    await db
      .update(growthJobRuns)
      .set({
        status: "COMPLETE",
        planId,
        itemsGenerated: items.length,
        log: logs.join("\n"),
        completedAt: new Date(),
      })
      .where(eq(growthJobRuns.id, jobRunId));

    return { jobRunId, planId, itemsGenerated: items.length, status: "COMPLETE" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failJob(msg);
  }
}

/**
 * Manually trigger growth job for today.
 */
export async function runTodayGrowthJob(): Promise<GrowthJobResult> {
  const today = new Date().toISOString().slice(0, 10);
  return runDailyGrowthJob(today);
}
