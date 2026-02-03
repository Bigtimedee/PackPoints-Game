import { db } from "../db";
import { playableCards, baseballCards } from "@shared/schema";
import { eq, lt, isNull, or, and, sql } from "drizzle-orm";
import {
  assertMutationAllowed,
  writeAuditLog,
  logMutationBlocked,
  isKillSwitchEnabled,
  isTransientError,
  determineQuarantineStatus,
  MIN_FAILURES_FOR_PROPOSAL,
  MIN_HOURS_FOR_PROPOSAL,
  type OperationSource,
} from "./mutationGuard";

const VALIDATION_TIMEOUT_MS = 8000;
const MAX_FAILURE_COUNT = 2;
const VALIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1000;
const MIN_VALID_IMAGE_SIZE = 5000;

const PLACEHOLDER_URL_PATTERNS = [
  /placeholder/i,
  /no[-_]?image/i,
  /default[-_]?image/i,
  /missing[-_]?image/i,
  /silhouette/i,
  /generic[-_]?card/i,
  /coming[-_]?soon/i,
  /not[-_]?available/i,
  /fallback/i,
  /blank[-_]?card/i,
  /card[-_]?placeholder/i,
  /unavailable/i,
];

const PLACEHOLDER_DIMENSIONS = new Set([
  "300x400",
  "200x300",
  "150x200",
  "100x150",
]);

function isPlaceholderUrl(url: string): boolean {
  const urlLower = url.toLowerCase();
  for (const pattern of PLACEHOLDER_URL_PATTERNS) {
    if (pattern.test(urlLower)) {
      return true;
    }
  }
  return false;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
  isPlaceholder?: boolean;
  contentType?: string;
}

async function validateImageUrl(url: string): Promise<ValidationResult> {
  if (!url) {
    return { valid: false, error: "No URL provided" };
  }

  if (isPlaceholderUrl(url)) {
    return { 
      valid: false, 
      error: "Detected placeholder image URL pattern",
      isPlaceholder: true
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "PackPoints-ImageValidator/1.0"
      }
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get("content-type") || undefined;

    if (!response.ok) {
      return { 
        valid: false, 
        error: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status,
        contentType
      };
    }

    if (!contentType || !contentType.startsWith("image/")) {
      return { 
        valid: false, 
        error: `Invalid content type: ${contentType || "unknown"}`,
        contentType
      };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size < MIN_VALID_IMAGE_SIZE) {
        return {
          valid: false,
          error: `Image too small (${size} bytes) - likely placeholder`,
          isPlaceholder: true,
          contentType
        };
      }
    }

    return { valid: true, contentType };
  } catch (error: any) {
    if (error.name === "AbortError") {
      return { valid: false, error: "Request timeout" };
    }
    return { valid: false, error: error.message || "Network error" };
  }
}

export { isPlaceholderUrl, MIN_VALID_IMAGE_SIZE };

export interface ValidationStats {
  totalChecked: number;
  valid: number;
  invalid: number;
  newlyExcluded: number;
  newlyQuarantined: number;
  proposedUnplayable: number;
  skippedKillSwitch: number;
  errors: Array<{ cardId: string; player: string | null; error: string }>;
}

