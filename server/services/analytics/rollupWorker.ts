/**
 * Dimensional Rollup Marts (ANALYTICS_PROMPTS.md, Prompt 2).
 *
 * Aggregates the raw analytics_events spine into query-optimized daily marts so
 * dashboards never scan raw events and the indices are reproducible. Each day is
 * FULLY recomputed on each run (delete + re-insert per day), so the job is
 * perfectly idempotent and backfillable — distinct-user counts stay correct.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

const ROLLUP_INTERVAL_MS = 60 * 60 * 1000; // hourly (finalizes today; yesterday settles overnight)

/** Recompute all marts for a single UTC day (YYYY-MM-DD). Idempotent. */
export async function rollupDay(day: string): Promise<void> {
  // card_attention_daily — per player per day, clean/raw
  await db.execute(sql`DELETE FROM card_attention_daily WHERE day = ${day}`);
  await db.execute(sql`
    INSERT INTO card_attention_daily (id, player_key, day, is_clean, plays, unique_users, correct, incorrect, sum_latency_ms, cnt_latency)
    SELECT gen_random_uuid(), player_key, ${day}::date, is_clean,
      COUNT(*)::int,
      COUNT(DISTINCT user_hash)::int,
      COUNT(*) FILTER (WHERE outcome = 'correct')::int,
      COUNT(*) FILTER (WHERE outcome = 'incorrect')::int,
      COALESCE(SUM(latency_ms), 0)::int,
      COUNT(latency_ms)::int
    FROM analytics_events
    WHERE event_type = 'answer_submitted' AND player_key IS NOT NULL
      AND occurred_at >= ${day}::date AND occurred_at < (${day}::date + INTERVAL '1 day')
    GROUP BY player_key, is_clean
  `);

  // set_engagement_daily — per set per day
  await db.execute(sql`DELETE FROM set_engagement_daily WHERE day = ${day}`);
  await db.execute(sql`
    INSERT INTO set_engagement_daily (id, game_set_id, day, is_clean, starts, plays, unique_users)
    SELECT gen_random_uuid(), game_set_id, ${day}::date, is_clean,
      COUNT(*) FILTER (WHERE event_type = 'set_started')::int,
      COUNT(*) FILTER (WHERE event_type = 'answer_submitted')::int,
      COUNT(DISTINCT user_hash)::int
    FROM analytics_events
    WHERE game_set_id IS NOT NULL
      AND event_type IN ('set_started', 'answer_submitted')
      AND occurred_at >= ${day}::date AND occurred_at < (${day}::date + INTERVAL '1 day')
    GROUP BY game_set_id, is_clean
  `);

  // commerce_funnel_daily — per set per day
  await db.execute(sql`DELETE FROM commerce_funnel_daily WHERE day = ${day}`);
  await db.execute(sql`
    INSERT INTO commerce_funnel_daily (id, game_set_id, day, is_clean, listing_clicks)
    SELECT gen_random_uuid(), game_set_id, ${day}::date, is_clean,
      COUNT(*) FILTER (WHERE event_type = 'listing_click')::int
    FROM analytics_events
    WHERE game_set_id IS NOT NULL AND event_type = 'listing_click'
      AND occurred_at >= ${day}::date AND occurred_at < (${day}::date + INTERVAL '1 day')
    GROUP BY game_set_id, is_clean
  `);
}

/** Recompute every day that has events (one-time backfill / full rebuild). */
export async function rollupBackfill(): Promise<number> {
  const days = await db.execute(sql`
    SELECT DISTINCT to_char(occurred_at, 'YYYY-MM-DD') AS day FROM analytics_events ORDER BY day
  `);
  let n = 0;
  for (const r of (days.rows as any[])) {
    await rollupDay(r.day);
    n++;
  }
  return n;
}

export function startRollupWorker(): void {
  const runToday = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      // recompute today + yesterday (late-arriving events settle)
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      await rollupDay(yesterday);
      await rollupDay(today);
    } catch (err) {
      console.error("[Rollup] run failed:", (err as any)?.message);
    }
  };
  void runToday();
  const timer = setInterval(() => void runToday(), ROLLUP_INTERVAL_MS);
  timer.unref();
  console.log("[Rollup] worker started (hourly)");
}
