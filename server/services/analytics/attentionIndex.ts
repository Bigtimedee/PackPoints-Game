/**
 * Card Attention Index (ANALYTICS_PROMPTS.md, Prompt 3) — the signature metric.
 *
 * A normalized 0–100 demand gauge per player, computed from the
 * card_attention_daily mart with a recency-weighted signal (14-day half-life)
 * so recent attention counts more. Velocity compares the last 7 days to the
 * prior 7. Computed over the CLEAN layer by default (bot/flagged excluded).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

const HALF_LIFE_DAYS = 14;

export interface AttentionRow {
  playerKey: string;
  cai: number;            // 0–100 normalized
  signal: number;         // raw recency-weighted signal
  plays: number;
  uniqueUsers: number;
  correct: number;
  incorrect: number;
  recognitionRate: number | null; // correct / (correct+incorrect)
  velocity7: number;      // signal_last7 − signal_prev7
}

/** Leaderboard of attention over a trailing window (days). */
export async function getAttentionLeaderboard(opts: {
  windowDays?: number;
  clean?: boolean;
  limit?: number;
} = {}): Promise<AttentionRow[]> {
  const windowDays = Math.min(opts.windowDays ?? 30, 365);
  const clean = opts.clean ?? true;
  const limit = Math.min(opts.limit ?? 100, 500);

  // Recency-weighted signal per player over the window, plus 7d/prev-7d splits.
  const rows = await db.execute(sql`
    WITH base AS (
      SELECT player_key, day, plays, unique_users, correct, incorrect,
             EXTRACT(DAY FROM (CURRENT_DATE - day))::float AS age
      FROM card_attention_daily
      WHERE is_clean = ${clean}
        AND day > CURRENT_DATE - ${windowDays}::int
    )
    SELECT player_key,
      SUM(plays * POWER(0.5, age / ${HALF_LIFE_DAYS}))::float AS signal,
      SUM(plays)::int AS plays,
      SUM(unique_users)::int AS unique_users,
      SUM(correct)::int AS correct,
      SUM(incorrect)::int AS incorrect,
      SUM(plays) FILTER (WHERE age < 7)::float AS s7,
      SUM(plays) FILTER (WHERE age >= 7 AND age < 14)::float AS s_prev7
    FROM base
    GROUP BY player_key
    ORDER BY signal DESC
    LIMIT ${limit}
  `);

  const data = rows.rows as any[];
  const maxSignal = data.reduce((m, r) => Math.max(m, Number(r.signal) || 0), 0) || 1;

  return data.map(r => {
    const correct = Number(r.correct) || 0;
    const incorrect = Number(r.incorrect) || 0;
    const attempts = correct + incorrect;
    return {
      playerKey: r.player_key,
      cai: Math.round(100 * (Number(r.signal) || 0) / maxSignal),
      signal: Number(r.signal) || 0,
      plays: Number(r.plays) || 0,
      uniqueUsers: Number(r.unique_users) || 0,
      correct,
      incorrect,
      recognitionRate: attempts > 0 ? correct / attempts : null,
      velocity7: (Number(r.s7) || 0) - (Number(r.s_prev7) || 0),
    };
  });
}

/** Daily time-series for one player. */
export async function getAttentionSeries(playerKey: string, opts: { windowDays?: number; clean?: boolean } = {}) {
  const windowDays = Math.min(opts.windowDays ?? 90, 365);
  const clean = opts.clean ?? true;
  const rows = await db.execute(sql`
    SELECT day, plays, unique_users, correct, incorrect
    FROM card_attention_daily
    WHERE player_key = ${playerKey} AND is_clean = ${clean}
      AND day > CURRENT_DATE - ${windowDays}::int
    ORDER BY day ASC
  `);
  return (rows.rows as any[]).map(r => ({
    day: r.day,
    plays: Number(r.plays) || 0,
    uniqueUsers: Number(r.unique_users) || 0,
    correct: Number(r.correct) || 0,
    incorrect: Number(r.incorrect) || 0,
  }));
}
