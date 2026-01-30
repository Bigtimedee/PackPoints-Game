import type {
  CardSearchCard,
  CardSearchRequest,
  CardSearchSortedRequest,
  CardSearchResponse,
  ImageSearchRequest,
  ImageSearchResponse,
  CardDetailsRequest,
  CardDetails,
} from "../../../shared/cardhedge/types";
import { TTLCache, hashObject } from "../../utils/cache";
import { pickCardFields, filterPlaceholderCards, normalizeBase64, approxBytesFromBase64 } from "./normalize";

const CARDHEDGE_BASE_URL = "https://api.cardhedger.com";
const DEFAULT_TIMEOUT = 8000;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [250, 750, 1500];
const MAX_BASE64_SIZE = 10 * 1024 * 1024;

const searchCache = new TTLCache<CardSearchResponse>({ maxSize: 500, defaultTTL: 60000 });
const detailsCache = new TTLCache<CardDetails>({ maxSize: 200, defaultTTL: 300000 });

function getApiKey(): string {
  const key = process.env.CARDHEDGE_API_KEY;
  if (!key) {
    throw new CardHedgeError("CARDHEDGE_API_KEY not configured", "CONFIG_ERROR", 503);
  }
  return key;
}

export class CardHedgeError extends Error {
  code: string;
  status: number;
  upstreamBody?: unknown;

  constructor(message: string, code: string, status: number, upstreamBody?: unknown) {
    super(message);
    this.name = "CardHedgeError";
    this.code = code;
    this.status = status;
    this.upstreamBody = upstreamBody;
  }
}

