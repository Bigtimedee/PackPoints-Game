import { z } from "zod";

const CARDHEDGE_BASE_URL = process.env.CARDHEDGE_BASE_URL || "https://api.cardhedger.com";
const CARDHEDGE_TIMEOUT_MS = parseInt(process.env.CARDHEDGE_HTTP_TIMEOUT_MS || "10000", 10);
const MAX_RETRIES = 3; // Default retries
const MAX_RETRIES_503 = 5; // Extra retries for 503 (service temporarily unavailable)

export const CardHedgeCardSchema = z.object({
  card_id: z.string().optional(),
  description: z.string().optional(),
  player: z.string().optional(),
  set: z.string().optional(),
  number: z.string().optional(),
  variant: z.string().optional(),
  image: z.string().optional(),
  category: z.string().optional(),
  category_group: z.string().optional(),
  set_type: z.string().optional(),
  rookie: z.boolean().optional(),
  "7 Day Sales": z.number().optional(),
  "30 Day Sales": z.number().optional(),
  gain: z.number().optional(),
  gain_30day: z.number().optional(),
  prices: z.array(z.object({
    grade: z.string(),
    price: z.string(),
  })).optional(),
});

export type CardHedgeCard = z.infer<typeof CardHedgeCardSchema>;

export const CardSearchRequestSchema = z.object({
  search: z.string().nullable().optional(),
  set: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  player: z.string().nullable().optional(),
  rookie: z.boolean().nullable().optional(),
  raw_images_only: z.boolean().nullable().optional(),
  page: z.number().int().min(1).default(1),
  page_size: z.number().int().min(1).max(100).default(20),
});

export type CardSearchRequest = z.infer<typeof CardSearchRequestSchema>;

export const CardSearchSortedRequestSchema = CardSearchRequestSchema.extend({
  sort_by: z.enum(["gain", "gain_30day", "sales", "sales_7day", "sales_30day", "price", "description"]).optional(),
  sort_order: z.enum(["asc", "desc"]).optional(),
}).refine(
  (data) => data.search || data.set || data.category || data.player,
  { message: "At least one of search, set, category, or player is required" }
);

export type CardSearchSortedRequest = z.infer<typeof CardSearchSortedRequestSchema>;

export const CardDetailsRequestSchema = z.object({
  card_id: z.string(),
  raw_images_only: z.boolean().optional(),
});

export type CardDetailsRequest = z.infer<typeof CardDetailsRequestSchema>;

export const CardSearchResponseSchema = z.object({
  cards: z.array(CardHedgeCardSchema),
  page: z.number().optional(),
  pages: z.number().optional(),
  total: z.number().optional(),
  count: z.number().optional(),
});

export type CardSearchResponse = z.infer<typeof CardSearchResponseSchema>;

export interface NormalizedCardSearchResult {
  cardId: string;
  description: string | null;
  player: string | null;
  set: string | null;
  number: string | null;
  variant: string | null;
  category: string | null;
  categoryGroup: string | null;
  setType: string | null;
  imageUrl: string | null;
  rookie: boolean;
  sales7d: number | null;
  sales30d: number | null;
  gain: number | null;
  gain30d: number | null;
  prices: Array<{ grade: string; price: string }>;
  raw: CardHedgeCard;
}

export interface NormalizedCardSearchResponse {
  pages: number;
  count: number;
  cards: NormalizedCardSearchResult[];
}

export const CardDetailsResponseSchema = z.object({
  cards: z.array(CardHedgeCardSchema),
});

export type CardDetailsResponse = z.infer<typeof CardDetailsResponseSchema>;

export interface NormalizedCardDetails {
  cardId: string;
  description: string | null;
  player: string | null;
  set: string | null;
  number: string | null;
  variant: string | null;
  category: string | null;
  categoryGroup: string | null;
  setType: string | null;
  imageUrl: string | null;
  rookie: boolean;
  sales7d: number | null;
  sales30d: number | null;
  gain: number | null;
  gain30d: number | null;
  prices: Array<{ grade: string; price: string }>;
  raw: CardHedgeCard;
}

export class CardHedgeError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public isRetryable: boolean = false
  ) {
    super(message);
    this.name = "CardHedgeError";
  }
}

