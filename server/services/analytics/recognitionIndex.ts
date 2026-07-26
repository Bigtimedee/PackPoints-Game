/**
 * Recognition Index (ANALYTICS_PROMPTS.md, Prompt 4).
 *
 * % of users who correctly identify a player — a leading indicator of an
 * athlete's cultural momentum. Uses a volume floor + Wilson score confidence
 * interval so low-sample players are not noise, and detects "recognition
 * breakouts" (rising RI velocity) — the signal Fanatics would use for rookie
 * card bets and licensing. Derived from the card_attention_daily mart.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

const MIN_ATTEMPTS = 20; // volume floor for a credible rate

/** Wilson score interval (95%) for a binomial proportion. */
function wilson(correct: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const z = 1.96;
  const p = correct / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { low: Math.max(0, (centre - margin) / denom), high: Math.min(1, (centre + margin) / denom) };
}

export interface RecognitionRow {
  playerKey: string;
  attempts: number;
  correct: number;
  recognitionRate: number;
  ciLow: number;
  ciHigh: number;
  prevRate: number | null;
  velocity: number | null; // recognitionRate − prevRate
  breakout: boolean;
}

export async function getRecognitionIndex(opts: { windowDays?: number; clean?: boolean; limit?: number } = {}): Promise<RecognitionRow[]> {
  const windowDays = Math.min(opts.windowDays ?? 30, 365);
  const clean = opts.clean ?? true;
  const limit = Math.min(opts.limit ?? 100, 500);

  // Current window vs the immediately preceding window (for velocity/breakout).
  const rows = await db.execute(sql`
    SELECT player_key,
      SUM(correct) FILTER (WHERE day > CURRENT_DATE - ${windowDays}::int)::int AS cur_correct,
      SUM(correct + incorrect) FILTER (WHERE day > CURRENT_DATE - ${windowDays}::int)::int AS cur_attempts,
      SUM(correct) FILTER (WHERE day <= CURRENT_DATE - ${windowDays}::int AND day > CURRENT_DATE - ${2 * windowDays}::int)::int AS prev_correct,
      SUM(correct + incorrect) FILTER (WHERE day <= CURRENT_DATE - ${windowDays}::int AND day > CURRENT_DATE - ${2 * windowDays}::int)::int AS prev_attempts
    FROM card_attention_daily
    WHERE is_clean = ${clean} AND day > CURRENT_DATE - ${2 * windowDays}::int
    GROUP BY player_key
    HAVING SUM(correct + incorrect) FILTER (WHERE day > CURRENT_DATE - ${windowDays}::int) >= ${MIN_ATTEMPTS}
    ORDER BY cur_attempts DESC
    LIMIT ${limit}
  `);

  return (rows.rows as any[]).map(r => {
    const attempts = Number(r.cur_attempts) || 0;
    const correct = Number(r.cur_correct) || 0;
    const rate = attempts > 0 ? correct / attempts : 0;
    const ci = wilson(correct, attempts);
    const prevAttempts = Number(r.prev_attempts) || 0;
    const prevRate = prevAttempts >= MIN_ATTEMPTS ? (Number(r.prev_correct) || 0) / prevAttempts : null;
    const velocity = prevRate != null ? rate - prevRate : null;
    // Breakout: recognition rising meaningfully (>= 10 pts) off a real prior base
    const breakout = velocity != null && velocity >= 0.10;
    return {
      playerKey: r.player_key,
      attempts, correct,
      recognitionRate: rate,
      ciLow: ci.low, ciHigh: ci.high,
      prevRate, velocity, breakout,
    };
  });
}
