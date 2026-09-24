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
import { cardPriceHistory } from "@shared/schema";
import { PRICE_CAPTURE_SQL, mapPriceCaptureRow } from "./priceCaptureQuery";

const CAPTURE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function capturePrices(): Promise<void> {
  try {
    // Year and sport live on game_sets. playable_cards has no year column.
    const rows = await db.execute(sql.raw(PRICE_CAPTURE_SQL));

    const day = todayUTC();
    let captured = 0;
    let failed = 0;
    let firstError = "";
    for (const r of (rows.rows as any[])) {
      try {
        const values = mapPriceCaptureRow(r, day);
        if (!values) continue;
        await db.insert(cardPriceHistory).values(values).onConflictDoNothing();
        captured++;
      } catch (err) {
        failed++;
        if (!firstError) firstError = (err as any)?.message || String(err);
      }
    }
    if (failed > 0) {
      console.error(`[PriceCapture] ${failed} rows failed: ${firstError}`);
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
