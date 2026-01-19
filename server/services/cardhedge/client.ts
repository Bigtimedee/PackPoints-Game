import { z } from "zod";

const CARDHEDGE_BASE_URL = process.env.CARDHEDGE_BASE_URL || "https://api.cardhedger.com";
const CARDHEDGE_TIMEOUT_MS = parseInt(process.env.CARDHEDGE_HTTP_TIMEOUT_MS || "10000", 10);
const MAX_RETRIES = 2;

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
  prices: z.array(z.object({
    grade: z.string(),
    price: z.string(),
  })).optional(),
});

export type CardHedgeCard = z.infer<typeof CardHedgeCardSchema>;

export const CardSearchRequestSchema = z.object({
  search: z.string().optional(),
  set: z.string().optional(),
  category: z.string().optional(),
  player: z.string().optional(),
  rookie: z.boolean().optional(),
  raw_images_only: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  page_size: z.number().int().min(1).max(100).default(20),
});

export type CardSearchRequest = z.infer<typeof CardSearchRequestSchema>;

export const CardSearchSortedRequestSchema = CardSearchRequestSchema.extend({
  sort_by: z.enum(["price", "name", "set", "number"]).optional(),
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
});

export type CardSearchResponse = z.infer<typeof CardSearchResponseSchema>;

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

const httpCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = parseInt(process.env.CARDHEDGE_CACHE_TTL_SECONDS || "3600", 10) * 1000;

function getCacheKey(path: string, body: unknown): string {
  return `${path}:${JSON.stringify(body)}`;
}

function getFromCache<T>(key: string): T | null {
  const entry = httpCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  if (entry) {
    httpCache.delete(key);
  }
  return null;
}

function setInCache<T>(key: string, data: T): void {
  if (httpCache.size > 1000) {
    const oldestKey = httpCache.keys().next().value;
    if (oldestKey) httpCache.delete(oldestKey);
  }
  httpCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
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
      const isRetryable = response.status >= 500 || response.status === 429;
      if (isRetryable && retryCount < MAX_RETRIES) {
        const delay = Math.pow(2, retryCount) * 500;
        await new Promise(resolve => setTimeout(resolve, delay));
        return cardHedgeFetch<T>(path, method, body, {
          useCache,
          retryCount: retryCount + 1,
        });
      }
      throw new CardHedgeError(
        `Card Hedge API error: ${response.status} ${response.statusText}`,
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
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      if (retryCount < MAX_RETRIES) {
        return cardHedgeFetch<T>(path, method, body, {
          useCache,
          retryCount: retryCount + 1,
        });
      }
      throw new CardHedgeError("Card Hedge API request timed out", undefined, true);
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

export function normalizeImageUrl(url: string | undefined): string | null {
  if (!url) return null;
  return url.startsWith("//") ? `https:${url}` : url;
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
