/**
 * Card Price Capture (ANALYTICS_PROMPTS.md, Prompt 1 parallel action).
 *
 * Snapshots CardHedge market prices for recently-played players into a daily
 * time-series. The Attention Alpha correlation (Prompt 6) needs price HISTORY,
 * which cannot be backfilled — so this must start capturing NOW even though the
 * analysis that consumes it is months away. Idempotent per (day, player, year).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { cardPriceHistory, cardDetailsCache } from "@shared/schema";

const CAPTURE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 1000;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function capturePrices(): Promise<void> {
  try {
    // Players/cards played in the last 30 days that we have cached market data
    // for. Join analytics events (or playable cards) to the CardHedge cache.
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (pc.player, pc.year)
        pc.player AS player, pc.year AS year, pc.game_set_id AS game_set_id,
        pc.cardhedge_card_id AS cardhedge_card_id, cdc.payload AS payload
      FROM playable_cards pc
      JOIN card_details_cache cdc ON cdc.card_id = pc.cardhedge_card_id
      WHERE pc.player IS NOT NULL AND pc.player <> ''
        AND cdc.expires_at > NOW() - INTERVAL '30 days'
      LIMIT ${MAX_PER_RUN}
    `);

    const day = todayUTC();
    let captured = 0;
    for (const r of (rows.rows as any[])) {
      try {
        const prices: Array<{ grade: string; price: string }> = (r.payload?.prices) || [];
        const raw = prices.find(p => /^raw$/i.test(p.grade)) || prices[0];
        const rawPriceCents = raw?.price ? Math.round(parseFloat(raw.price) * 100) : null;
        if (rawPriceCents == null) continue;
        const playerKey = `baseball:${String(r.player).trim().toLowerCase()}`;
        await db.insert(cardPriceHistory).values({
          capturedOn: day,
          playerKey,
          cardhedgeCardId: r.cardhedge_card_id || null,
          gameSetId: r.game_set_id || null,
          year: r.year || null,
          rawPriceCents,
          source: "cardhedge",
        }).onConflictDoNothing();
        captured++;
      } catch { /* skip individual row */ }
    }
    console.log(`[PriceCapture] captured ${captured} price points for ${day}`);
  } catch (err) {
    console.error("[PriceCapture] run failed:", (err as any)?.message);
  }
}

export function startPriceCaptureWorker(): void {
  void capturePrices(); // capture immediately on boot — every day counts
  const timer = setInterval(() => void capturePrices(), CAPTURE_INTERVAL_MS);
  timer.unref();
  console.log("[PriceCapture] worker started (daily)");
}
