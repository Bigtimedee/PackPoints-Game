import { db } from "../db";
import { playableCards } from "@shared/schema";
import { eq, and, lt, or } from "drizzle-orm";
import { fetchCardDetailsNormalized, isCardHedgeConfigured } from "./cardhedge/client";

const BATCH_SIZE = 50;
const DELAY_BETWEEN_CARDS_MS = 2000;
const MAX_FAILURE_COUNT_FOR_REVALIDATION = 5;

export interface RefreshJobStats {
  cardsProcessed: number;
  cardsRevalidated: number;
  cardsFailed: number;
  errors: string[];
  duration: number;
}

let isJobRunning = false;

export async function getCardPoolStats(): Promise<{
  totalCards: number;
  playableCards: number;
  excludedCards: number;
  revalidatableCards: number;
  validatedCards: number;
}> {
  const result = await db.execute<{
    total_cards: string;
    playable_cards: string;
    excluded_cards: string;
    revalidatable_cards: string;
    validated_cards: string;
  }>(`
    SELECT 
      COUNT(*) as total_cards,
      COUNT(*) FILTER (WHERE is_playable = true) as playable_cards,
      COUNT(*) FILTER (WHERE is_playable = false) as excluded_cards,
      COUNT(*) FILTER (WHERE is_playable = false AND image_failure_count < ${MAX_FAILURE_COUNT_FOR_REVALIDATION}) as revalidatable_cards,
      COUNT(*) FILTER (WHERE is_playable = true AND image_failure_count < 2) as validated_cards
    FROM playable_cards
  `);

  const stats = result.rows?.[0] || {};

  return {
    totalCards: parseInt(String(stats.total_cards || "0"), 10),
    playableCards: parseInt(String(stats.playable_cards || "0"), 10),
    excludedCards: parseInt(String(stats.excluded_cards || "0"), 10),
    revalidatableCards: parseInt(String(stats.revalidatable_cards || "0"), 10),
    validatedCards: parseInt(String(stats.validated_cards || "0"), 10),
  };
}

export async function runCardPoolRefreshJob(): Promise<RefreshJobStats> {
  if (isJobRunning) {
    return {
      cardsProcessed: 0,
      cardsRevalidated: 0,
      cardsFailed: 0,
      errors: ["Job already running"],
      duration: 0,
    };
  }

  if (!isCardHedgeConfigured()) {
    return {
      cardsProcessed: 0,
      cardsRevalidated: 0,
      cardsFailed: 0,
      errors: ["Card Hedge API not configured"],
      duration: 0,
    };
  }

  isJobRunning = true;
  const startTime = Date.now();
  const stats: RefreshJobStats = {
    cardsProcessed: 0,
    cardsRevalidated: 0,
    cardsFailed: 0,
    errors: [],
    duration: 0,
  };

  try {
    console.log("[CardPoolRefresh] Starting card pool refresh job...");

    const excludedCards = await db
      .select()
      .from(playableCards)
      .where(
        and(
          eq(playableCards.isPlayable, false),
          lt(playableCards.imageFailureCount, MAX_FAILURE_COUNT_FOR_REVALIDATION)
        )
      )
      .limit(BATCH_SIZE);

    console.log(`[CardPoolRefresh] Found ${excludedCards.length} cards to revalidate`);

    for (const card of excludedCards) {
      try {
        if (!card.cardhedgeCardId) {
          stats.cardsFailed++;
          continue;
        }

        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CARDS_MS));

        const cardDetails = await fetchCardDetailsNormalized(card.cardhedgeCardId);
        stats.cardsProcessed++;

        if (cardDetails && cardDetails.imageUrl) {
          const imageValid = await testImageUrl(cardDetails.imageUrl);

          if (imageValid) {
            await db.update(playableCards)
              .set({
                imageUrl: cardDetails.imageUrl,
                isPlayable: true,
                imageFailureCount: 0,
                imageLastError: null,
                lastImageCheck: new Date(),
              })
              .where(eq(playableCards.id, card.id));

            stats.cardsRevalidated++;
            console.log(`[CardPoolRefresh] Revalidated card ${card.id} (${card.player})`);
          } else {
            await db.update(playableCards)
              .set({
                imageFailureCount: (card.imageFailureCount || 0) + 1,
                imageLastError: "Image validation failed during refresh",
                lastImageCheck: new Date(),
              })
              .where(eq(playableCards.id, card.id));
            stats.cardsFailed++;
          }
        } else {
          await db.update(playableCards)
            .set({
              imageFailureCount: (card.imageFailureCount || 0) + 1,
              imageLastError: "No image URL returned from Card Hedge",
              lastImageCheck: new Date(),
            })
            .where(eq(playableCards.id, card.id));
          stats.cardsFailed++;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        stats.errors.push(`Card ${card.id}: ${errorMsg}`);
        stats.cardsFailed++;
      }
    }

    stats.duration = Date.now() - startTime;
    console.log(`[CardPoolRefresh] Job completed in ${stats.duration}ms - Revalidated: ${stats.cardsRevalidated}, Failed: ${stats.cardsFailed}`);

    return stats;
  } finally {
    isJobRunning = false;
  }
}

const IMAGE_VALIDATION_TIMEOUT_MS = 5000;

async function testImageUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMAGE_VALIDATION_TIMEOUT_MS);
    
    const response = await fetch(url, { 
      method: "HEAD",
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) return false;

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.startsWith("image/")) return false;

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) < 1000) return false;

    return true;
  } catch {
    return false;
  }
}

export function isRefreshJobRunning(): boolean {
  return isJobRunning;
}
