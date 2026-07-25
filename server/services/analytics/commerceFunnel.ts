/**
 * Commerce Intent Funnel (ANALYTICS_PROMPTS.md, Prompt 5).
 *
 * Measures attention → dollars: the demand funnel from gameplay through the
 * post-answer "Find this card" surface to attributed purchases. Proves the
 * audience buys — the funnel data no competitor has.
 *
 *   correct answers → listing clicks → attributed purchases (+ revenue)
 *
 * Sourced from card_attention_daily (correct), outbound_clicks (source
 * 'set-reveal'), and attributed_purchases.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

export interface FunnelSummary {
  correct: number;
  listingClicks: number;
  purchases: number;
  revenueCents: number;
  clickThroughRate: number;   // clicks / correct
  conversionRate: number;     // purchases / clicks
}

export interface FunnelSetRow {
  gameSetId: string;
  setName: string | null;
  correct: number;
  listingClicks: number;
  clickThroughRate: number;
}

export async function getCommerceFunnel(opts: { windowDays?: number; clean?: boolean } = {}): Promise<{
  summary: FunnelSummary;
  topSets: FunnelSetRow[];
}> {
  const windowDays = Math.min(opts.windowDays ?? 30, 365);
  const clean = opts.clean ?? true;

  const [correctRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(correct), 0)::int AS correct
    FROM card_attention_daily
    WHERE is_clean = ${clean} AND day > CURRENT_DATE - ${windowDays}::int
  `)).rows as any[];

  const [clickRow] = (await db.execute(sql`
    SELECT COUNT(*)::int AS clicks
    FROM outbound_clicks
    WHERE page_path = 'set-reveal' AND created_at > NOW() - ${windowDays + " days"}::interval
  `)).rows as any[];

  const [purchRow] = (await db.execute(sql`
    SELECT COUNT(*)::int AS purchases, COALESCE(SUM(sale_price_cents), 0)::int AS revenue
    FROM attributed_purchases ap
    JOIN outbound_clicks oc ON oc.id = ap.outbound_click_id
    WHERE oc.page_path = 'set-reveal' AND ap.created_at > NOW() - ${windowDays + " days"}::interval
  `)).rows as any[];

  const correct = Number(correctRow?.correct) || 0;
  const clicks = Number(clickRow?.clicks) || 0;
  const purchases = Number(purchRow?.purchases) || 0;
  const revenueCents = Number(purchRow?.revenue) || 0;

  const topSets = (await db.execute(sql`
    SELECT c.game_set_id,
      (SELECT set_name FROM game_sets WHERE id = c.game_set_id) AS set_name,
      COALESCE(a.correct, 0)::int AS correct,
      COALESCE(SUM(c.listing_clicks), 0)::int AS listing_clicks
    FROM commerce_funnel_daily c
    LEFT JOIN LATERAL (
      SELECT SUM(correct)::int AS correct FROM card_attention_daily
      WHERE is_clean = ${clean} AND day > CURRENT_DATE - ${windowDays}::int
    ) a ON true
    WHERE c.is_clean = ${clean} AND c.day > CURRENT_DATE - ${windowDays}::int
    GROUP BY c.game_set_id, a.correct
    ORDER BY listing_clicks DESC
    LIMIT 10
  `)).rows as any[];

  return {
    summary: {
      correct, listingClicks: clicks, purchases, revenueCents,
      clickThroughRate: correct > 0 ? clicks / correct : 0,
      conversionRate: clicks > 0 ? purchases / clicks : 0,
    },
    topSets: topSets.map(r => ({
      gameSetId: r.game_set_id,
      setName: r.set_name ?? null,
      correct: Number(r.correct) || 0,
      listingClicks: Number(r.listing_clicks) || 0,
      clickThroughRate: (Number(r.correct) || 0) > 0 ? (Number(r.listing_clicks) || 0) / Number(r.correct) : 0,
    })),
  };
}
