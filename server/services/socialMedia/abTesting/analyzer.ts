import { db } from "../../../db";
import { abTests, postAnalytics, socialPosts } from "@shared/schema";
import { eq, and, lt, sql } from "drizzle-orm";
import { agentConfig } from "../config";
import { createLogger } from "../logger";

const logger = createLogger("ABTestAnalyzer");

export async function analyzeReadyTests(): Promise<void> {
  const { minImpressions, minDurationHours, significanceThreshold } = agentConfig.abTest;
  const cutoff = new Date(Date.now() - minDurationHours * 60 * 60 * 1000);

  const runningTests = await db
    .select()
    .from(abTests)
    .where(
      and(
        eq(abTests.status, "RUNNING"),
        lt(abTests.startedAt, cutoff),
      ),
    );

  for (const test of runningTests) {
    try {
      await evaluateTest(test.id, minImpressions, significanceThreshold);
    } catch (err) {
      logger.error("test_evaluation_failed", { testId: test.id, error: String(err) });
    }
  }
}

async function evaluateTest(
  testId: string,
  minImpressions: number,
  significanceThreshold: number,
): Promise<void> {
  // Get analytics grouped by ab_group
  const rows = await db.execute(sql`
    SELECT
      sp.ab_group,
      COUNT(pa.id) as sample_size,
      SUM(pa.impressions) as total_impressions,
      SUM(pa.clicks) as total_clicks,
      SUM(pa.new_signups_attributed) as total_signups
    FROM social_posts sp
    LEFT JOIN post_analytics pa ON pa.post_id = sp.id
    WHERE sp.ab_test_id = ${testId}
      AND sp.status = 'PUBLISHED'
    GROUP BY sp.ab_group
  `);

  const groupStats: Record<string, {
    impressions: number;
    clicks: number;
    signups: number;
    conversionRate: number;
  }> = {};

  for (const row of rows.rows as any[]) {
    const group = String(row.ab_group ?? "");
    if (!group) continue;
    const impressions = parseInt(String(row.total_impressions ?? "0")) || 0;
    const clicks = parseInt(String(row.total_clicks ?? "0")) || 0;
    const signups = parseInt(String(row.total_signups ?? "0")) || 0;
    const conversionRate = clicks > 0 ? signups / clicks : 0;
    groupStats[group] = { impressions, clicks, signups, conversionRate };
  }

  const groupA = groupStats["A"];
  const groupB = groupStats["B"];

  // Check if we have enough data
  if (!groupA || !groupB) {
    logger.info("insufficient_variants", { testId });
    return;
  }

  if (groupA.impressions < minImpressions || groupB.impressions < minImpressions) {
    logger.info("insufficient_impressions", {
      testId,
      impressionsA: groupA.impressions,
      impressionsB: groupB.impressions,
      required: minImpressions,
    });
    return;
  }

  const rateA = groupA.conversionRate;
  const rateB = groupB.conversionRate;
  const minRate = Math.min(rateA, rateB);
  const diff = Math.abs(rateA - rateB);
  const relDiff = minRate > 0 ? diff / minRate : 0;

  // Check if test has exceeded 7 days — mark inconclusive
  const test = await db.select().from(abTests).where(eq(abTests.id, testId)).limit(1);
  if (test.length === 0) return;

  const testAge = Date.now() - (test[0].startedAt?.getTime() ?? 0);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  if (relDiff >= significanceThreshold) {
    const winner: "A" | "B" = rateA >= rateB ? "A" : "B";
    await db.update(abTests).set({
      status: "CONCLUDED",
      winner,
      winningMetric: "conversion_rate",
      endedAt: new Date(),
    }).where(eq(abTests.id, testId));
    logger.info("test_concluded", { testId, winner, rateA, rateB, relDiff });
  } else if (testAge > sevenDaysMs) {
    await db.update(abTests).set({
      status: "INCONCLUSIVE",
      endedAt: new Date(),
    }).where(eq(abTests.id, testId));
    logger.warn("test_inconclusive", { testId, rateA, rateB });
  }
}
