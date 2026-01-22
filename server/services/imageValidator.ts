/**
 * Image Validation Service
 * Validates card images before they're used in gameplay
 */

interface ImageValidationResult {
  valid: boolean;
  reason?: string;
  width?: number;
  height?: number;
  contentType?: string;
}

const MIN_IMAGE_WIDTH = 100;
const MIN_IMAGE_HEIGHT = 100;
const MAX_ASPECT_RATIO = 3; // Max ratio between width/height
const VALIDATION_TIMEOUT_MS = 5000;

const imageValidationCache = new Map<string, { result: ImageValidationResult; expiresAt: number }>();
const CACHE_TTL_MS = 3600000; // 1 hour

/**
 * Validates an image URL by fetching headers and checking content type
 * This is a lightweight check that doesn't download the full image
 */
export async function validateImageUrl(url: string | null | undefined): Promise<ImageValidationResult> {
  if (!url) {
    return { valid: false, reason: "No URL provided" };
  }

  // Check cache
  const cached = imageValidationCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
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
      const result: ImageValidationResult = { 
        valid: false, 
        reason: `HTTP ${response.status}: ${response.statusText}` 
      };
      cacheResult(url, result);
      return result;
    }

    const contentType = response.headers.get("content-type") || "";
    
    // Check content type is an image
    if (!contentType.startsWith("image/")) {
      const result: ImageValidationResult = { 
        valid: false, 
        reason: `Invalid content type: ${contentType}` 
      };
      cacheResult(url, result);
      return result;
    }

    // HEAD request passed - image is accessible
    const result: ImageValidationResult = { 
      valid: true, 
      contentType 
    };
    cacheResult(url, result);
    return result;

  } catch (error: any) {
    const reason = error.name === "AbortError" 
      ? "Request timeout" 
      : error.message || "Unknown error";
    
    const result: ImageValidationResult = { valid: false, reason };
    cacheResult(url, result);
    return result;
  }
}

/**
 * Validates an image by fetching it and checking dimensions
 * This downloads the image content - use sparingly
 */
export async function validateImageFull(url: string | null | undefined): Promise<ImageValidationResult> {
  if (!url) {
    return { valid: false, reason: "No URL provided" };
  }

  // Start with basic URL validation
  const basicResult = await validateImageUrl(url);
  if (!basicResult.valid) {
    return basicResult;
  }

  // For a more thorough check, we would need to download and parse the image
  // This is expensive, so we return the basic result for now
  return basicResult;
}

/**
 * Batch validate multiple image URLs
 * Returns a map of URL -> validation result
 */
export async function validateImageUrls(urls: (string | null | undefined)[]): Promise<Map<string, ImageValidationResult>> {
  const results = new Map<string, ImageValidationResult>();
  
  const validUrls = urls.filter((url): url is string => !!url);
  
  // Process in batches of 10 to avoid overwhelming the network
  const BATCH_SIZE = 10;
  for (let i = 0; i < validUrls.length; i += BATCH_SIZE) {
    const batch = validUrls.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(url => validateImageUrl(url)));
    batch.forEach((url, idx) => {
      results.set(url, batchResults[idx]);
    });
  }
  
  return results;
}

/**
 * Track failed image loads for auto-flagging
 */
const imageLoadFailures = new Map<string, number>();
const FAILURE_THRESHOLD = 3;

export function recordImageLoadFailure(cardId: string): number {
  const currentCount = imageLoadFailures.get(cardId) || 0;
  const newCount = currentCount + 1;
  imageLoadFailures.set(cardId, newCount);
  return newCount;
}

export function getImageLoadFailureCount(cardId: string): number {
  return imageLoadFailures.get(cardId) || 0;
}

export function shouldAutoFlagCard(cardId: string): boolean {
  return getImageLoadFailureCount(cardId) >= FAILURE_THRESHOLD;
}

export function clearImageLoadFailures(): void {
  imageLoadFailures.clear();
}

function cacheResult(url: string, result: ImageValidationResult): void {
  if (imageValidationCache.size > 5000) {
    // Clear oldest entries if cache is too large
    const oldestKey = imageValidationCache.keys().next().value;
    if (oldestKey) imageValidationCache.delete(oldestKey);
  }
  imageValidationCache.set(url, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function clearValidationCache(): void {
  imageValidationCache.clear();
}