async function postCardHedge<T>(
  path: string,
  body: Record<string, unknown>,
  options: { useCache?: boolean; cacheKey?: string; cacheTTL?: number } = {}
): Promise<T> {
  const { useCache = true, cacheKey, cacheTTL } = options;
  
  const apiKey = getApiKey();
  const url = `${CARDHEDGE_BASE_URL}${path}`;
  const startTime = Date.now();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS[attempt - 1] || 1000);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        
        if (response.status === 429 || response.status === 502 || response.status === 503) {
          lastError = new CardHedgeError(
            `CardHedge API error: ${response.status}`,
            response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_UNAVAILABLE",
            response.status,
            errorBody
          );
          continue;
        }

        throw new CardHedgeError(
          `CardHedge API error: ${response.status} - ${errorBody}`,
          mapStatusToCode(response.status),
          response.status,
          errorBody
        );
      }

      const data = await response.json();
      const latency = Date.now() - startTime;
      
      const sanitizedBody = { ...body };
      delete sanitizedBody.api_key;
      const cardsCount = Array.isArray((data as any)?.cards) ? (data as any).cards.length : 'N/A';
      console.log(`[CardHedge] ${path} completed in ${latency}ms | status: ${response.status} | cards: ${cardsCount} | filters: ${JSON.stringify(sanitizedBody).slice(0, 200)}`);
      
      return data as T;
    } catch (error) {
      clearTimeout(timeout);
      
      if (error instanceof CardHedgeError) {
        lastError = error;
        if (error.status !== 429 && error.status !== 502 && error.status !== 503) {
          throw error;
        }
      } else if (error instanceof Error && error.name === "AbortError") {
        lastError = new CardHedgeError("Request timeout", "TIMEOUT", 504);
      } else {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  throw lastError || new CardHedgeError("Unknown error", "UNKNOWN", 500);
}

function mapStatusToCode(status: number): string {
  switch (status) {
    case 400: return "BAD_REQUEST";
    case 401: return "UNAUTHORIZED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 413: return "IMAGE_TOO_LARGE";
    case 422: return "VALIDATION_ERROR";
    case 429: return "RATE_LIMITED";
    case 502: return "BAD_GATEWAY";
    case 503: return "SERVICE_UNAVAILABLE";
    default: return "UPSTREAM_ERROR";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function cardSearch(
  params: CardSearchRequest,
  options: { rawImagesOnly?: boolean; filterPlaceholders?: boolean } = {}
): Promise<CardSearchResponse> {
  const { rawImagesOnly = true, filterPlaceholders = true } = options;
  
  const body: Record<string, unknown> = {
    page: params.page || 1,
    page_size: Math.min(Math.max(params.page_size || 50, 1), 100),
    raw_images_only: params.raw_images_only ?? rawImagesOnly,
  };

  if (params.search) body.search = params.search;
  if (params.set) body.set = params.set;
  if (params.category) body.category = params.category;
  if (params.player) body.player = params.player;
  if (params.rookie !== null && params.rookie !== undefined) {
    body.rookie = params.rookie === true || params.rookie === "Rookie";
  }

  const cacheKey = `search:${hashObject(body)}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    console.log("[CardHedge] Cache hit for search");
    return cached;
  }

  const raw = await postCardHedge<{ pages?: number; count?: number; cards?: unknown[] }>(
    "/v1/cards/card-search",
    body
  );

  let cards = (raw.cards || []).map(c => pickCardFields(c as Record<string, unknown>));
  
  const beforeFilter = cards.length;
  if (filterPlaceholders) {
    cards = filterPlaceholderCards(cards);
  }
  
  console.log(`[CardHedge] Search: ${beforeFilter} cards returned, ${cards.length} after filter`);

  const result: CardSearchResponse = {
    pages: raw.pages || 1,
    count: raw.count || cards.length,
    cards,
  };

  searchCache.set(cacheKey, result);
  return result;
}

export async function cardSearchSorted(
  params: CardSearchSortedRequest,
  options: { rawImagesOnly?: boolean; filterPlaceholders?: boolean } = {}
): Promise<CardSearchResponse> {
  const { rawImagesOnly = true, filterPlaceholders = true } = options;
  
  const body: Record<string, unknown> = {
    page: params.page || 1,
    page_size: Math.min(Math.max(params.page_size || 50, 1), 100),
    raw_images_only: params.raw_images_only ?? rawImagesOnly,
  };

  if (params.search) body.search = params.search;
  if (params.set) body.set = params.set;
  if (params.category) body.category = params.category;
  if (params.player) body.player = params.player;
  if (params.rookie !== null && params.rookie !== undefined) {
    body.rookie = params.rookie === true || params.rookie === "Rookie";
  }
  if (params.sort_by) body.sort_by = params.sort_by;
  if (params.sort_order) body.sort_order = params.sort_order;

  const cacheKey = `sorted:${hashObject(body)}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    console.log("[CardHedge] Cache hit for sorted search");
    return cached;
  }

  const raw = await postCardHedge<{ pages?: number; count?: number; cards?: unknown[] }>(
    "/v1/cards/search-cards-wsort",
    body
  );

  let cards = (raw.cards || []).map(c => pickCardFields(c as Record<string, unknown>));
  
  const beforeFilter = cards.length;
  if (filterPlaceholders) {
    cards = filterPlaceholderCards(cards);
  }
  
  console.log(`[CardHedge] Sorted search: ${beforeFilter} cards returned, ${cards.length} after filter`);

  const result: CardSearchResponse = {
    pages: raw.pages || 1,
    count: raw.count || cards.length,
    cards,
  };

  searchCache.set(cacheKey, result);
  return result;
}

export async function imageSearch(params: ImageSearchRequest): Promise<ImageSearchResponse> {
  const body: Record<string, unknown> = {
    k: Math.min(Math.max(params.k || 10, 1), 50),
  };

  if (params.image_url) {
    body.image_url = params.image_url;
  }

  if (params.image_base64) {
    const normalized = normalizeBase64(params.image_base64);
    const size = approxBytesFromBase64(normalized);
    
    if (size > MAX_BASE64_SIZE) {
      throw new CardHedgeError(
        `Image too large: ${Math.round(size / 1024 / 1024)}MB exceeds 10MB limit`,
        "IMAGE_TOO_LARGE",
        413
      );
    }
    
    body.image_base64 = normalized;
  }

  if (!body.image_url && !body.image_base64) {
    throw new CardHedgeError(
      "Either image_url or image_base64 is required",
      "MISSING_IMAGE_INPUT",
      400
    );
  }

  const raw = await postCardHedge<ImageSearchResponse>("/v1/cards/image-search", body);
  
  console.log(`[CardHedge] Image search: ${raw.total_results} results, has_matches=${raw.has_cardhedge_matches}`);
  
  return raw;
}

export async function cardDetails(params: CardDetailsRequest): Promise<CardDetails> {
  const cacheKey = `details:${params.card_id}`;
  const cached = detailsCache.get(cacheKey);
  if (cached) {
    console.log("[CardHedge] Cache hit for card details");
    return cached;
  }

  const body: Record<string, unknown> = {
    card_id: params.card_id,
    raw_images_only: params.raw_images_only ?? true,
  };

  const raw = await postCardHedge<{ cards?: unknown[] }>("/v1/cards/card-details", body);

  const cards = (raw.cards || []).map(c => pickCardFields(c as Record<string, unknown>));
  const result: CardDetails = { cards: filterPlaceholderCards(cards) };

  detailsCache.set(cacheKey, result);
  return result;
}

export function clearCardHedgeCache(): void {
  searchCache.clear();
  detailsCache.clear();
}
