import { db } from "../db";
import { playableCards } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { fetchCardDetailsNormalized, isCardHedgeConfigured } from "./cardhedge/client";
import { isPlaceholderUrl, MIN_VALID_IMAGE_SIZE } from "./imageValidation";

const FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_DELAY_MS = 1000; // 1 second between requests
const IMAGE_VALIDATION_TIMEOUT_MS = 5000; // 5 second timeout for image validation

let lastRequestTime = 0;

async function rateLimitedDelay(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
}

interface ImageValidationResult {
  valid: boolean;
  error?: string;
  isPlaceholder?: boolean;
}

async function validateImageUrl(url: string): Promise<ImageValidationResult> {
  // First check URL patterns for known placeholders
  if (isPlaceholderUrl(url)) {
    return { 
      valid: false, 
      error: "Detected placeholder image URL pattern",
      isPlaceholder: true
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMAGE_VALIDATION_TIMEOUT_MS);
    
    const response = await fetch(url, { 
      method: "HEAD",
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}` };
    }
    
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.startsWith("image/")) {
      return { valid: false, error: "Invalid content type" };
    }
    
    // Check for placeholder based on file size
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
  } catch {
    return { valid: false, error: "Network error" };
  }
}

export interface FreshImageResult {
  success: boolean;
  imageUrl: string | null;
  fromCache: boolean;
  error?: string;
  playerMismatch?: boolean;
}

// Normalize player names for comparison (case-insensitive, trim whitespace, handle common variations)
function normalizePlayerName(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Check if two player names match (allowing for minor variations)
function playerNamesMatch(storedPlayer: string | null, apiPlayer: string | null): boolean {
  const normalized1 = normalizePlayerName(storedPlayer);
  const normalized2 = normalizePlayerName(apiPlayer);
  
  if (!normalized1 || !normalized2) return false;
  
  // Exact match
  if (normalized1 === normalized2) return true;
  
  // Check if one contains the other (handles "Jr." vs no suffix, middle names, etc.)
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) return true;
  
  return false;
}

export async function getFreshImageUrl(
  cardId: string,
  cardHedgeId: string | null,
  currentImageUrl: string | null,
  lastImageCheck: Date | null,
  expectedPlayerName?: string | null
): Promise<FreshImageResult> {
  if (!cardHedgeId) {
    return {
      success: false,
      imageUrl: currentImageUrl,
      fromCache: true,
      error: "No Card Hedge ID available for this card",
    };
  }

  if (!isCardHedgeConfigured()) {
    return {
      success: false,
      imageUrl: currentImageUrl,
      fromCache: true,
      error: "Card Hedge API not configured",
    };
  }

  const now = new Date();
  const isStale = !lastImageCheck || (now.getTime() - lastImageCheck.getTime() > FRESHNESS_THRESHOLD_MS);

  if (!isStale && currentImageUrl) {
    return {
      success: true,
      imageUrl: currentImageUrl,
      fromCache: true,
    };
  }

  try {
    await rateLimitedDelay();
    
    const cardDetails = await fetchCardDetailsNormalized(cardHedgeId);
    
    if (!cardDetails || !cardDetails.imageUrl) {
      console.log(`[CardImageRefresh] No image found for card ${cardId} (cardHedgeId: ${cardHedgeId})`);
      
      await db.update(playableCards)
        .set({
          lastImageCheck: now,
          imageFailureCount: sql`COALESCE(${playableCards.imageFailureCount}, 0) + 1`,
          imageLastError: "No image found in Card Hedge response",
        })
        .where(eq(playableCards.id, cardId));
      
      return {
        success: false,
        imageUrl: currentImageUrl,
        fromCache: true,
        error: "No image found in Card Hedge response",
      };
    }

    // CRITICAL: Verify player name matches before accepting new image URL
    // This prevents data corruption where Card Hedge returns wrong player's image
    if (expectedPlayerName && cardDetails.player) {
      if (!playerNamesMatch(expectedPlayerName, cardDetails.player)) {
        const errorMsg = `Player mismatch: stored="${expectedPlayerName}" vs API="${cardDetails.player}"`;
        console.warn(`[CardImageRefresh] ${errorMsg} for card ${cardId} - REJECTING image update`);
        
        // ANTI-PRUNING: Only update diagnostic fields, never set isPlayable=false
        // Card remains playable with existing image; admin must manually exclude if needed
        await db.update(playableCards)
          .set({
            lastImageCheck: now,
            imageLastError: errorMsg,
            lastValidationReason: errorMsg,
            quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
            proposedUnplayable: true,
          })
          .where(eq(playableCards.id, cardId));
        
        return {
          success: false,
          imageUrl: currentImageUrl,
          fromCache: true,
          error: errorMsg,
          playerMismatch: true,
        };
      }
    }

    const validationResult = await validateImageUrl(cardDetails.imageUrl);
    
    if (!validationResult.valid) {
      const errorMsg = validationResult.isPlaceholder 
        ? `Placeholder image detected: ${validationResult.error}`
        : `Image validation failed: ${validationResult.error}`;
      console.log(`[CardImageRefresh] ${errorMsg} for card ${cardId}`);
      
      // Immediately exclude placeholder cards (set high failure count)
      const failureIncrement = validationResult.isPlaceholder ? 5 : 1;
      
      // ANTI-PRUNING: Never set isPlayable=false in automated refresh
      // Flag for admin review if placeholder detected
      const quarantineFields = validationResult.isPlaceholder ? {
        quarantineStatus: "QUARANTINED_ADMIN_REVIEW" as const,
        proposedUnplayable: true,
        lastValidationReason: `Placeholder image detected: ${errorMsg}`,
      } : {};
      
      await db.update(playableCards)
        .set({
          lastImageCheck: now,
          imageLastError: errorMsg,
          ...quarantineFields,
        })
        .where(eq(playableCards.id, cardId));
      
      return {
        success: false,
        imageUrl: currentImageUrl,
        fromCache: true,
        error: errorMsg,
      };
    }

    await db.update(playableCards)
      .set({
        imageUrl: cardDetails.imageUrl,
        lastImageCheck: now,
        imageFailureCount: 0,
        imageLastError: null,
      })
      .where(eq(playableCards.id, cardId));

    console.log(`[CardImageRefresh] Updated card ${cardId} with validated fresh image URL`);
    
    return {
      success: true,
      imageUrl: cardDetails.imageUrl,
      fromCache: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[CardImageRefresh] Error fetching fresh image for card ${cardId}:`, errorMessage);
    
    await db.update(playableCards)
      .set({
        lastImageCheck: now,
        imageFailureCount: sql`COALESCE(${playableCards.imageFailureCount}, 0) + 1`,
        imageLastError: `Refresh error: ${errorMessage}`,
      })
      .where(eq(playableCards.id, cardId)).catch(() => {});
    
    return {
      success: false,
      imageUrl: currentImageUrl,
      fromCache: true,
      error: errorMessage,
    };
  }
}

export async function refreshCardImage(cardId: string): Promise<FreshImageResult> {
  const card = await db.query.playableCards.findFirst({
    where: eq(playableCards.id, cardId),
  });

  if (!card) {
    return {
      success: false,
      imageUrl: null,
      fromCache: false,
      error: "Card not found",
    };
  }

  // Pass expected player name to verify Card Hedge returns matching player
  return getFreshImageUrl(
    card.id,
    card.cardhedgeCardId || null,
    card.imageUrl || null,
    card.lastImageCheck || null,
    card.player // Expected player name for verification
  );
}

export function isImageStale(lastImageCheck: Date | null): boolean {
  if (!lastImageCheck) return true;
  return Date.now() - lastImageCheck.getTime() > FRESHNESS_THRESHOLD_MS;
}