export async function validatePlayableCardImages(
  gameSetId?: string,
  forceRecheck: boolean = false,
  operationSource: OperationSource = "SYSTEM_NON_DESTRUCTIVE"
): Promise<ValidationStats> {
  const stats: ValidationStats = {
    totalChecked: 0,
    valid: 0,
    invalid: 0,
    newlyExcluded: 0,
    newlyQuarantined: 0,
    proposedUnplayable: 0,
    skippedKillSwitch: 0,
    errors: []
  };

  if (isKillSwitchEnabled() && operationSource !== "ADMIN_MANUAL") {
    console.log("[ImageValidation] KILL SWITCH enabled, skipping validation");
    await writeAuditLog({
      setId: gameSetId,
      actionType: "VALIDATE_SKIPPED_KILL_SWITCH",
      operationSource,
      reason: "Kill switch DISABLE_AUTOMATED_SET_MUTATIONS is enabled",
    });
    return stats;
  }

  const staleThreshold = new Date(Date.now() - VALIDATION_INTERVAL_MS);

  let cardsToCheck;
  if (forceRecheck) {
    const conditions = [eq(playableCards.isPlayable, true)];
    if (gameSetId) {
      conditions.push(eq(playableCards.gameSetId, gameSetId));
    }
    cardsToCheck = await db.select({
      id: playableCards.id,
      imageUrl: playableCards.imageUrl,
      player: playableCards.player,
      imageFailureCount: playableCards.imageFailureCount,
      validationFailCount: playableCards.validationFailCount,
      quarantineStatus: playableCards.quarantineStatus,
      firstValidationFailAt: playableCards.firstValidationFailAt,
    })
    .from(playableCards)
    .where(and(...conditions));
  } else {
    const conditions = [
      eq(playableCards.isPlayable, true),
      or(
        isNull(playableCards.lastImageCheck),
        lt(playableCards.lastImageCheck, staleThreshold)
      )
    ];
    if (gameSetId) {
      conditions.push(eq(playableCards.gameSetId, gameSetId));
    }
    cardsToCheck = await db.select({
      id: playableCards.id,
      imageUrl: playableCards.imageUrl,
      player: playableCards.player,
      imageFailureCount: playableCards.imageFailureCount,
      validationFailCount: playableCards.validationFailCount,
      quarantineStatus: playableCards.quarantineStatus,
      firstValidationFailAt: playableCards.firstValidationFailAt,
    })
    .from(playableCards)
    .where(and(...conditions));
  }

  console.log(`[ImageValidation] Checking ${cardsToCheck.length} playable cards (source: ${operationSource})`);

  for (let i = 0; i < cardsToCheck.length; i += BATCH_SIZE) {
    const batch = cardsToCheck.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (card) => {
      stats.totalChecked++;
      
      if (!card.imageUrl) {
        stats.invalid++;
        const newFailCount = (card.validationFailCount || 0) + 1;
        const hasTransient = false;
        const meetsProposalCriteria = checkProposalCriteria(newFailCount, card.firstValidationFailAt, hasTransient);
        
        await updateQuarantineFields(card.id, {
          validationFailCount: newFailCount,
          lastValidationReason: "No image URL",
          lastValidationHttpStatus: null,
          lastValidationContentType: null,
          quarantineStatus: determineQuarantineStatus(newFailCount, hasTransient, meetsProposalCriteria),
          proposedUnplayable: meetsProposalCriteria,
          firstValidationFailAt: card.firstValidationFailAt || new Date(),
        });
        
        if (meetsProposalCriteria) stats.proposedUnplayable++;
        stats.newlyQuarantined++;
        stats.errors.push({ cardId: card.id, player: card.player, error: "No image URL (quarantined)" });
        return;
      }

      const result = await validateImageUrl(card.imageUrl);
      
      if (result.valid) {
        stats.valid++;
        await db.update(playableCards)
          .set({
            lastImageCheck: new Date(),
            imageFailureCount: 0,
            imageLastError: null,
            validationFailCount: 0,
            quarantineStatus: "OK",
            proposedUnplayable: false,
            lastValidationReason: null,
            lastValidationHttpStatus: null,
            lastValidationContentType: result.contentType || null,
            lastValidationCheckedAt: new Date(),
            firstValidationFailAt: null,
            updatedAt: new Date(),
          })
          .where(eq(playableCards.id, card.id));
      } else {
        stats.invalid++;
        
        const hasTransient = isTransientError(result.statusCode || null, result.error || null);
        const newFailCount = (card.validationFailCount || 0) + 1;
        const firstFailAt = card.firstValidationFailAt || new Date();
        const meetsProposalCriteria = checkProposalCriteria(newFailCount, firstFailAt, hasTransient);
        
        const newQuarantineStatus = determineQuarantineStatus(newFailCount, hasTransient, meetsProposalCriteria);
        
        await updateQuarantineFields(card.id, {
          validationFailCount: newFailCount,
          lastValidationReason: result.error || "Unknown error",
          lastValidationHttpStatus: result.statusCode || null,
          lastValidationContentType: result.contentType || null,
          quarantineStatus: newQuarantineStatus,
          proposedUnplayable: meetsProposalCriteria,
          firstValidationFailAt: firstFailAt,
        });
        
        if (newQuarantineStatus !== card.quarantineStatus && newQuarantineStatus !== "OK") {
          stats.newlyQuarantined++;
          console.log(`[ImageValidation] QUARANTINED (not deleted): ${card.id} (${card.player}): ${result.error} -> ${newQuarantineStatus}`);
        }
        
        if (meetsProposalCriteria) {
          stats.proposedUnplayable++;
          console.log(`[ImageValidation] PROPOSED UNPLAYABLE (awaiting admin): ${card.id} (${card.player})`);
        }
        
        stats.errors.push({ cardId: card.id, player: card.player, error: result.error || "Unknown error" });
      }
    }));

    if (i + BATCH_SIZE < cardsToCheck.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[ImageValidation] Playable cards: ${stats.valid} valid, ${stats.invalid} invalid, ${stats.newlyQuarantined} quarantined (NO cards marked unplayable)`);
  
  await writeAuditLog({
    setId: gameSetId,
    actionType: "VALIDATE_PLAYABLE_CARDS",
    operationSource,
    reason: `Checked ${stats.totalChecked} cards: ${stats.valid} valid, ${stats.newlyQuarantined} quarantined, ${stats.proposedUnplayable} proposed unplayable`,
    evidenceJson: { stats },
  });
  
  return stats;
}

function checkProposalCriteria(failCount: number, firstFailAt: Date | null, hasTransientErrors: boolean): boolean {
  if (failCount < MIN_FAILURES_FOR_PROPOSAL) return false;
  if (hasTransientErrors) return false;
  
  if (!firstFailAt) return false;
  
  const hoursSinceFirstFail = (Date.now() - firstFailAt.getTime()) / (1000 * 60 * 60);
  return hoursSinceFirstFail >= MIN_HOURS_FOR_PROPOSAL;
}

interface QuarantineUpdate {
  validationFailCount: number;
  lastValidationReason: string | null;
  lastValidationHttpStatus: number | null;
  lastValidationContentType: string | null;
  quarantineStatus: string;
  proposedUnplayable: boolean;
  firstValidationFailAt: Date | null;
}

async function updateQuarantineFields(cardId: string, update: QuarantineUpdate): Promise<void> {
  await db.update(playableCards)
    .set({
      lastImageCheck: new Date(),
      imageFailureCount: update.validationFailCount,
      imageLastError: update.lastValidationReason,
      validationFailCount: update.validationFailCount,
      lastValidationReason: update.lastValidationReason,
      lastValidationHttpStatus: update.lastValidationHttpStatus,
      lastValidationContentType: update.lastValidationContentType,
      lastValidationCheckedAt: new Date(),
      quarantineStatus: update.quarantineStatus,
      proposedUnplayable: update.proposedUnplayable,
      firstValidationFailAt: update.firstValidationFailAt,
      updatedAt: new Date(),
    })
    .where(eq(playableCards.id, cardId));
}

export async function validateBaseballCardImages(
  forceRecheck: boolean = false
): Promise<ValidationStats> {
  const stats: ValidationStats = {
    totalChecked: 0,
    valid: 0,
    invalid: 0,
    newlyExcluded: 0,
    newlyQuarantined: 0,
    proposedUnplayable: 0,
    skippedKillSwitch: 0,
    errors: []
  };

  if (isKillSwitchEnabled()) {
    console.log("[ImageValidation] KILL SWITCH enabled, skipping baseball card validation");
    return stats;
  }

  const staleThreshold = new Date(Date.now() - VALIDATION_INTERVAL_MS);

  let cardsToCheck;
  if (forceRecheck) {
    cardsToCheck = await db.select({
      id: baseballCards.id,
      imageUrl: baseballCards.imageUrl,
      playerName: baseballCards.playerName,
      imageFailureCount: baseballCards.imageFailureCount,
      imageVerified: baseballCards.imageVerified,
    })
    .from(baseballCards);
  } else {
    cardsToCheck = await db.select({
      id: baseballCards.id,
      imageUrl: baseballCards.imageUrl,
      playerName: baseballCards.playerName,
      imageFailureCount: baseballCards.imageFailureCount,
      imageVerified: baseballCards.imageVerified,
    })
    .from(baseballCards)
    .where(or(
      isNull(baseballCards.lastImageCheck),
      lt(baseballCards.lastImageCheck, staleThreshold)
    ));
  }

  console.log(`[ImageValidation] Checking ${cardsToCheck.length} baseball cards`);

  for (let i = 0; i < cardsToCheck.length; i += BATCH_SIZE) {
    const batch = cardsToCheck.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (card) => {
      stats.totalChecked++;
      
      const result = await validateImageUrl(card.imageUrl);
      
      if (result.valid) {
        stats.valid++;
        await db.update(baseballCards)
          .set({
            lastImageCheck: new Date(),
            imageFailureCount: 0,
            imageLastError: null,
          })
          .where(eq(baseballCards.id, card.id));
      } else {
        stats.invalid++;
        
        const newFailureCount = (card.imageFailureCount || 0) + 1;
        
        await db.update(baseballCards)
          .set({
            lastImageCheck: new Date(),
            imageFailureCount: newFailureCount,
            imageLastError: result.error,
          })
          .where(eq(baseballCards.id, card.id));
        
        stats.errors.push({ cardId: card.id, player: card.playerName, error: result.error || "Unknown error" });
      }
    }));

    if (i + BATCH_SIZE < cardsToCheck.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[ImageValidation] Baseball cards: ${stats.valid} valid, ${stats.invalid} invalid`);
  return stats;
}

