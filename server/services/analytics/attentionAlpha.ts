/**
 * Attention Alpha (ANALYTICS_PROMPTS.md, Prompt 6) — the crown jewel.
 *
 * Correlates the gameplay Attention time-series (card_attention_daily) with the
 * market-price time-series (card_price_history) per player, at multiple lags,
 * to answer the question that reframes PackPTS from "game" to "card-market
 * intelligence": DOES ATTENTION LEAD PRICE?
 *
 * Because longitudinal depth accrues over months, every result is returned with
 * honest sample metadata and a caveat when the history is too thin to be
 * credible — the analysis strengthens automatically as the price/attention
 * series lengthen.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

const MAX_LAG_DAYS = 14;
const MIN_PAIRED_DAYS = 10;   // per-player minimum overlapping days for a correlation
const MIN_PLAYERS = 3;        // aggregate credibility floor

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

interface Series { day: string; value: number; }

/** Cross-correlation of attention(t) vs price(t+lag) for lag 0..MAX_LAG. */
function leadLag(attn: Series[], price: Series[]): { lag: number; corr: number }[] {
  const priceByDay = new Map(price.map(p => [p.day, p.value]));
  const out: { lag: number; corr: number }[] = [];
  for (let lag = 0; lag <= MAX_LAG_DAYS; lag++) {
    const xs: number[] = [], ys: number[] = [];
    for (const a of attn) {
      const future = new Date(a.day); future.setUTCDate(future.getUTCDate() + lag);
      const key = future.toISOString().slice(0, 10);
      const pv = priceByDay.get(key);
      if (pv != null) { xs.push(a.value); ys.push(pv); }
    }
    if (xs.length >= MIN_PAIRED_DAYS) {
      const c = pearson(xs, ys);
      if (c != null) out.push({ lag, corr: c });
    }
  }
  return out;
}

export async function getAttentionAlpha(opts: { clean?: boolean } = {}): Promise<{
  players: number;
  aggregateByLag: { lag: number; avgCorr: number; n: number }[];
  bestLag: { lag: number; avgCorr: number } | null;
  watchlist: { playerKey: string; attentionVelocity: number; priceChangePct: number | null }[];
  caveat: string | null;
}> {
  const clean = opts.clean ?? true;

  // Players with both attention and price history.
  const players = (await db.execute(sql`
    SELECT DISTINCT a.player_key FROM card_attention_daily a
    JOIN card_price_history p ON p.player_key = a.player_key
    WHERE a.is_clean = ${clean}
  `)).rows as any[];

  const perLagAcc = new Map<number, number[]>();
  for (const row of players) {
    const pk = row.player_key;
    const attn = ((await db.execute(sql`
      SELECT to_char(day,'YYYY-MM-DD') AS day, plays AS value
      FROM card_attention_daily WHERE player_key = ${pk} AND is_clean = ${clean} ORDER BY day
    `)).rows as any[]).map(r => ({ day: r.day, value: Number(r.value) || 0 }));
    const price = ((await db.execute(sql`
      SELECT to_char(captured_on,'YYYY-MM-DD') AS day, raw_price_cents AS value
      FROM card_price_history WHERE player_key = ${pk} AND raw_price_cents IS NOT NULL ORDER BY captured_on
    `)).rows as any[]).map(r => ({ day: r.day, value: Number(r.value) || 0 }));
    for (const { lag, corr } of leadLag(attn, price)) {
      if (!perLagAcc.has(lag)) perLagAcc.set(lag, []);
      perLagAcc.get(lag)!.push(corr);
    }
  }

  const aggregateByLag = Array.from(perLagAcc.entries())
    .map(([lag, cs]) => ({ lag, avgCorr: cs.reduce((a, b) => a + b, 0) / cs.length, n: cs.length }))
    .sort((a, b) => a.lag - b.lag);

  // Best POSITIVE lag (attention leading price) by avg correlation.
  const leading = aggregateByLag.filter(x => x.lag > 0);
  const bestLag = leading.length ? leading.reduce((m, x) => (x.avgCorr > m.avgCorr ? x : m)) : null;

  // Watchlist: high recent attention velocity, price not yet moved.
  const watch = (await db.execute(sql`
    WITH att AS (
      SELECT player_key,
        SUM(plays) FILTER (WHERE day > CURRENT_DATE - 7)::float AS s7,
        SUM(plays) FILTER (WHERE day <= CURRENT_DATE - 7 AND day > CURRENT_DATE - 14)::float AS s_prev
      FROM card_attention_daily WHERE is_clean = ${clean} AND day > CURRENT_DATE - 14
      GROUP BY player_key
    )
    SELECT player_key, (COALESCE(s7,0) - COALESCE(s_prev,0)) AS velocity
    FROM att WHERE (COALESCE(s7,0) - COALESCE(s_prev,0)) > 0
    ORDER BY velocity DESC LIMIT 10
  `)).rows as any[];

  const watchlist = watch.map(w => ({
    playerKey: w.player_key,
    attentionVelocity: Number(w.velocity) || 0,
    priceChangePct: null as number | null, // populated once price history spans the window
  }));

  const caveat = players.length < MIN_PLAYERS || aggregateByLag.every(x => x.n < MIN_PLAYERS)
    ? "Sample depth is still thin — attention/price history is accumulating. Correlations become credible as the daily series lengthen (target: 60+ paired days across 20+ players)."
    : null;

  return { players: players.length, aggregateByLag, bestLag, watchlist, caveat };
}
