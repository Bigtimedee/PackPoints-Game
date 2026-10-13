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

/**
 * game_sessions.started_at is stored as TEXT (ISO strings from storage.ts).
 * Comparing it to a timestamptz directly fails ("character varying >
 * timestamp with time zone"), so cast only values shaped like an ISO
 * timestamp; empty or malformed text is skipped instead of crashing the scan.
 */
export const ISO_TS_PATTERN = "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])[T ]([01][0-9]|2[0-3]):[0-5][0-9]";
export function activeUsersQuery(limit: number) {
  return sql`
      SELECT DISTINCT user_id FROM game_sessions
      WHERE user_id IS NOT NULL
        AND started_at ~ ${ISO_TS_PATTERN}
        AND (CASE WHEN started_at ~ ${ISO_TS_PATTERN} THEN started_at::timestamptz END) > NOW() - INTERVAL '24 hours'
      LIMIT ${limit}
    `;
}

export async function scanActiveUsers(): Promise<void> {
  try {
    // Users who submitted an answer in the last 24h — the population that could
    // be farming. Bounded so one scan can't run unbounded.
    const rows = await db.execute(activeUsersQuery(MAX_USERS_PER_SCAN));
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
