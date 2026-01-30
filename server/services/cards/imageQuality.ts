import { db } from "../../db";
import { cardImageQuarantine } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { analyzeImageContent, type ImageAnalysisResult } from "../imageContentAnalyzer";

const PLACEHOLDER_URL_MARKERS = [
  "example.jpg",
  "example.png",
  "placeholder",
  "stock",
  "appforest",
  "default",
  "noimage",
  "no-image",
  "/example",
  "silhouette",
  "fallback",
  "blank",
  "missing",
  "notfound",
  "not-found",
  "image-not",
  "unavailable",
];

const ALLOWED_IMAGE_HOSTS = [
  "s3.amazonaws.com",
  "s3.us-east-1.amazonaws.com",
  "s3.us-west-2.amazonaws.com",
  "cardhedger.com",
  "cdn.cardhedger.com",
  "images.cardhedger.com",
  "cloudfront.net",
  "d1",
  "d2",
  "d3",
  "psacard.com",
  "beckett.com",
  "ebayimg.com",
  "i.ebayimg.com",
  "images.collector-cdn.com",
  "cdn.bubble.io",
];

export function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string" || url.trim() === "") {
    return null;
  }

  let normalized = url.trim();

  if (normalized.startsWith("//")) {
    normalized = "https:" + normalized;
  }

  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }

  return normalized;
}

export interface PlaceholderCheckMeta {
  description?: string | null;
  set?: string | null;
  player?: string | null;
}

export function isPlaceholderImage(
  url: string | null | undefined,
  meta?: PlaceholderCheckMeta
): boolean {
  if (!url || typeof url !== "string") {
    return true;
  }

  const normalized = normalizeImageUrl(url);
  if (!normalized) {
    return true;
  }

  if (normalized.length < 20) {
    return true;
  }

  const lowerUrl = normalized.toLowerCase();
  for (const marker of PLACEHOLDER_URL_MARKERS) {
    if (lowerUrl.includes(marker)) {
      console.warn(`[ImageQuality] Placeholder detected via marker "${marker}" in URL: ${url}`);
      return true;
    }
  }

  if (meta?.description) {
    const lowerDesc = meta.description.toLowerCase();
    if (lowerDesc.includes("example") || lowerDesc.includes("placeholder")) {
      console.warn(`[ImageQuality] Placeholder detected in description: ${meta.description}`);
      return true;
    }
  }

  try {
    const urlObj = new URL(normalized);
    const host = urlObj.hostname.toLowerCase();
    
    const isAllowedHost = ALLOWED_IMAGE_HOSTS.some(
      (allowed) => host.includes(allowed) || host.endsWith("." + allowed)
    );
    
    if (!isAllowedHost && !host.includes("amazonaws") && !host.includes("cloudfront")) {
      console.warn(`[ImageQuality] Unknown image host: ${host} for URL: ${url}`);
    }
  } catch {
  }

  return false;
}

export interface CardForImageCheck {
  card_id?: string;
  cardId?: string;
  image?: string | null;
  imageUrl?: string | null;
  raw_image?: string | null;
  description?: string | null;
  set?: string | null;
  player?: string | null;
}

export function cardHasRealImage(card: CardForImageCheck): boolean {
  const cardId = card.card_id || card.cardId;
  const imageUrl = card.raw_image || card.image || card.imageUrl;

  if (!imageUrl) {
    console.warn(`[ImageQuality] Card ${cardId} has no image URL`);
    return false;
  }

  const normalized = normalizeImageUrl(imageUrl);
  if (!normalized) {
    console.warn(`[ImageQuality] Card ${cardId} has invalid image URL: ${imageUrl}`);
    return false;
  }

  const isPlaceholder = isPlaceholderImage(normalized, {
    description: card.description,
    set: card.set,
    player: card.player,
  });

  if (isPlaceholder) {
    console.warn(`[ImageQuality] Card ${cardId} has placeholder image: ${imageUrl}`);
    return false;
  }

  return true;
}

export async function quarantineCard(
  cardId: string,
  reason: string,
  imageUrl?: string | null
): Promise<void> {
  try {
    await db
      .insert(cardImageQuarantine)
      .values({
        cardId,
        reason,
        imageUrl: imageUrl || null,
      })
      .onConflictDoUpdate({
        target: cardImageQuarantine.cardId,
        set: {
          lastSeenAt: new Date(),
          seenCount: sql`${cardImageQuarantine.seenCount} + 1`,
          reason,
          imageUrl: imageUrl || null,
        },
      });

    console.warn(`[ImageQuality] Quarantined card ${cardId}: ${reason}`);
  } catch (error) {
    console.error(`[ImageQuality] Failed to quarantine card ${cardId}:`, error);
  }
}