export async function runFullValidation(forceRecheck: boolean = false): Promise<{
  playableCards: ValidationStats;
  baseballCards: ValidationStats;
}> {
  console.log(`[ImageValidation] Starting full validation (force=${forceRecheck})`);
  
  const [playableStats, baseballStats] = await Promise.all([
    validatePlayableCardImages(undefined, forceRecheck),
    validateBaseballCardImages(forceRecheck)
  ]);

  console.log(`[ImageValidation] Full validation complete`);
  console.log(`  Playable: ${playableStats.totalChecked} checked, ${playableStats.newlyQuarantined} quarantined, 0 excluded (SAFE)`);
  console.log(`  Baseball: ${baseballStats.totalChecked} checked`);

  return {
    playableCards: playableStats,
    baseballCards: baseballStats
  };
}

export async function getValidationStatus(): Promise<{
  playableCards: {
    total: number;
    playable: number;
    excluded: number;
    neverChecked: number;
    failingImages: number;
    quarantined: number;
    proposedUnplayable: number;
  };
  baseballCards: {
    total: number;
    verified: number;
    unverified: number;
    neverChecked: number;
    failingImages: number;
  };
}> {
  const [playableStats] = await db.select({
    total: sql<number>`count(*)`,
    playable: sql<number>`count(*) filter (where ${playableCards.isPlayable} = true)`,
    excluded: sql<number>`count(*) filter (where ${playableCards.isPlayable} = false)`,
    neverChecked: sql<number>`count(*) filter (where ${playableCards.lastImageCheck} is null)`,
    failingImages: sql<number>`count(*) filter (where ${playableCards.imageFailureCount} > 0)`,
    quarantined: sql<number>`count(*) filter (where ${playableCards.quarantineStatus} != 'OK')`,
    proposedUnplayable: sql<number>`count(*) filter (where ${playableCards.proposedUnplayable} = true)`,
  }).from(playableCards);

  const [baseballStats] = await db.select({
    total: sql<number>`count(*)`,
    verified: sql<number>`count(*) filter (where ${baseballCards.imageVerified} = true)`,
    unverified: sql<number>`count(*) filter (where ${baseballCards.imageVerified} = false)`,
    neverChecked: sql<number>`count(*) filter (where ${baseballCards.lastImageCheck} is null)`,
    failingImages: sql<number>`count(*) filter (where ${baseballCards.imageFailureCount} > 0)`,
  }).from(baseballCards);

  return {
    playableCards: {
      total: Number(playableStats.total),
      playable: Number(playableStats.playable),
      excluded: Number(playableStats.excluded),
      neverChecked: Number(playableStats.neverChecked),
      failingImages: Number(playableStats.failingImages),
      quarantined: Number(playableStats.quarantined),
      proposedUnplayable: Number(playableStats.proposedUnplayable),
    },
    baseballCards: {
      total: Number(baseballStats.total),
      verified: Number(baseballStats.verified),
      unverified: Number(baseballStats.unverified),
      neverChecked: Number(baseballStats.neverChecked),
      failingImages: Number(baseballStats.failingImages),
    }
  };
}

