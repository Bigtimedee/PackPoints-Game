export type MarketplaceSource = "ebay" | "goldin";

export interface ListingPrice {
  amount: number;
  currency: string;
}

export interface ListingShipping {
  amount?: number;
  currency?: string;
  type?: string;
}

export interface Listing {
  source: MarketplaceSource;
  listingId: string;
  title: string;
  imageUrl?: string;
  price: ListingPrice | null;
  shipping?: ListingShipping | null;
  condition?: string | null;
  endTime?: string | null;
  url: string;
  lastUpdated: string;
}

export interface SearchParams {
  q: string;
  source?: MarketplaceSource | "all";
  limit?: number;
  sort?: "relevance" | "priceAsc" | "priceDesc" | "endingSoon";
}

export interface SearchResult {
  listings: Listing[];
  lastUpdated: string;
  sourceBreakdown: {
    ebay: number;
    goldin: number;
  };
  cached: boolean;
}

export interface OutboundTokenPayload {
  source: MarketplaceSource;
  listingId: string;
  destinationUrl: string;
  expiresAt: number;
}