export async function isCardQuarantined(cardId: string): Promise<boolean> {
  const [quarantined] = await db
    .select({ cardId: cardImageQuarantine.cardId })
    .from(cardImageQuarantine)
    .where(eq(cardImageQuarantine.cardId, cardId))
    .limit(1);

  return !!quarantined;
}

export async function getQuarantinedCardIds(): Promise<Set<string>> {
  const rows = await db
    .select({ cardId: cardImageQuarantine.cardId })
    .from(cardImageQuarantine);

  return new Set(rows.map((r) => r.cardId));
}

export async function removeFromQuarantine(cardId: string): Promise<void> {
  await db
    .delete(cardImageQuarantine)
    .where(eq(cardImageQuarantine.cardId, cardId));

  console.info(`[ImageQuality] Removed card ${cardId} from quarantine`);
}

/**
 * Deep content-based analysis to detect placeholder/silhouette images
 * This analyzes the actual image pixels to detect:
 * - Low color diversity (silhouettes are single-color)
 * - Low entropy (real cards have text, details)
 * - Dominant solid colors
 */
export async function analyzeCardImageContent(
  cardId: string,
  imageUrl: string
): Promise<{ isPlaceholder: boolean; confidence: number; reasons: string[] }> {
  const normalized = normalizeImageUrl(imageUrl);
  if (!normalized) {
    return { isPlaceholder: true, confidence: 100, reasons: ["Invalid image URL"] };
  }

  try {
    const result = await analyzeImageContent(normalized);
    
    if (result.isPlaceholder && result.confidence >= 50) {
      console.warn(`[ImageQuality] Content analysis flagged card ${cardId}: ${result.reasons.join("; ")}`);
    }
    
    return {
      isPlaceholder: result.isPlaceholder,
      confidence: result.confidence,
      reasons: result.reasons
    };
  } catch (error: any) {
    console.error(`[ImageQuality] Content analysis failed for card ${cardId}:`, error.message);
    return { isPlaceholder: false, confidence: 0, reasons: ["Analysis error"] };
  }
}

/**
 * Full card image validation including content analysis
 * Use this for pre-game validation to catch placeholder images
 */
export async function validateCardImageFully(card: CardForImageCheck): Promise<{
  valid: boolean;
  reason?: string;
  shouldQuarantine: boolean;
}> {
  const cardId = card.card_id || card.cardId || "unknown";
  const imageUrl = card.raw_image || card.image || card.imageUrl;

  // Step 1: Basic URL checks
  if (!cardHasRealImage(card)) {
    return { valid: false, reason: "Failed URL-based checks", shouldQuarantine: true };
  }

  // Step 2: Content-based analysis
  const normalized = normalizeImageUrl(imageUrl);
  if (!normalized) {
    return { valid: false, reason: "Invalid image URL", shouldQuarantine: true };
  }

  const contentResult = await analyzeCardImageContent(cardId, normalized);
  
  if (contentResult.isPlaceholder && contentResult.confidence >= 60) {
    return { 
      valid: false, 
      reason: `Content analysis: ${contentResult.reasons.join("; ")}`,
      shouldQuarantine: true
    };
  }

  return { valid: true, shouldQuarantine: false };
}

/**
 * Batch validate cards for a game session
 * Returns IDs of cards that should be excluded
 */
export async function validateCardsForGameSession(
  cards: CardForImageCheck[]
): Promise<{ validCards: CardForImageCheck[]; invalidCardIds: string[] }> {
  const validCards: CardForImageCheck[] = [];
  const invalidCardIds: string[] = [];

  for (const card of cards) {
    const cardId = card.card_id || card.cardId || "";
    
    // Quick URL check first
    if (!cardHasRealImage(card)) {
      invalidCardIds.push(cardId);
      quarantineCard(cardId, "failed_url_check", card.image || card.imageUrl).catch(() => {});
      continue;
    }

    // For cards that pass URL check, do content analysis
    const imageUrl = card.raw_image || card.image || card.imageUrl;
    if (imageUrl) {
      const contentResult = await analyzeCardImageContent(cardId, imageUrl);
      
      if (contentResult.isPlaceholder && contentResult.confidence >= 60) {
        invalidCardIds.push(cardId);
        quarantineCard(cardId, `content_analysis: ${contentResult.reasons[0] || "placeholder_detected"}`, imageUrl).catch(() => {});
        continue;
      }
    }

    validCards.push(card);
  }

  if (invalidCardIds.length > 0) {
    console.log(`[ImageQuality] Pre-game validation: ${invalidCardIds.length} cards quarantined, ${validCards.length} valid`);
  }

  return { validCards, invalidCardIds };
}
