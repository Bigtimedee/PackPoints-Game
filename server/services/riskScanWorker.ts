/**
 * Risk Scan Worker — periodically runs the anti-collusion / anti-bot pattern
 * detector over recently-active users and auto-freezes those over threshold.
 *
 * Before this (July 2026) riskEngine.runPeriodicScan existed but was never
 * scheduled, so gameplay-behavior farming (repeat-pairing collusion, sub-500ms
 * bot answers, >480 matches/24h) never triggered an auto-freeze. That matters
 * more now that redemptions can grant meaningful (non-trivial) credit.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { riskEngine } from "./riskEngine";

const SCAN_INTERVAL_MS = 60 * 60 * 1000; // hourly
const MAX_USERS_PER_SCAN = 500;

async function scanActiveUsers(): Promise<void> {
  try {
    // Users who submitted an answer in the last 24h — the population that could
    // be farming. Bounded so one scan can't run unbounded.
    const rows = await db.execute(sql`
      SELECT DISTINCT user_id FROM game_sessions
      WHERE user_id IS NOT NULL
        AND started_at > NOW() - INTERVAL '24 hours'
      LIMIT ${MAX_USERS_PER_SCAN}
    `);
    const userIds = (rows.rows as any[]).map(r => r.user_id).filter(Boolean);
    if (userIds.length === 0) return;
    const results = await riskEngine.runPeriodicScan(userIds);
    const frozen = Array.from(results.values()).filter(a => (a as any).shouldFreeze).length;
    console.log(`[RiskScan] scanned ${userIds.length} active users, ${frozen} auto-frozen`);
  } catch (err) {
    console.error("[RiskScan] scan failed:", err);
  }
}

export function startRiskScanWorker(): void {
  const timer = setInterval(() => void scanActiveUsers(), SCAN_INTERVAL_MS);
  timer.unref();
  console.log("[RiskScan] worker started (hourly)");
}
