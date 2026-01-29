import { db } from "../db";
import { playableCards, baseballCards } from "@shared/schema";
import { eq, lt, isNull, or, and, sql } from "drizzle-orm";

const VALIDATION_TIMEOUT_MS = 8000;
const MAX_FAILURE_COUNT = 2;
const VALIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1000;
const MIN_VALID_IMAGE_SIZE = 5000; // Minimum 5KB for a real card image

// Known placeholder URL patterns from Card Hedge and other sources
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

// Known placeholder image dimensions (width x height) - common placeholder sizes
const PLACEHOLDER_DIMENSIONS = new Set([
  "300x400", // Common placeholder size
  "200x300",
  "150x200",
  "100x150",
]);

// Check if URL matches known placeholder patterns
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
}

async function validateImageUrl(url: string): Promise<ValidationResult> {
  if (!url) {
    return { valid: false, error: "No URL provided" };
  }

  // First check if URL matches known placeholder patterns
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

    if (!response.ok) {
      return { 
        valid: false, 
        error: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status
      };
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.startsWith("image/")) {
      return { 
        valid: false, 
        error: `Invalid content type: ${contentType || "unknown"}`
      };
    }

    // Check content length - placeholder images are typically small
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size < MIN_VALID_IMAGE_SIZE) {
        return {
          valid: false,
          error: `Image too small (${size} bytes) - likely placeholder`,
          isPlaceholder: true
        };
      }
    }

    return { valid: true };
  } catch (error: any) {
    if (error.name === "AbortError") {
      return { valid: false, error: "Request timeout" };
    }
    return { valid: false, error: error.message || "Network error" };
  }
}

// Export for use in other modules
export { isPlaceholderUrl, MIN_VALID_IMAGE_SIZE };

export interface ValidationStats {
  totalChecked: number;
  valid: number;
  invalid: number;
  newlyExcluded: number;
  errors: Array<{ cardId: string; player: string | null; error: string }>;
}

