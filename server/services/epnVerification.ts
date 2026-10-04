import { timingSafeEqual } from "node:crypto";

// The partner callback must pass through a verified relay that supplies this header.
// Fail closed until that relay and EPN_POSTBACK_SECRET are configured.
export function verifyEpnSecret(secret: string | undefined, supplied: unknown): boolean {
  if (!secret || secret.length < 32 || typeof supplied !== "string") return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseEpnMoney(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function canonicalEbayItem(value: string): string {
  const restId = /^v1\|(\d+)\|\d+$/.exec(value);
  return restId ? restId[1] : value;
}

export function matchesEpnIntent(
  intent: { userId: string; source: string; listingId: string; priceCents: number; currency: string; createdAt: Date | null },
  click: { id: string; userId: string | null; source: string; listingId: string; createdAt: Date | null },
  salePriceCents: number,
): boolean {
  return !!click.id && !!click.userId && intent.userId === click.userId &&
    intent.source === "ebay" && click.source === "ebay" &&
    canonicalEbayItem(intent.listingId) === canonicalEbayItem(click.listingId) &&
    intent.currency.toUpperCase() === "USD" && intent.priceCents === salePriceCents &&
    !!intent.createdAt && !!click.createdAt && click.createdAt >= intent.createdAt;
}