export async function revalidateCard(
  cardId: string, 
  cardType: "playable" | "baseball",
  operationSource: OperationSource = "ADMIN_MANUAL"
): Promise<ValidationResult & { mutationBlocked?: boolean }> {
  if (cardType === "playable") {
    const [card] = await db.select({ 
      imageUrl: playableCards.imageUrl,
      validationFailCount: playableCards.validationFailCount,
      firstValidationFailAt: playableCards.firstValidationFailAt,
    })
      .from(playableCards)
      .where(eq(playableCards.id, cardId))
      .limit(1);
    
    if (!card) {
      return { valid: false, error: "Card not found" };
    }
    
    const result = await validateImageUrl(card.imageUrl || "");
    
    if (result.valid) {
      await db.update(playableCards)
        .set({
          lastImageCheck: new Date(),
          imageFailureCount: 0,
          imageLastError: null,
          validationFailCount: 0,
          quarantineStatus: "OK",
          proposedUnplayable: false,
          lastValidationReason: null,
          lastValidationHttpStatus: null,
          lastValidationContentType: result.contentType || null,
          lastValidationCheckedAt: new Date(),
          firstValidationFailAt: null,
          updatedAt: new Date(),
        })
        .where(eq(playableCards.id, cardId));
    } else {
      if (operationSource === "ADMIN_MANUAL") {
        const mutationResult = assertMutationAllowed({
          operationSource,
          action: "SET_UNPLAYABLE",
        });
        
        if (mutationResult.allowed) {
          await db.update(playableCards)
            .set({
              lastImageCheck: new Date(),
              imageFailureCount: 1,
              imageLastError: result.error,
              isPlayable: false,
              blockedReason: "image_validation_failed",
              updatedAt: new Date(),
            })
            .where(eq(playableCards.id, cardId));
        }
      } else {
        const newFailCount = (card.validationFailCount || 0) + 1;
        const hasTransient = isTransientError(result.statusCode || null, result.error || null);
        const firstFailAt = card.firstValidationFailAt || new Date();
        const meetsProposalCriteria = checkProposalCriteria(newFailCount, firstFailAt, hasTransient);
        
        await updateQuarantineFields(cardId, {
          validationFailCount: newFailCount,
          lastValidationReason: result.error || null,
          lastValidationHttpStatus: result.statusCode || null,
          lastValidationContentType: result.contentType || null,
          quarantineStatus: determineQuarantineStatus(newFailCount, hasTransient, meetsProposalCriteria),
          proposedUnplayable: meetsProposalCriteria,
          firstValidationFailAt: firstFailAt,
        });
      }
    }
    
    return result;
  } else {
    const [card] = await db.select({ imageUrl: baseballCards.imageUrl })
      .from(baseballCards)
      .where(eq(baseballCards.id, cardId))
      .limit(1);
    
    if (!card) {
      return { valid: false, error: "Card not found" };
    }
    
    const result = await validateImageUrl(card.imageUrl);
    
    await db.update(baseballCards)
      .set({
        lastImageCheck: new Date(),
        imageFailureCount: result.valid ? 0 : 1,
        imageLastError: result.valid ? null : result.error,
        imageVerified: result.valid,
      })
      .where(eq(baseballCards.id, cardId));
    
    return result;
  }
}

