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

/**
 * EPN postback item fields can be a list when the template uses
 * {join(items...)} (e.g. "407243534695,123" or "[407243534695|0]"). Split into
 * canonical eBay item ids.
 */
export function epnItemList(raw: string | undefined | null): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .replace(/[\[\]"']/g, " ")
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => canonicalEbayItem(v.startsWith("v1|") ? v : v.replace(/\|\d+$/, "")));
}

/** Money list aligned with epnItemList (e.g. "1.49,3.00"); "1.49 USD" tolerated. */
export function epnMoneyList(raw: string | undefined | null): (number | null)[] {
  if (typeof raw !== "string") return [];
  return raw
    .replace(/[\[\]"'$]/g, " ")
    .replace(/\bUSD\b/gi, " ")
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((v) => parseEpnMoney(v));
}

/**
 * Pick the line for the clicked listing: its index in the item list, and the sale
 * price at that index (or the single price when only one is given).
 */
export function resolveEpnLine(
  clickListingId: string,
  itemRaw: string | undefined | null,
  saleRaw: string | undefined | null,
): { itemId: string; salePriceCents: number } | null {
  const target = canonicalEbayItem(clickListingId);
  const items = epnItemList(itemRaw);
  const idx = items.indexOf(target);
  if (idx < 0) return null;
  const prices = epnMoneyList(saleRaw);
  const price = prices.length === items.length ? prices[idx] : prices.length === 1 ? prices[0] : null;
  if (!price) return null;
  return { itemId: target, salePriceCents: price };
}

/** Customid as EPN may echo it: only [A-Za-z0-9:_-] survive. */
export function normalizeEpnCustomId(v: string): string {
  return (v || "").replace(/[^A-Za-z0-9:_-]/g, "");
}

export const MAX_EPN_QUANTITY = 10;

/**
 * eBay reports the line total. A listing bought in quantity k (k identical copies)
 * reports k x the unit price the app showed. Any other total is not auto-matched.
 */
export function epnPriceMatches(intentPriceCents: number, salePriceCents: number): boolean {
  if (!Number.isInteger(intentPriceCents) || !Number.isInteger(salePriceCents) || intentPriceCents <= 0) return false;
  if (salePriceCents < intentPriceCents || salePriceCents % intentPriceCents !== 0) return false;
  return salePriceCents / intentPriceCents <= MAX_EPN_QUANTITY;
}

/**
 * eBay reports the total it saw for the item. Credit is based on that reported total:
 * at or above the applied price is full credit, below it is prorated. A total of zero or
 * more than MAX_EPN_QUANTITY times the applied price is not accepted.
 */
export function epnSaleAcceptable(intentPriceCents: number, salePriceCents: number): boolean {
  if (!Number.isInteger(intentPriceCents) || !Number.isInteger(salePriceCents) || intentPriceCents <= 0) return false;
  return salePriceCents > 0 && salePriceCents <= intentPriceCents * MAX_EPN_QUANTITY;
}

export function matchesEpnIntent(
  intent: { userId: string; source: string; listingId: string; priceCents: number; currency: string; createdAt: Date | null },
  click: { id: string; userId: string | null; source: string; listingId: string; createdAt: Date | null },
  salePriceCents: number,
): boolean {
  return !!click.id && !!click.userId && intent.userId === click.userId &&
    intent.source === "ebay" && click.source === "ebay" &&
    canonicalEbayItem(intent.listingId) === canonicalEbayItem(click.listingId) &&
    intent.currency.toUpperCase() === "USD" && epnSaleAcceptable(intent.priceCents, salePriceCents) &&
    !!intent.createdAt && !!click.createdAt && click.createdAt >= intent.createdAt;
}

/** EPN statuses that undo a sale, and the one that makes it final. */
const EPN_REVERSAL = /^(reversed?|reversal|returned?|return|cancell?ed|cancel|refunded?|void(ed)?|chargeback)$/i;
const EPN_LOCKED = /^(locked|lock|final(ized)?|paid)$/i;

export function classifyEpnStatus(raw: string | undefined | null): "reversal" | "locked" | null {
  const v = (raw || "").trim();
  if (!v) return null;
  if (EPN_REVERSAL.test(v)) return "reversal";
  if (EPN_LOCKED.test(v)) return "locked";
  return null;
}