const httpCache = new Map<string, { data: unknown; expiresAt: number; staleAt: number }>();
const CACHE_TTL_MS = parseInt(process.env.CARDHEDGE_CACHE_TTL_SECONDS || "3600", 10) * 1000;
const STALE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Keep stale data for 24 hours as fallback

function getCacheKey(path: string, body: unknown): string {
  return `${path}:${JSON.stringify(body)}`;
}

function getFromCache<T>(key: string, allowStale: boolean = false): T | null {
  const entry = httpCache.get(key);
  if (!entry) return null;
  
  const now = Date.now();
  
  // Return fresh data
  if (entry.expiresAt > now) {
    return entry.data as T;
  }
  
  // Return stale data as fallback if allowed and not too old
  if (allowStale && entry.staleAt > now) {
    console.log(`[CardHedge] Using stale cache for ${key}`);
    return entry.data as T;
  }
  
  // Data is too old, clean up
  if (entry.staleAt <= now) {
    httpCache.delete(key);
  }
  
  return null;
}

function setInCache<T>(key: string, data: T): void {
  if (httpCache.size > 1000) {
    const oldestKey = httpCache.keys().next().value;
    if (oldestKey) httpCache.delete(oldestKey);
  }
  httpCache.set(key, { 
    data, 
    expiresAt: Date.now() + CACHE_TTL_MS,
    staleAt: Date.now() + STALE_CACHE_TTL_MS
  });
}

