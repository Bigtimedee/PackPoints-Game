import type { Listing, SearchParams } from "./types";

const EBAY_API_URL = process.env.EBAY_ENV === "production"
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getEbayAccessToken(): Promise<string> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const scope = process.env.EBAY_OAUTH_SCOPE_BROWSE || "https://api.ebay.com/oauth/api_scope";

  if (!clientId || !clientSecret) {
    throw new Error("eBay credentials not configured");
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  
  const response = await fetch(`${EBAY_API_URL}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`,
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[eBay] Token request failed:", error);
    throw new Error("Failed to obtain eBay access token");
  }

  const data = await response.json();
  
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };

  return cachedToken.token;
}

interface EbayItemSummary {
  itemId: string;
  title: string;
  image?: { imageUrl: string };
  price?: { value: string; currency: string };
  shippingOptions?: Array<{
    shippingCost?: { value: string; currency: string };
    type?: string;
  }>;
  condition?: string;
  itemEndDate?: string;
  itemWebUrl: string;
}

interface EbaySearchResponse {
  itemSummaries?: EbayItemSummary[];
  total?: number;
}

export async function searchEbayListings(params: SearchParams): Promise<Listing[]> {
  const token = await getEbayAccessToken();
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
  const limit = Math.min(params.limit || 20, 50);

  let sortParam = "";
  switch (params.sort) {
    case "priceAsc":
      sortParam = "&sort=price";
      break;
    case "priceDesc":
      sortParam = "&sort=-price";
      break;
    case "endingSoon":
      sortParam = "&sort=endingSoonest";
      break;
    default:
      sortParam = "";
  }

  const searchUrl = `${EBAY_API_URL}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(params.q)}&limit=${limit}${sortParam}&category_ids=212`;

  const response = await fetch(searchUrl, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[eBay] Search failed:", error);
    throw new Error("eBay search failed");
  }

  const data: EbaySearchResponse = await response.json();
  
  if (!data.itemSummaries) {
    return [];
  }

  return data.itemSummaries.map((item) => normalizeEbayListing(item));
}

function normalizeEbayListing(item: EbayItemSummary): Listing {
  const shipping = item.shippingOptions?.[0];
  
  return {
    source: "ebay",
    listingId: item.itemId,
    title: item.title,
    imageUrl: item.image?.imageUrl,
    price: item.price
      ? {
          amount: parseFloat(item.price.value),
          currency: item.price.currency,
        }
      : null,
    shipping: shipping?.shippingCost
      ? {
          amount: parseFloat(shipping.shippingCost.value),
          currency: shipping.shippingCost.currency,
          type: shipping.type,
        }
      : null,
    condition: item.condition || null,
    endTime: item.itemEndDate || null,
    url: item.itemWebUrl,
    lastUpdated: new Date().toISOString(),
  };
}

export function isEbayConfigured(): boolean {
  return !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}
