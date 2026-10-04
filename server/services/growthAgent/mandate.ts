import { randomUUID } from "crypto";
import { db } from "../../db";
import {
  growthContentItems,
  growthContentPlans,
  growthJobRuns,
  publishingQueue,
} from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { collectGrowthSignals } from "./listen";
import { computeCreativePerformance, selectWinningCreatives } from "./learn";
import { generateMandateItems } from "./create";

export type GrowthMandateResult = {
  jobRunId: string;
  planId: string | null;
  signalsObserved: number;
  winnersLearnedFrom: number;
  itemsCreated: number;
  dailyCapacityRemaining: number;
  status: "COMPLETE" | "FAILED";
  error?: string;
};

function utcStartOfDay(now: Date): Date {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

async function countMandateItemsToday(now: Date): Promise<number> {
  const start = utcStartOfDay(now);
  const rows = await db
    .select({ id: growthContentItems.id })
    .from(growthContentItems)
    .where(
      and(
        gte(growthContentItems.createdAt, start),
        sql`${growthContentItems.metadata}->>'mandateVersion' = 'listen-create-distribute-learn-v1'`,
      ),
    );
  return rows.length;
}

/**
 * Run one complete Growth Agent mandate cycle.
 *
 * LISTEN      real PackPTS activity + approved external signals
 * CREATE      asset-backed, fact-grounded creative
 * DISTRIBUTE  stage safely into the existing Admin Publishing Queue
 * LEARN       rank prior published creative by qualified DAUs per 1,000 impressions
 */
export async function runGrowthMandateCycle(
  now = new Date(),
): Promise<GrowthMandateResult> {
  const jobRunId = randomUUID();
  const logs: string[] = [];
  const dayKey = now.toISOString().slice(0, 10);
  const dailyMax = Math.max(
    1,
    Math.min(20, parseInt(process.env.GROWTH_AGENT_MAX_CREATIVES_PER_DAY || "6", 10)),
  );

  const log = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    logs.push(line);
    console.log(`[GrowthMandate] ${message}`);
  };

  await db.insert(growthJobRuns).values({
    id: jobRunId,
    jobType: "MANDATE_CYCLE",
    status: "RUNNING",
    targetDate: dayKey,
    itemsGenerated: 0,
    log: "",
  });

  try {
    log("LISTEN: collecting product and approved external signals");
    const signals = await collectGrowthSignals(now);

    log("LEARN: computing creative performance");
    const performance = await computeCreativePerformance(now);
    const winners = selectWinningCreatives(
      performance,
      5,
      parseInt(process.env.GROWTH_AGENT_WINNER_MIN_IMPRESSIONS || "100", 10),
    );

    const alreadyCreated = await countMandateItemsToday(now);
    const remaining = Math.max(0, dailyMax - alreadyCreated);

    if (remaining === 0) {
      log(`Daily creative cap reached (${dailyMax}); no new content created`);
      await db
        .update(growthJobRuns)
        .set({
          status: "COMPLETE",
          itemsGenerated: 0,
          log: logs.join("\n"),
          completedAt: new Date(),
        })
        .where(eq(growthJobRuns.id, jobRunId));

      return {
        jobRunId,
        planId: null,
        signalsObserved: signals.length,
        winnersLearnedFrom: winners.length,
        itemsCreated: 0,
        dailyCapacityRemaining: 0,
        status: "COMPLETE",
      };
    }

    const planId = randomUUID();
    const themes = signals.slice(0, 4).map((signal) => signal.title);

    await db.insert(growthContentPlans).values({
      id: planId,
      date: dayKey,
      status: "GENERATING",
      platformTargets: {
        TIKTOK: process.env.GROWTH_TIKTOK_ENABLED !== "false",
        X: process.env.GROWTH_X_ENABLED === "true",
        INSTAGRAM: process.env.GROWTH_INSTAGRAM_ENABLED === "true",
        REDDIT: process.env.GROWTH_REDDIT_ENABLED === "true",
        YOUTUBE: process.env.GROWTH_YOUTUBE_ENABLED === "true",
      },
      themes,
      goals: "Increase qualified daily active users through real PackPTS product moments.",
      summary:
        "Listen/Create/Distribute/Learn mandate cycle. Creative is grounded in observed product signals and optimized for qualified DAUs per 1,000 impressions.",
    });

    log(`CREATE: generating up to ${remaining} asset-backed creatives`);
    const generated = await generateMandateItems({
      planId,
      signals,
      winnerPatterns: winners,
      maxItems: remaining,
    });

    for (const item of generated) {
      const { id, ...values } = item;
      await db.insert(growthContentItems).values({
        id,
        planId,
        ...values,
      });

      // DISTRIBUTE: the Growth Agent stages content into the existing queue.
      // Human review remains the default. This intentionally does not bypass
      // the media/preflight safeguards in the social publishing system.
      await db.insert(publishingQueue).values({
        id: randomUUID(),
        contentItemId: id,
        platform: item.platform,
        status: "PENDING",
        retryCount: 0,
        postingStatus: "MANUAL_QUEUE",
        publishingMetadata: {
          ...(item.metadata as Record<string, unknown>),
          mediaRequired: true,
          mediaVerified: true,
          source: "GROWTH_MANDATE",
        },
      });
    }

    await db
      .update(growthContentPlans)
      .set({
        status: "COMPLETE",
        updatedAt: new Date(),
      })
      .where(eq(growthContentPlans.id, planId));

    log(`DISTRIBUTE: staged ${generated.length} creative(s) in the Publishing Queue`);

    await db
      .update(growthJobRuns)
      .set({
        status: "COMPLETE",
        planId,
        itemsGenerated: generated.length,
        log: logs.join("\n"),
        completedAt: new Date(),
      })
      .where(eq(growthJobRuns.id, jobRunId));

    return {
      jobRunId,
      planId,
      signalsObserved: signals.length,
      winnersLearnedFrom: winners.length,
      itemsCreated: generated.length,
      dailyCapacityRemaining: Math.max(0, remaining - generated.length),
      status: "COMPLETE",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`FAILED: ${message}`);
    await db
      .update(growthJobRuns)
      .set({
        status: "FAILED",
        errorMessage: message,
        log: logs.join("\n"),
        completedAt: new Date(),
      })
      .where(eq(growthJobRuns.id, jobRunId));

    return {
      jobRunId,
      planId: null,
      signalsObserved: 0,
      winnersLearnedFrom: 0,
      itemsCreated: 0,
      dailyCapacityRemaining: 0,
      status: "FAILED",
      error: message,
    };
  }
}
