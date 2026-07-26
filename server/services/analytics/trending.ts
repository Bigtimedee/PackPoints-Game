/**
 * Trending & Market Pulse (ANALYTICS_PROMPTS.md, Prompt 7).
 *
 * The real-time pulse: rising/falling players, sets, and eras by attention
 * velocity over a window vs. the prior window, plus a weekly "Market Pulse"
 * summary — the artifact a Fanatics merchandiser would want piped to them.
 * Computed over the clean layer.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

export interface Mover {
  key: string;
  label: string;
  current: number;
  previous: number;
  velocity: number;   // current − previous
  pctChange: number | null;
}

function toMovers(rows: any[], labelFn: (r: any) => string): Mover[] {
  return rows.map(r => {
    const cur = Number(r.current) || 0;
    const prev = Number(r.previous) || 0;
    return {
      key: String(r.k),
      label: labelFn(r),
      current: cur,
      previous: prev,
      velocity: cur - prev,
      pctChange: prev > 0 ? (cur - prev) / prev : null,
    };
  });
}

/** Players trending over `windowDays` vs the prior equal window. */
export async function getTrending(opts: { windowDays?: number; clean?: boolean } = {}): Promise<{
  playersUp: Mover[]; playersDown: Mover[];
  setsUp: Mover[];
  eras: Mover[];
  windowDays: number;
}> {
  const windowDays = Math.min(opts.windowDays ?? 7, 90);
  const clean = opts.clean ?? true;

  const players = (await db.execute(sql`
    SELECT player_key AS k,
      SUM(plays) FILTER (WHERE day > CURRENT_DATE - ${windowDays}::int)::int AS current,
      SUM(plays) FILTER (WHERE day <= CURRENT_DATE - ${windowDays}::int AND day > CURRENT_DATE - ${2 * windowDays}::int)::int AS previous
    FROM card_attention_daily
    WHERE is_clean = ${clean} AND day > CURRENT_DATE - ${2 * windowDays}::int
    GROUP BY player_key
  `)).rows as any[];
  const playerMovers = toMovers(players, r => String(r.k).split(":").slice(1).join(":"))
    .filter(m => m.current > 0 || m.previous > 0);
  const playersUp = [...playerMovers].sort((a, b) => b.velocity - a.velocity).filter(m => m.velocity > 0).slice(0, 10);
  const playersDown = [...playerMovers].sort((a, b) => a.velocity - b.velocity).filter(m => m.velocity < 0).slice(0, 10);

  const sets = (await db.execute(sql`
    SELECT e.game_set_id AS k,
      (SELECT set_name FROM game_sets WHERE id = e.game_set_id) AS label,
      SUM(plays) FILTER (WHERE day > CURRENT_DATE - ${windowDays}::int)::int AS current,
      SUM(plays) FILTER (WHERE day <= CURRENT_DATE - ${windowDays}::int AND day > CURRENT_DATE - ${2 * windowDays}::int)::int AS previous
    FROM set_engagement_daily e
    WHERE e.is_clean = ${clean} AND day > CURRENT_DATE - ${2 * windowDays}::int
    GROUP BY e.game_set_id
  `)).rows as any[];
  const setsUp = toMovers(sets, r => r.label || String(r.k).slice(0, 8))
    .sort((a, b) => b.velocity - a.velocity).filter(m => m.velocity > 0).slice(0, 10);

  // Era trend via price-history year buckets crossed with attention isn't
  // available yet (attention has no year dim in the mart); use set years as a
  // proxy grouping through game_sets.
  const eras = (await db.execute(sql`
    SELECT (CASE
        WHEN gs.year < 1980 THEN 'Pre-1980'
        WHEN gs.year < 2000 THEN '1980-1999'
        WHEN gs.year < 2020 THEN '2000-2019'
        ELSE '2020+' END) AS k,
      SUM(e.plays) FILTER (WHERE e.day > CURRENT_DATE - ${windowDays}::int)::int AS current,
      SUM(e.plays) FILTER (WHERE e.day <= CURRENT_DATE - ${windowDays}::int AND e.day > CURRENT_DATE - ${2 * windowDays}::int)::int AS previous
    FROM set_engagement_daily e JOIN game_sets gs ON gs.id = e.game_set_id
    WHERE e.is_clean = ${clean} AND e.day > CURRENT_DATE - ${2 * windowDays}::int
    GROUP BY 1
  `)).rows as any[];
  const eraMovers = toMovers(eras, r => String(r.k)).sort((a, b) => b.velocity - a.velocity);

  return { playersUp, playersDown, setsUp, eras: eraMovers, windowDays };
}