export async function cardHedgeFetch<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  options?: { useCache?: boolean; retryCount?: number }
): Promise<T> {
  const apiKey = process.env.CARDHEDGE_API_KEY;
  if (!apiKey) {
    throw new CardHedgeError("CARDHEDGE_API_KEY is not configured");
  }

  const useCache = options?.useCache ?? true;
  const retryCount = options?.retryCount ?? 0;
  const cacheKey = getCacheKey(path, body);

  if (useCache && method === "POST") {
    const cached = getFromCache<T>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CARDHEDGE_TIMEOUT_MS);

  try {
    const url = `${CARDHEDGE_BASE_URL}${path}`;
    
    // Log request details for debugging
    console.log(`[CardHedge] ${method} ${path}`, {
      body: body ? JSON.stringify(body) : undefined,
      retry: retryCount,
    });
    
    const response = await fetch(url, {
      method,
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Try to get the response body for better error diagnostics
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch (e) {
        errorBody = "Unable to read response body";
      }
      
      console.error(`[CardHedge] API Error: ${response.status} ${response.statusText}`, {
        path,
        body,
        errorBody,
        retry: retryCount,
      });
      
      const isRetryable = response.status >= 500 || response.status === 429;
      const maxRetries = response.status === 503 ? MAX_RETRIES_503 : MAX_RETRIES;
      if (isRetryable && retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 500;
        console.log(`[CardHedge] Retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return cardHedgeFetch<T>(path, method, body, {
          useCache,
          retryCount: retryCount + 1,
        });
      }
      
      // Try stale cache as fallback for server errors
      if (isRetryable && useCache && method === "POST") {
        const staleData = getFromCache<T>(cacheKey, true);
        if (staleData) {
          console.log(`[CardHedge] API unavailable, using stale cache fallback`);
          return staleData;
        }
      }
      
      throw new CardHedgeError(
        `Card Hedge API error: ${response.status} ${response.statusText} - ${errorBody}`,
        response.status,
        isRetryable
      );
    }

    const data = await response.json() as T;

    if (useCache && method === "POST") {
      setInCache(cacheKey, data);
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof CardHedgeError) {
      // For retryable CardHedgeErrors, try stale cache before re-throwing
      if (error.isRetryable && useCache && method === "POST") {
        const staleData = getFromCache<T>(cacheKey, true);
        if (staleData) {
          console.log(`[CardHedge] API error, using stale cache fallback`);
          return staleData;
        }
      }
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      if (retryCount < MAX_RETRIES) {
        return cardHedgeFetch<T>(path, method, body, {
          useCache,
          retryCount: retryCount + 1,
        });
      }
      // Try stale cache for timeout errors
      if (useCache && method === "POST") {
        const staleData = getFromCache<T>(cacheKey, true);
        if (staleData) {
          console.log(`[CardHedge] Request timed out, using stale cache fallback`);
          return staleData;
        }
      }
      throw new CardHedgeError("Card Hedge API request timed out", undefined, true);
    }
    
    // Try stale cache for network errors
    if (useCache && method === "POST") {
      const staleData = getFromCache<T>(cacheKey, true);
      if (staleData) {
        console.log(`[CardHedge] Network error, using stale cache fallback`);
        return staleData;
      }
    }
    
    throw new CardHedgeError(
      `Card Hedge API request failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function cardSearch(request: CardSearchRequest): Promise<CardSearchResponse> {
  const validated = CardSearchRequestSchema.parse(request);
  return cardHedgeFetch<CardSearchResponse>("/v1/cards/card-search", "POST", validated);
}

export async function cardSearchSorted(request: CardSearchSortedRequest): Promise<CardSearchResponse> {
  const validated = CardSearchSortedRequestSchema.parse(request);
  return cardHedgeFetch<CardSearchResponse>("/v1/cards/search-cards-wsort", "POST", validated);
}

export async function cardDetails(request: CardDetailsRequest): Promise<CardDetailsResponse> {
  const validated = CardDetailsRequestSchema.parse(request);
  return cardHedgeFetch<CardDetailsResponse>("/v1/cards/card-details", "POST", validated);
}

export function normalizeCardDetails(card: CardHedgeCard): NormalizedCardDetails {
  return {
    cardId: card.card_id || "",
    description: card.description || null,
    player: card.player || null,
    set: card.set || null,
    number: card.number || null,
    variant: card.variant || null,
    category: card.category || null,
    categoryGroup: card.category_group || null,
    setType: card.set_type || null,
    imageUrl: normalizeImageUrl(card.image),
    rookie: card.rookie || false,
    sales7d: card["7 Day Sales"] ?? null,
    sales30d: card["30 Day Sales"] ?? null,
    gain: card.gain ?? null,
    gain30d: card.gain_30day ?? null,
    prices: card.prices || [],
    raw: card,
  };
}

export async function fetchCardDetailsNormalized(
  cardId: string,
  rawImagesOnly?: boolean
): Promise<NormalizedCardDetails | null> {
  const response = await cardDetails({ card_id: cardId, raw_images_only: rawImagesOnly });
  if (!response.cards || response.cards.length === 0) {
    return null;
  }
  return normalizeCardDetails(response.cards[0]);
}

export function normalizeImageUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  
  // Trim whitespace
  let normalized = url.trim();
  if (!normalized) return null;
  
  // Handle protocol-relative URLs (//s3.amazonaws.com/...)
  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  }
  
  // Convert http to https for security
  if (normalized.startsWith("http://")) {
    normalized = normalized.replace("http://", "https://");
  }
  
  // Validate it's a proper URL
  if (!normalized.startsWith("https://") && !normalized.startsWith("http://")) {
    // Not a valid URL scheme
    return null;
  }
  
  return normalized;
}

export function isCardHedgeConfigured(): boolean {
  return !!process.env.CARDHEDGE_API_KEY;
}

export function clearCache(): void {
  httpCache.clear();
}

export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: httpCache.size,
    keys: Array.from(httpCache.keys()),
  };
}

export function normalizeCardSearchResponse(response: CardSearchResponse): NormalizedCardSearchResponse {
  return {
    pages: response.pages || 1,
    count: response.count || response.total || response.cards?.length || 0,
    cards: (response.cards || []).map(card => ({
      cardId: card.card_id || "",
      description: card.description || null,
      player: card.player || null,
      set: card.set || null,
      number: card.number || null,
      variant: card.variant || null,
      category: card.category || null,
      categoryGroup: card.category_group || null,
      setType: card.set_type || null,
      imageUrl: normalizeImageUrl(card.image),
      rookie: card.rookie || false,
      sales7d: card["7 Day Sales"] ?? null,
      sales30d: card["30 Day Sales"] ?? null,
      gain: card.gain ?? null,
      gain30d: card.gain_30day ?? null,
      prices: card.prices || [],
      raw: card,
    })),
  };
}

export async function cardSearchNormalized(
  request: CardSearchRequest
): Promise<NormalizedCardSearchResponse> {
  const response = await cardSearch(request);
  return normalizeCardSearchResponse(response);
}

export interface PlayableCardSearchOptions {
  category?: string;
  set?: string;
  rookie?: boolean;
  minSales7d?: number;
  maxGain?: number;
  page?: number;
  pageSize?: number;
}

export async function getPlayableCardSearchResults(
  options: PlayableCardSearchOptions = {}
): Promise<NormalizedCardSearchResponse> {
  const request: CardSearchRequest = {
    category: options.category || "Baseball",
    set: options.set,
    rookie: options.rookie,
    raw_images_only: true,
    page: options.page || 1,
    page_size: options.pageSize || 100,
  };
  
  const response = await cardSearchNormalized(request);
  
  let filteredCards = response.cards;
  if (options.minSales7d !== undefined) {
    filteredCards = filteredCards.filter(c => (c.sales7d ?? 0) >= options.minSales7d!);
  }
  if (options.maxGain !== undefined) {
    filteredCards = filteredCards.filter(c => c.gain === null || c.gain <= options.maxGain!);
  }
  
  return {
    ...response,
    cards: filteredCards,
    count: filteredCards.length,
  };
}

export const ImageSearchRequestSchema = z.object({
  image_url: z.string().nullable().optional(),
  image_base64: z.string().nullable().optional(),
  k: z.number().int().min(1).max(50).default(10),
}).refine(
  (data) => data.image_url || data.image_base64,
  { message: "Either image_url or image_base64 is required" }
);

export type ImageSearchRequest = z.infer<typeof ImageSearchRequestSchema>;

export interface ImageSearchCardData {
  card_id: string;
  description?: string;
  player?: string;
  set?: string;
  number?: string;
}

export interface ImageSearchResultItem {
  similarity: string;
  distance: number;
  ximilar_id?: string;
  product_id?: string | null;
  card_data?: ImageSearchCardData | null;
}

export interface ImageSearchResponse {
  success: boolean;
  results: ImageSearchResultItem[];
  total_results: number;
  query_id: string;
  has_cardhedge_matches: boolean;
  message?: string | null;
}

const MAX_BASE64_SIZE = 10 * 1024 * 1024;

function normalizeBase64(input: string): string {
  if (!input) return "";
  const prefixMatch = input.match(/^data:image\/[^;]+;base64,/);
  if (prefixMatch) {
    return input.slice(prefixMatch[0].length);
  }
  return input;
}

function approxBytesFromBase64(b64: string): number {
  const normalized = normalizeBase64(b64);
  const padding = (normalized.match(/=+$/) || [""])[0].length;
  return Math.floor((normalized.length * 3) / 4) - padding;
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
        413,
        false
      );
    }
    
    body.image_base64 = normalized;
  }

  if (!body.image_url && !body.image_base64) {
    throw new CardHedgeError(
      "Either image_url or image_base64 is required",
      400,
      false
    );
  }

  const raw = await cardHedgeFetch<ImageSearchResponse>(
    "/v1/cards/image-search",
    "POST",
    body,
    { useCache: false }
  );
  
  console.log(`[CardHedge] Image search: ${raw.total_results} results, has_matches=${raw.has_cardhedge_matches}`);
  
  return raw;
}

export interface ImageSearchWithBestMatch extends ImageSearchResponse {
  best_match?: { card_id: string; similarity: number };
}

export async function imageSearchWithBestMatch(params: ImageSearchRequest): Promise<ImageSearchWithBestMatch> {
  const result = await imageSearch(params);
  const response: ImageSearchWithBestMatch = { ...result };

  if (result.results && result.results.length > 0) {
    const sorted = [...result.results].sort((a, b) => 
      parseFloat(b.similarity) - parseFloat(a.similarity)
    );
    
    const best = sorted[0];
    const similarity = parseFloat(best.similarity);
    
    if (similarity >= 85 && best.card_data?.card_id) {
      response.best_match = {
        card_id: best.card_data.card_id,
        similarity,
      };
    }
  }

  return response;
}
