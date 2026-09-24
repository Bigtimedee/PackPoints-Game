/**
 * Card Price Capture (ANALYTICS_PROMPTS.md, Prompt 1 parallel action).
 *
 * Snapshots CardHedge market prices for cards played in the last 30 days.
 * The on-demand card_details_cache is not filled by gameplay, so this worker
 * fetches missing details itself (capped, throttled) and upserts the cache.
 * Idempotent per (day, player, year).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { cardDetailsCache, cardPriceHistory } from "@shared/schema";
import { fetchCardDetailsNormalized, isCardHedgeConfigured } from "../cardhedge/client";
import {
  FALLBACK_CANDIDATES_SQL,
  PLAYED_CANDIDATES_SQL,
  RECENT_ANSWER_COUNT_SQL,
  cacheUpsertValues,
  limitedSql,
  parseCandidateRows,
  readCacheTtlSeconds,
  readPriceCaptureMaxFetch,
  runPriceCapture,
  type CacheLookupRow,
  type PriceCaptureInsert,
} from "./priceCaptureQuery";

const CAPTURE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function queryRows(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object" || !("rows" in result)) return [];
  const rows = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}

async function executeRows(query: string): Promise<Array<Record<string, unknown>>> {
  return queryRows(await db.execute(sql.raw(query)));
}

async function upsertCache(cardId: string, payload: unknown): Promise<void> {
  const now = new Date();
  const write = cacheUpsertValues(
    cardId,
    payload,
    now,
    readCacheTtlSeconds(process.env.CARDHEDGE_CACHE_TTL_SECONDS),
  );
  await db.insert(cardDetailsCache).values({
    cardId: write.values.cardId,
    rawImagesOnly: write.values.rawImagesOnly,
    payload: write.values.payload,
    expiresAt: write.values.expiresAt,
  }).onConflictDoUpdate({
    target: [cardDetailsCache.cardId, cardDetailsCache.rawImagesOnly],
    set: {
      payload: write.update.payload,
      fetchedAt: write.update.fetchedAt,
      expiresAt: write.update.expiresAt,
    },
  });
}

async function insertPrice(values: PriceCaptureInsert): Promise<boolean> {
  const inserted = await db.insert(cardPriceHistory).values(values).onConflictDoNothing().returning({
    id: cardPriceHistory.id,
  });
  return inserted.length > 0;
}

async function loadCacheRows(cardIds: string[]): Promise<CacheLookupRow[]> {
  if (cardIds.length === 0) return [];
  const rows = await db
    .select({
      cardId: cardDetailsCache.cardId,
      payload: cardDetailsCache.payload,
      fetchedAt: cardDetailsCache.fetchedAt,
    })
    .from(cardDetailsCache)
    .where(and(
      eq(cardDetailsCache.rawImagesOnly, false),
      inArray(cardDetailsCache.cardId, cardIds),
    ));
  return rows.map((row) => ({
    cardId: row.cardId,
    payload: row.payload,
    fetchedAt: row.fetchedAt,
  }));
}

export async function capturePrices(): Promise<void> {
  try {
    const maxFetch = readPriceCaptureMaxFetch(process.env.PRICE_CAPTURE_MAX_FETCH);
    await runPriceCapture({
      isConfigured: isCardHedgeConfigured,
      maxFetch,
      countRecentAnswers: async () => {
        const rows = await executeRows(RECENT_ANSWER_COUNT_SQL);
        const raw = rows[0]?.event_count;
        const n = typeof raw === "number" ? raw : Number(raw ?? 0);
        return Number.isFinite(n) ? n : 0;
      },
      loadPlayedCandidates: async (limit) => parseCandidateRows(
        await executeRows(limitedSql(PLAYED_CANDIDATES_SQL, limit)),
      ),
      loadFallbackCandidates: async (limit) => parseCandidateRows(
        await executeRows(limitedSql(FALLBACK_CANDIDATES_SQL, limit)),
      ),
      loadCacheRows,
      fetchDetails: (cardhedgeCardId) => fetchCardDetailsNormalized(cardhedgeCardId, false),
      upsertCache,
      insertPrice,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PriceCapture] run failed:", message);
  }
}

export function startPriceCaptureWorker(): void {
  void capturePrices();
  const timer = setInterval(() => void capturePrices(), CAPTURE_INTERVAL_MS);
  timer.unref();
  console.log("[PriceCapture] worker started (daily)");
}
