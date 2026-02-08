import { db } from "../../db";
import { cardImageCache, cardImageQuarantine, baseballCards, playableCards } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { normalizeImageUrl, isPlaceholderImage, quarantineCard } from "../cards/imageQuality";

const VALIDATION_TIMEOUT_MS = 6000;
const MIN_IMAGE_BYTES = 5 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ValidationResult {
  valid: boolean;
  status: "ok" | "bad" | "pending";
  httpStatus?: number;
  contentType?: string;
  bytes?: number;
  error?: string;
}

export async function validateRemoteImage(url: string): Promise<ValidationResult> {
  const normalized = normalizeImageUrl(url);
  if (!normalized) {
    return { valid: false, status: "bad", error: "Invalid or empty URL" };
  }

  if (isPlaceholderImage(normalized)) {
    return { valid: false, status: "bad", error: "Placeholder URL detected" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

    const response = await fetch(normalized, {
      method: "GET",
      headers: {
        Range: "bytes=0-65535",
        "User-Agent": "PackPTS/1.0 ImageValidator",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    const httpStatus = response.status;
    const contentType = response.headers.get("content-type") || "";
    
    if (httpStatus !== 200 && httpStatus !== 206) {
      return {
        valid: false,
        status: "bad",
        httpStatus,
        contentType,
        error: `HTTP ${httpStatus}`,
      };
    }

    if (!contentType.toLowerCase().startsWith("image/")) {
      return {
        valid: false,
        status: "bad",
        httpStatus,
        contentType,
        error: `Invalid content-type: ${contentType}`,
      };
    }

    const contentLength = response.headers.get("content-length");
    let estimatedBytes = contentLength ? parseInt(contentLength, 10) : 0;
    
    if (httpStatus === 206) {
      const contentRange = response.headers.get("content-range");
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) {
          estimatedBytes = parseInt(match[1], 10);
        }
      }
    }

    if (!estimatedBytes) {
      const body = await response.arrayBuffer();
      estimatedBytes = body.byteLength;
    }

    if (estimatedBytes < MIN_IMAGE_BYTES) {
      return {
        valid: false,
        status: "bad",
        httpStatus,
        contentType,
        bytes: estimatedBytes,
        error: `Image too small: ${estimatedBytes} bytes (min: ${MIN_IMAGE_BYTES})`,
      };
    }

    if (estimatedBytes > MAX_IMAGE_BYTES) {
      return {
        valid: false,
        status: "bad",
        httpStatus,
        contentType,
        bytes: estimatedBytes,
        error: `Image too large: ${estimatedBytes} bytes (max: ${MAX_IMAGE_BYTES})`,
      };
    }

    return {
      valid: true,
      status: "ok",
      httpStatus,
      contentType,
      bytes: estimatedBytes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    
    if (message.includes("aborted") || message.includes("timeout")) {
      return { valid: false, status: "bad", error: "Request timeout" };
    }
    
    return { valid: false, status: "bad", error: message };
  }
}

export async function getOrValidateCardImage(cardId: string, sourceUrl: string): Promise<{
  proxiedPath: string;
  status: "ok" | "bad" | "pending";
  cached: boolean;
}> {
  const normalized = normalizeImageUrl(sourceUrl);
  if (!normalized) {
    return { proxiedPath: "", status: "bad", cached: false };
  }

  const [existing] = await db
    .select()
    .from(cardImageCache)
    .where(eq(cardImageCache.cardId, cardId))
    .limit(1);

  if (existing) {
    if (existing.status === "ok") {
      return { proxiedPath: existing.proxiedPath, status: "ok", cached: true };
    }
    
    if (existing.status === "bad") {
      return { proxiedPath: "", status: "bad", cached: true };
    }
  }

  const validation = await validateRemoteImage(normalized);
  const proxiedPath = `/api/images/card/${cardId}`;

  await db
    .insert(cardImageCache)
    .values({
      cardId,
      sourceUrl,
      normalizedUrl: normalized,
      proxiedPath,
      status: validation.status,
      lastHttpStatus: validation.httpStatus || null,
      lastContentType: validation.contentType || null,
      bytes: validation.bytes || null,
      failCount: validation.valid ? 0 : 1,
    })
    .onConflictDoUpdate({
      target: cardImageCache.cardId,
      set: {
        status: validation.status,
        lastHttpStatus: validation.httpStatus || null,
        lastContentType: validation.contentType || null,
        bytes: validation.bytes || null,
        failCount: validation.valid 
          ? 0 
          : sql`${cardImageCache.failCount} + 1`,
        lastCheckedAt: new Date(),
      },
    });

  if (!validation.valid) {
    quarantineCard(cardId, validation.error || "validation_failed", normalized).catch(() => {});
  }

  return {
    proxiedPath: validation.valid ? proxiedPath : "",
    status: validation.status,
    cached: false,
  };
}

export async function getCachedImageUrl(cardId: string): Promise<string | null> {
  const [cached] = await db
    .select()
    .from(cardImageCache)
    .where(eq(cardImageCache.cardId, cardId))
    .limit(1);

  if (!cached || cached.status !== "ok") {
    return null;
  }

  return cached.normalizedUrl;
}

export async function getSourceUrlForCard(cardId: string): Promise<string | null> {
  const [cached] = await db
    .select({ normalizedUrl: cardImageCache.normalizedUrl })
    .from(cardImageCache)
    .where(eq(cardImageCache.cardId, cardId))
    .limit(1);

  if (cached) {
    return cached.normalizedUrl;
  }

  const [card] = await db
    .select({ imageUrl: baseballCards.imageUrl })
    .from(baseballCards)
    .where(eq(baseballCards.id, cardId))
    .limit(1);

  if (card?.imageUrl) {
    return normalizeImageUrl(card.imageUrl);
  }

  const [pcCard] = await db
    .select({ imageUrl: playableCards.imageUrl })
    .from(playableCards)
    .where(eq(playableCards.id, cardId))
    .limit(1);

  return pcCard?.imageUrl ? normalizeImageUrl(pcCard.imageUrl) : null;
}

export async function markImageBad(cardId: string, reason: string): Promise<void> {
  await db
    .update(cardImageCache)
    .set({
      status: "bad",
      failCount: sql`${cardImageCache.failCount} + 1`,
      lastCheckedAt: new Date(),
    })
    .where(eq(cardImageCache.cardId, cardId));

  await quarantineCard(cardId, reason, null);
}

export async function invalidateCacheEntry(cardId: string): Promise<void> {
  await db
    .delete(cardImageCache)
    .where(eq(cardImageCache.cardId, cardId));
}

export async function getValidatedCardIds(): Promise<Set<string>> {
  const rows = await db
    .select({ cardId: cardImageCache.cardId })
    .from(cardImageCache)
    .where(eq(cardImageCache.status, "ok"));

  return new Set(rows.map(r => r.cardId));
}

export async function getBadCardIds(): Promise<Set<string>> {
  const rows = await db
    .select({ cardId: cardImageCache.cardId })
    .from(cardImageCache)
    .where(eq(cardImageCache.status, "bad"));

  return new Set(rows.map(r => r.cardId));
}
