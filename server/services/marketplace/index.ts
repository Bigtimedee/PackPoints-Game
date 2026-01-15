import { getOrSetCache } from "./cache";
import { searchEbayListings, isEbayConfigured } from "./ebay";
import { getCuratedGoldinListings, getAllCuratedGoldinListings } from "./goldin";
import type { Listing, SearchParams, SearchResult, MarketplaceSource } from "./types";
import { db } from "../../db";
import { externalListingsSnapshot } from "@shared/schema";

const DEFAULT_CACHE_TTL = 300;

export async function searchMarketplace(params: SearchParams): Promise<SearchResult> {
  const source = params.source || "all";
  const limit = params.limit || 20;
  const cacheKey = `search:${source}:${params.q}:${limit}:${params.sort || "relevance"}`;

  let ebayListings: Listing[] = [];
  let goldinListings: Listing[] = [];
  let lastUpdated = new Date().toISOString();
  let cached = false;

  if (source === "all" || source === "ebay") {
    if (isEbayConfigured()) {
      try {
        const ebayResult = await getOrSetCache<Listing[]>(
          "ebay",
          cacheKey,
          DEFAULT_CACHE_TTL,
          () => searchEbayListings(params)
        );
        ebayListings = ebayResult.data;
        lastUpdated = ebayResult.lastUpdated;
        cached = ebayResult.cached;
      } catch (error) {
        console.error("[Marketplace] eBay search failed:", error);
      }
    }
  }

  if (source === "all" || source === "goldin") {
    try {
      goldinListings = await getCuratedGoldinListings(params);
    } catch (error) {
      console.error("[Marketplace] Goldin search failed:", error);
    }
  }

  let allListings = [...ebayListings, ...goldinListings];

  if (params.sort === "priceAsc") {
    allListings.sort((a, b) => (a.price?.amount || 0) - (b.price?.amount || 0));
  } else if (params.sort === "priceDesc") {
    allListings.sort((a, b) => (b.price?.amount || 0) - (a.price?.amount || 0));
  } else if (params.sort === "endingSoon") {
    allListings.sort((a, b) => {
      if (!a.endTime) return 1;
      if (!b.endTime) return -1;
      return new Date(a.endTime).getTime() - new Date(b.endTime).getTime();
    });
  }

  allListings = allListings.slice(0, limit);

  await captureSnapshot(source === "all" ? "ebay" : source, params.q, allListings);

  return {
    listings: allListings,
    lastUpdated,
    sourceBreakdown: {
      ebay: ebayListings.length,
      goldin: goldinListings.length,
    },
    cached,
  };
}

async function captureSnapshot(
  source: MarketplaceSource,
  query: string,
  listings: Listing[]
): Promise<void> {
  if (listings.length === 0) return;

  const prices = listings
    .filter((l) => l.price?.amount)
    .map((l) => Math.round((l.price?.amount || 0) * 100));

  try {
    await db.insert(externalListingsSnapshot).values({
      source,
      query,
      listingCount: listings.length,
      minPriceCents: prices.length > 0 ? Math.min(...prices) : null,
      maxPriceCents: prices.length > 0 ? Math.max(...prices) : null,
    });
  } catch (error) {
    console.error("[Marketplace] Failed to capture snapshot:", error);
  }
}

export * from "./types";
export * from "./goldin";
export * from "./ebay";
export * from "./cache";
export * from "./outbound";