export async function validatePlayableCardImages(
  gameSetId?: string,
  forceRecheck: boolean = false
): Promise<ValidationStats> {
  const stats: ValidationStats = {
    totalChecked: 0,
    valid: 0,
    invalid: 0,
    newlyExcluded: 0,
    errors: []
  };

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
    })
    .from(playableCards)
    .where(and(...conditions));
  }

  console.log(`[ImageValidation] Checking ${cardsToCheck.length} playable cards`);

  for (let i = 0; i < cardsToCheck.length; i += BATCH_SIZE) {
    const batch = cardsToCheck.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (card) => {
      stats.totalChecked++;
      
      if (!card.imageUrl) {
        stats.invalid++;
        await db.update(playableCards)
          .set({
            lastImageCheck: new Date(),
            imageFailureCount: (card.imageFailureCount || 0) + 1,
            imageLastError: "No image URL",
            isPlayable: false,
            blockedReason: "missing_image",
            updatedAt: new Date(),
          })
          .where(eq(playableCards.id, card.id));
        stats.newlyExcluded++;
        stats.errors.push({ cardId: card.id, player: card.player, error: "No image URL" });
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
            updatedAt: new Date(),
          })
          .where(eq(playableCards.id, card.id));
      } else {
        stats.invalid++;
        
        // Placeholder images are immediately excluded (no retry)
        if (result.isPlaceholder) {
          await db.update(playableCards)
            .set({
              lastImageCheck: new Date(),
              imageFailureCount: 5, // High failure count prevents re-checking
              imageLastError: result.error,
              isPlayable: false,
              blockedReason: "placeholder_image",
              updatedAt: new Date(),
            })
            .where(eq(playableCards.id, card.id));
          stats.newlyExcluded++;
          console.log(`[ImageValidation] PLACEHOLDER excluded: ${card.id} (${card.player}): ${result.error}`);
          stats.errors.push({ cardId: card.id, player: card.player, error: `PLACEHOLDER: ${result.error}` });
          return;
        }
        
        // Regular failures use incremental exclusion
        const newFailureCount = (card.imageFailureCount || 0) + 1;
        const shouldExclude = newFailureCount >= MAX_FAILURE_COUNT;
        
        await db.update(playableCards)
          .set({
            lastImageCheck: new Date(),
            imageFailureCount: newFailureCount,
            imageLastError: result.error,
            isPlayable: shouldExclude ? false : true,
            blockedReason: shouldExclude ? "image_validation_failed" : null,
            updatedAt: new Date(),
          })
          .where(eq(playableCards.id, card.id));
        
        if (shouldExclude) {
          stats.newlyExcluded++;
          console.log(`[ImageValidation] Excluded card ${card.id} (${card.player}): ${result.error}`);
        }
        
        stats.errors.push({ cardId: card.id, player: card.player, error: result.error || "Unknown error" });
      }
    }));

    if (i + BATCH_SIZE < cardsToCheck.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[ImageValidation] Playable cards: ${stats.valid} valid, ${stats.invalid} invalid, ${stats.newlyExcluded} excluded`);
  return stats;
}

export async function validateBaseballCardImages(
  forceRecheck: boolean = false
): Promise<ValidationStats> {
  const stats: ValidationStats = {
    totalChecked: 0,
    valid: 0,
    invalid: 0,
    newlyExcluded: 0,
    errors: []
  };

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
        
        // Placeholder images are immediately excluded
        if (result.isPlaceholder) {
          await db.update(baseballCards)
            .set({
              lastImageCheck: new Date(),
              imageFailureCount: 5, // High failure count prevents re-checking
              imageLastError: result.error,
              imageVerified: false,
            })
            .where(eq(baseballCards.id, card.id));
          stats.newlyExcluded++;
          console.log(`[ImageValidation] PLACEHOLDER excluded baseball card ${card.id} (${card.playerName}): ${result.error}`);
          stats.errors.push({ cardId: card.id, player: card.playerName, error: `PLACEHOLDER: ${result.error}` });
          return;
        }
        
        const newFailureCount = (card.imageFailureCount || 0) + 1;
        const shouldExclude = newFailureCount >= MAX_FAILURE_COUNT && card.imageVerified;
        
        await db.update(baseballCards)
          .set({
            lastImageCheck: new Date(),
            imageFailureCount: newFailureCount,
            imageLastError: result.error,
            imageVerified: shouldExclude ? false : card.imageVerified,
          })
          .where(eq(baseballCards.id, card.id));
        
        if (shouldExclude) {
          stats.newlyExcluded++;
          console.log(`[ImageValidation] Excluded card ${card.id} (${card.playerName}): ${result.error}`);
        }
        
        stats.errors.push({ cardId: card.id, player: card.playerName, error: result.error || "Unknown error" });
      }
    }));

    if (i + BATCH_SIZE < cardsToCheck.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[ImageValidation] Baseball cards: ${stats.valid} valid, ${stats.invalid} invalid, ${stats.newlyExcluded} excluded`);
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
  console.log(`  Playable: ${playableStats.totalChecked} checked, ${playableStats.newlyExcluded} excluded`);
  console.log(`  Baseball: ${baseballStats.totalChecked} checked, ${baseballStats.newlyExcluded} excluded`);

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

export async function revalidateCard(cardId: string, cardType: "playable" | "baseball"): Promise<ValidationResult> {
  if (cardType === "playable") {
    const [card] = await db.select({ imageUrl: playableCards.imageUrl })
      .from(playableCards)
      .where(eq(playableCards.id, cardId))
      .limit(1);
    
    if (!card) {
      return { valid: false, error: "Card not found" };
    }
    
    const result = await validateImageUrl(card.imageUrl || "");
    
    await db.update(playableCards)
      .set({
        lastImageCheck: new Date(),
        imageFailureCount: result.valid ? 0 : 1,
        imageLastError: result.valid ? null : result.error,
        isPlayable: result.valid,
        blockedReason: result.valid ? null : "image_validation_failed",
        updatedAt: new Date(),
      })
      .where(eq(playableCards.id, cardId));
    
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