export async function applyProposedChanges(
  gameSetId: string,
  actorUserId: string
): Promise<{ applied: number; errors: string[] }> {
  const mutationResult = assertMutationAllowed({
    operationSource: "ADMIN_MANUAL",
    action: "APPLY_PROPOSED_CHANGES",
    actorUserId,
  });
  
  if (!mutationResult.allowed) {
    logMutationBlocked({
      operationSource: "ADMIN_MANUAL",
      action: "APPLY_PROPOSED_CHANGES",
      actorUserId,
    }, mutationResult);
    return { applied: 0, errors: [mutationResult.reason || "Mutation not allowed"] };
  }
  
  const [beforeCounts] = await db.select({
    total: sql<number>`count(*)`,
    playable: sql<number>`count(*) filter (where ${playableCards.isPlayable} = true)`,
  }).from(playableCards).where(eq(playableCards.gameSetId, gameSetId));
  
  const proposedCards = await db.select({ id: playableCards.id })
    .from(playableCards)
    .where(and(
      eq(playableCards.gameSetId, gameSetId),
      eq(playableCards.proposedUnplayable, true)
    ));
  
  if (proposedCards.length === 0) {
    return { applied: 0, errors: [] };
  }
  
  await db.update(playableCards)
    .set({
      isPlayable: false,
      blockedReason: "admin_approved_proposal",
      proposedUnplayable: false,
      updatedAt: new Date(),
    })
    .where(and(
      eq(playableCards.gameSetId, gameSetId),
      eq(playableCards.proposedUnplayable, true)
    ));
  
  const [afterCounts] = await db.select({
    total: sql<number>`count(*)`,
    playable: sql<number>`count(*) filter (where ${playableCards.isPlayable} = true)`,
  }).from(playableCards).where(eq(playableCards.gameSetId, gameSetId));
  
  await writeAuditLog({
    setId: gameSetId,
    actionType: "APPLY_PROPOSED_CHANGES",
    operationSource: "ADMIN_MANUAL",
    actorUserId,
    beforeTotalCards: Number(beforeCounts.total),
    afterTotalCards: Number(afterCounts.total),
    beforePlayableCards: Number(beforeCounts.playable),
    afterPlayableCards: Number(afterCounts.playable),
    reason: `Admin applied ${proposedCards.length} proposed unplayable cards`,
    evidenceJson: { cardIds: proposedCards.map(c => c.id) },
  });
  
  console.log(`[ImageValidation] ADMIN applied ${proposedCards.length} proposed changes for set ${gameSetId}`);
  
  return { applied: proposedCards.length, errors: [] };
}

let validationJobInterval: NodeJS.Timeout | null = null;

export function startValidationJob(): void {
  if (validationJobInterval) {
    console.log("[ImageValidation] Job already running");
    return;
  }

  console.log("[ImageValidation] Starting scheduled validation job (every 6 hours)");
  
  setTimeout(() => {
    runFullValidation(false).catch(err => {
      console.error("[ImageValidation] Initial validation failed:", err);
    });
  }, 30000);

  validationJobInterval = setInterval(() => {
    runFullValidation(false).catch(err => {
      console.error("[ImageValidation] Scheduled validation failed:", err);
    });
  }, VALIDATION_INTERVAL_MS);
}

export function stopValidationJob(): void {
  if (validationJobInterval) {
    clearInterval(validationJobInterval);
    validationJobInterval = null;
    console.log("[ImageValidation] Stopped scheduled validation job");
  }
}
