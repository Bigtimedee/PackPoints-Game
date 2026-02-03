import { db } from "../db";
import { playableCards } from "@shared/schema";
import { eq, and, lt, or } from "drizzle-orm";
import { fetchCardDetailsNormalized, isCardHedgeConfigured } from "./cardhedge/client";
import { isPlaceholderUrl, MIN_VALID_IMAGE_SIZE } from "./imageValidation";
import {
  isKillSwitchEnabled,
  writeAuditLog,
  isTransientError,
  determineQuarantineStatus,
  MIN_FAILURES_FOR_PROPOSAL,
  MIN_HOURS_FOR_PROPOSAL,
} from "./mutationGuard";

const BATCH_SIZE = 50;
const DELAY_BETWEEN_CARDS_MS = 2000;
const MAX_FAILURE_COUNT_FOR_REVALIDATION = 5;

export interface RefreshJobStats {
  cardsProcessed: number;
  cardsRevalidated: number;
  cardsFailed: number;
  cardsQuarantined: number;
  skippedKillSwitch: boolean;
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
  quarantinedCards: number;
  proposedUnplayable: number;
}> {
  const result = await db.execute<{
    total_cards: string;
    playable_cards: string;
    excluded_cards: string;
    revalidatable_cards: string;
    validated_cards: string;
    quarantined_cards: string;
    proposed_unplayable: string;
  }>(`
    SELECT 
      COUNT(*) as total_cards,
      COUNT(*) FILTER (WHERE is_playable = true) as playable_cards,
      COUNT(*) FILTER (WHERE is_playable = false) as excluded_cards,
      COUNT(*) FILTER (WHERE is_playable = false AND image_failure_count < ${MAX_FAILURE_COUNT_FOR_REVALIDATION}) as revalidatable_cards,
      COUNT(*) FILTER (WHERE is_playable = true AND image_failure_count < 2) as validated_cards,
      COUNT(*) FILTER (WHERE quarantine_status != 'OK') as quarantined_cards,
      COUNT(*) FILTER (WHERE proposed_unplayable = true) as proposed_unplayable
    FROM playable_cards
  `);

  const stats = result.rows?.[0] || {};

  return {
    totalCards: parseInt(String(stats.total_cards || "0"), 10),
    playableCards: parseInt(String(stats.playable_cards || "0"), 10),
    excludedCards: parseInt(String(stats.excluded_cards || "0"), 10),
    revalidatableCards: parseInt(String(stats.revalidatable_cards || "0"), 10),
    validatedCards: parseInt(String(stats.validated_cards || "0"), 10),
    quarantinedCards: parseInt(String(stats.quarantined_cards || "0"), 10),
    proposedUnplayable: parseInt(String(stats.proposed_unplayable || "0"), 10),
  };
}

