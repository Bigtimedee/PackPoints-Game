import crypto from "crypto";
import { db } from "../../db";
import { outboundClicks } from "@shared/schema";
import type { MarketplaceSource, OutboundTokenPayload } from "./types";

const TOKEN_EXPIRY_SECONDS = 3600;

function getTokenSecret(): string {
  const secret = process.env.OUTBOUND_SECRET;
  if (!secret) {
    throw new Error("[Outbound] OUTBOUND_SECRET environment variable is required for secure token signing");
  }
  return secret;
}

export function generateOutboundToken(payload: Omit<OutboundTokenPayload, "expiresAt">): string {
  const tokenPayload: OutboundTokenPayload = {
    ...payload,
    expiresAt: Date.now() + TOKEN_EXPIRY_SECONDS * 1000,
  };

  const data = JSON.stringify(tokenPayload);
  const encoded = Buffer.from(data).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getTokenSecret())
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${signature}`;
}

export function validateOutboundToken(token: string): OutboundTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [encoded, signature] = parts;
    const expectedSignature = crypto
      .createHmac("sha256", getTokenSecret())
      .update(encoded)
      .digest("base64url");

    if (signature !== expectedSignature) return null;

    const data = Buffer.from(encoded, "base64url").toString("utf-8");
    const payload: OutboundTokenPayload = JSON.parse(data);

    if (payload.expiresAt < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Hash an IP address for privacy-safe storage
 */
export function hashIp(ip: string): string {
  const salt = process.env.OUTBOUND_SECRET || "packpts-salt";
  return crypto
    .createHmac("sha256", salt)
    .update(ip)
    .digest("hex");
}

export interface OutboundClickData {
  source: MarketplaceSource;
  listingId: string;
  destinationUrl: string;
  outboundUrl?: string;
  customId?: string;
  userId: string | null;
  sessionId: string | null;
  ip: string | null;
  userAgent: string | null;
  referrer?: string | null;
  pagePath?: string | null;
  cardSetId?: string | null;
  cardId?: string | null;
}

export async function logOutboundClick(data: OutboundClickData): Promise<void> {
  try {
    await db.insert(outboundClicks).values({
      source: data.source,
      listingId: data.listingId,
      destinationUrl: data.destinationUrl,
      outboundUrl: data.outboundUrl,
      customId: data.customId,
      userId: data.userId,
      sessionId: data.sessionId,
      ip: null,
      ipHash: data.ip ? hashIp(data.ip) : null,
      userAgent: data.userAgent,
      referrer: data.referrer,
      pagePath: data.pagePath,
      cardSetId: data.cardSetId,
      cardId: data.cardId,
    });
  } catch (error) {
    console.error("[Outbound] Failed to log click:", error);
  }
}

// EPN Affiliate Config
const EPN_CONFIG = {
  get campId() {
    return process.env.EPN_CAMPID;
  },
  get customIdPrefix() {
    return process.env.EPN_CUSTOMID_PREFIX || "packpts";
  },
  get mkcid() {
    return process.env.EPN_MKCID;
  },
  get mksid() {
    return process.env.EPN_MKSID;
  },
};

/**
 * Build a fully-qualified EPN affiliate URL with tracking parameters
 */
export function buildEpnEbayUrl(opts: {
  baseEbayUrl: string;
  campid: string;
  customid: string;
  mkcid?: string;
  mksid?: string;
}): string {
  const urlObj = new URL(opts.baseEbayUrl);
  urlObj.searchParams.set("campid", opts.campid);
  urlObj.searchParams.set("toolid", "10001");
  urlObj.searchParams.set("customid", opts.customid);
  
  if (opts.mkcid) {
    urlObj.searchParams.set("mkcid", opts.mkcid);
  }
  if (opts.mksid) {
    urlObj.searchParams.set("mksid", opts.mksid);
  }
  
  return urlObj.toString();
}

/**
 * Generate a unique customId for EPN tracking attribution
 * Format: prefix:u_userId:i_itemId:t_timestamp
 */
export function generateEpnCustomId(
  userId: string | null,
  itemId: string
): string {
  const prefix = EPN_CONFIG.customIdPrefix;
  const userPart = userId ? `u_${userId.substring(0, 12)}` : "u_anon";
  const itemPart = `i_${itemId.substring(0, 16)}`;
  const timePart = `t_${Date.now()}`;
  return `${prefix}:${userPart}:${itemPart}:${timePart}`;
}

/**
 * Normalize an eBay item reference to a canonical URL
 */
export function normalizeEbayUrl(itemIdOrUrl: string): string {
  // If it's just digits, it's an item ID
  if (/^\d+$/.test(itemIdOrUrl)) {
    return `https://www.ebay.com/itm/${itemIdOrUrl}`;
  }
  // Otherwise treat as URL
  return itemIdOrUrl;
}

export function applyEpnTracking(
  url: string, 
  userId: string | null = null,
  itemId?: string
): string {
  const campaignId = EPN_CONFIG.campId;
  if (!campaignId) {
    console.warn("[EPN] Missing EPN_CAMPID - affiliate tracking disabled");
    return url;
  }

  // Extract item ID from URL if not provided
  const extractedItemId = itemId || extractItemIdFromUrl(url) || "unknown";
  
  const customId = generateEpnCustomId(userId, extractedItemId);
  
  return buildEpnEbayUrl({
    baseEbayUrl: url,
    campid: campaignId,
    customid: customId,
    mkcid: EPN_CONFIG.mkcid,
    mksid: EPN_CONFIG.mksid,
  });
}

/**
 * Extract eBay item ID from a URL
 */
function extractItemIdFromUrl(url: string): string | null {
  try {
    const match = url.match(/\/itm\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function generateListingWithOutboundUrl(
  listing: { source: MarketplaceSource; listingId: string; url: string },
  baseUrl: string
): string {
  const token = generateOutboundToken({
    source: listing.source,
    listingId: listing.listingId,
    destinationUrl: listing.url,
  });

  return `${baseUrl}/out/${listing.source}/${listing.listingId}?token=${encodeURIComponent(token)}`;
}
