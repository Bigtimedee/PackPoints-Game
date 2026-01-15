import crypto from "crypto";
import { db } from "../../db";
import { outboundClicks } from "@shared/schema";
import type { MarketplaceSource, OutboundTokenPayload } from "./types";

const TOKEN_SECRET = process.env.EPN_CUSTOM_ID_SALT || "packpts-outbound-secret";
const TOKEN_EXPIRY_SECONDS = 3600;

export function generateOutboundToken(payload: Omit<OutboundTokenPayload, "expiresAt">): string {
  const tokenPayload: OutboundTokenPayload = {
    ...payload,
    expiresAt: Date.now() + TOKEN_EXPIRY_SECONDS * 1000,
  };

  const data = JSON.stringify(tokenPayload);
  const encoded = Buffer.from(data).toString("base64url");
  const signature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${signature}`;
}

export function validateOutboundToken(token: string): OutboundTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encoded, signature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(encoded)
    .digest("base64url");

  if (signature !== expectedSignature) return null;

  try {
    const data = Buffer.from(encoded, "base64url").toString("utf-8");
    const payload: OutboundTokenPayload = JSON.parse(data);

    if (payload.expiresAt < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

export async function logOutboundClick(
  source: MarketplaceSource,
  listingId: string,
  destinationUrl: string,
  userId: string | null,
  sessionId: string | null,
  ip: string | null,
  userAgent: string | null
): Promise<void> {
  try {
    await db.insert(outboundClicks).values({
      source,
      listingId,
      destinationUrl,
      userId,
      sessionId,
      ip,
      userAgent,
    });
  } catch (error) {
    console.error("[Outbound] Failed to log click:", error);
  }
}

export function applyEpnTracking(url: string, userId?: string | null): string {
  const campaignId = process.env.EPN_CAMPAIGN_ID;
  if (!campaignId) return url;

  const urlObj = new URL(url);
  urlObj.searchParams.set("campid", campaignId);
  urlObj.searchParams.set("toolid", "10001");

  if (userId) {
    const customId = crypto
      .createHmac("sha256", TOKEN_SECRET)
      .update(userId)
      .digest("hex")
      .substring(0, 16);
    urlObj.searchParams.set("customid", customId);
  }

  return urlObj.toString();
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