export async function runCardPoolRefreshJob(): Promise<RefreshJobStats> {
  if (isJobRunning) {
    return {
      cardsProcessed: 0,
      cardsRevalidated: 0,
      cardsFailed: 0,
      cardsQuarantined: 0,
      skippedKillSwitch: false,
      errors: ["Job already running"],
      duration: 0,
    };
  }

  if (isKillSwitchEnabled()) {
    console.log("[CardPoolRefresh] KILL SWITCH enabled, skipping refresh job");
    await writeAuditLog({
      actionType: "REFRESH_SKIPPED_KILL_SWITCH",
      operationSource: "SYSTEM_NON_DESTRUCTIVE",
      reason: "Kill switch DISABLE_AUTOMATED_SET_MUTATIONS is enabled",
    });
    return {
      cardsProcessed: 0,
      cardsRevalidated: 0,
      cardsFailed: 0,
      cardsQuarantined: 0,
      skippedKillSwitch: true,
      errors: ["Kill switch enabled"],
      duration: 0,
    };
  }

  if (!isCardHedgeConfigured()) {
    return {
      cardsProcessed: 0,
      cardsRevalidated: 0,
      cardsFailed: 0,
      cardsQuarantined: 0,
      skippedKillSwitch: false,
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
    cardsQuarantined: 0,
    skippedKillSwitch: false,
    errors: [],
    duration: 0,
  };

  try {
    console.log("[CardPoolRefresh] Starting card pool refresh job (SAFE MODE - no isPlayable changes)...");

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

    console.log(`[CardPoolRefresh] Found ${excludedCards.length} cards to attempt revalidation`);

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
          const imageResult = await testImageUrl(cardDetails.imageUrl);

          if (imageResult.valid) {
            await db.update(playableCards)
              .set({
                imageUrl: cardDetails.imageUrl,
                isPlayable: true,
                imageFailureCount: 0,
                imageLastError: null,
                lastImageCheck: new Date(),
                validationFailCount: 0,
                quarantineStatus: "OK",
                proposedUnplayable: false,
                lastValidationReason: null,
                lastValidationHttpStatus: null,
                lastValidationCheckedAt: new Date(),
                firstValidationFailAt: null,
              })
              .where(eq(playableCards.id, card.id));

            stats.cardsRevalidated++;
            console.log(`[CardPoolRefresh] Revalidated card ${card.id} (${card.player}) - now PLAYABLE`);
          } else {
            const hasTransient = isTransientError(imageResult.statusCode || null, imageResult.error || null);
            const newFailCount = (card.validationFailCount || 0) + 1;
            const firstFailAt = card.firstValidationFailAt || new Date();
            const hoursSinceFirstFail = (Date.now() - firstFailAt.getTime()) / (1000 * 60 * 60);
            const meetsProposalCriteria = newFailCount >= MIN_FAILURES_FOR_PROPOSAL && 
                                          !hasTransient && 
                                          hoursSinceFirstFail >= MIN_HOURS_FOR_PROPOSAL;
            
            const newQuarantineStatus = determineQuarantineStatus(newFailCount, hasTransient, meetsProposalCriteria);
            
            await db.update(playableCards)
              .set({
                imageFailureCount: (card.imageFailureCount || 0) + 1,
                imageLastError: imageResult.error,
                lastImageCheck: new Date(),
                validationFailCount: newFailCount,
                lastValidationReason: imageResult.error,
                lastValidationHttpStatus: imageResult.statusCode || null,
                lastValidationContentType: imageResult.contentType || null,
                lastValidationCheckedAt: new Date(),
                quarantineStatus: newQuarantineStatus,
                proposedUnplayable: meetsProposalCriteria,
                firstValidationFailAt: firstFailAt,
              })
              .where(eq(playableCards.id, card.id));
            
            if (newQuarantineStatus !== "OK") {
              stats.cardsQuarantined++;
            }
            stats.cardsFailed++;
            console.log(`[CardPoolRefresh] Card ${card.id} still failing: ${imageResult.error} (quarantine: ${newQuarantineStatus})`);
          }
        } else {
          const newFailCount = (card.validationFailCount || 0) + 1;
          const firstFailAt = card.firstValidationFailAt || new Date();
          const hoursSinceFirstFail = (Date.now() - firstFailAt.getTime()) / (1000 * 60 * 60);
          const cardHedge404 = !cardDetails;
          const meetsProposalCriteria = newFailCount >= MIN_FAILURES_FOR_PROPOSAL && 
                                        hoursSinceFirstFail >= MIN_HOURS_FOR_PROPOSAL &&
                                        cardHedge404;
          
          await db.update(playableCards)
            .set({
              imageFailureCount: (card.imageFailureCount || 0) + 1,
              imageLastError: "No image URL returned from Card Hedge",
              lastImageCheck: new Date(),
              validationFailCount: newFailCount,
              lastValidationReason: cardHedge404 ? "CardHedge returned 404/not found" : "No image URL in CardHedge response",
              lastValidationHttpStatus: cardHedge404 ? 404 : null,
              lastValidationCheckedAt: new Date(),
              quarantineStatus: meetsProposalCriteria ? "QUARANTINED_ADMIN_REVIEW" : "SUSPECT_PERSISTENT",
              proposedUnplayable: meetsProposalCriteria,
              firstValidationFailAt: firstFailAt,
            })
            .where(eq(playableCards.id, card.id));
          
          stats.cardsQuarantined++;
          stats.cardsFailed++;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        stats.errors.push(`Card ${card.id}: ${errorMsg}`);
        stats.cardsFailed++;
      }
    }

    stats.duration = Date.now() - startTime;
    console.log(`[CardPoolRefresh] Job completed in ${stats.duration}ms - Revalidated: ${stats.cardsRevalidated}, Failed: ${stats.cardsFailed}, Quarantined: ${stats.cardsQuarantined} (NO cards marked unplayable automatically)`);

    await writeAuditLog({
      actionType: "CARD_POOL_REFRESH",
      operationSource: "SYSTEM_NON_DESTRUCTIVE",
      reason: `Processed ${stats.cardsProcessed} cards: ${stats.cardsRevalidated} revalidated, ${stats.cardsQuarantined} quarantined`,
      evidenceJson: { stats },
    });

    return stats;
  } finally {
    isJobRunning = false;
  }
}

const IMAGE_VALIDATION_TIMEOUT_MS = 5000;

interface TestImageResult {
  valid: boolean;
  isPlaceholder?: boolean;
  error?: string;
  statusCode?: number;
  contentType?: string;
}

async function testImageUrl(url: string): Promise<TestImageResult> {
  if (isPlaceholderUrl(url)) {
    return { valid: false, isPlaceholder: true, error: "Placeholder URL pattern detected" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMAGE_VALIDATION_TIMEOUT_MS);
    
    const response = await fetch(url, { 
      method: "HEAD",
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    const contentType = response.headers.get("content-type") || undefined;
    
    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}`, statusCode: response.status, contentType };
    }

    if (!contentType || !contentType.startsWith("image/")) {
      return { valid: false, error: "Invalid content type", contentType };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size < MIN_VALID_IMAGE_SIZE) {
        return { valid: false, isPlaceholder: true, error: `Image too small (${size} bytes)`, contentType };
      }
    }

    return { valid: true, contentType };
  } catch {
    return { valid: false, error: "Network error" };
  }
}

export function isRefreshJobRunning(): boolean {
  return isJobRunning;
}
