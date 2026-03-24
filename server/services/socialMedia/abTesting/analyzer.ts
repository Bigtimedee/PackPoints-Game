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

  const presentGroups = Object.keys(groupStats);

  // Check if we have enough data (need at least 2 groups)
  if (presentGroups.length < 2) {
    logger.info("insufficient_variants", { testId, groups: presentGroups });
    return;
  }

  // Check if all groups have enough impressions
  const underImpressed = presentGroups.filter(g => groupStats[g].impressions < minImpressions);
  if (underImpressed.length > 0) {
    logger.info("insufficient_impressions", {
      testId,
      groups: Object.fromEntries(presentGroups.map(g => [g, groupStats[g].impressions])),
      required: minImpressions,
    });
    return;
  }

  // Find the best-performing group by conversion rate
  let bestGroup = presentGroups[0];
  let bestRate = groupStats[bestGroup].conversionRate;
  for (const group of presentGroups.slice(1)) {
    if (groupStats[group].conversionRate > bestRate) {
      bestRate = groupStats[group].conversionRate;
      bestGroup = group;
    }
  }

  // Find the second-best rate for significance comparison
  const otherRates = presentGroups
    .filter(g => g !== bestGroup)
    .map(g => groupStats[g].conversionRate);
  const secondBestRate = Math.max(...otherRates);

  const minRate = Math.min(bestRate, secondBestRate);
  const diff = Math.abs(bestRate - secondBestRate);
  const relDiff = minRate > 0 ? diff / minRate : 0;

  // Check if test has exceeded 7 days — mark inconclusive
  const test = await db.select().from(abTests).where(eq(abTests.id, testId)).limit(1);
  if (test.length === 0) return;

  const testAge = Date.now() - (test[0].startedAt?.getTime() ?? 0);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  if (relDiff >= significanceThreshold) {
    const winner = bestGroup;
    await db.update(abTests).set({
      status: "CONCLUDED",
      winner,
      winningMetric: "conversion_rate",
      endedAt: new Date(),
    }).where(eq(abTests.id, testId));
    logger.info("test_concluded", { testId, winner, groups: groupStats, relDiff });
  } else if (testAge > sevenDaysMs) {
    await db.update(abTests).set({
      status: "INCONCLUSIVE",
      endedAt: new Date(),
    }).where(eq(abTests.id, testId));
    logger.warn("test_inconclusive", { testId, groups: groupStats });
  }
}
