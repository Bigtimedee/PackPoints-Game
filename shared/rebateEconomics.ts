/**
 * Rebate split and point-bundle margin. One home for both rates.
 *
 * Users receive USER_REBATE_SHARE of each confirmed eBay EPN commission.
 * PackPTS keeps the rest. Rows created before this split store
 * LEGACY_REBATE_SHARE (1) and keep the full commission.
 *
 * A point bundle must keep at least BUNDLE_MIN_MARGIN_RATE. The redeemable
 * value of its points is at most price times BUNDLE_MAX_REDEEMABLE_OF_PRICE.
 */

/** Basis points (10000 = 100%). Integer math avoids binary float drift. */
export const USER_REBATE_SHARE_BPS = 7000;
export const LEGACY_REBATE_SHARE_BPS = 10000;

/** 0.70. New rebates. */
export const USER_REBATE_SHARE = USER_REBATE_SHARE_BPS / LEGACY_REBATE_SHARE_BPS;
/** 1. Existing rebates, including ones still pending at deploy. */
export const LEGACY_REBATE_SHARE = LEGACY_REBATE_SHARE_BPS / LEGACY_REBATE_SHARE_BPS;

export const USER_REBATE_SHARE_LABEL = `${USER_REBATE_SHARE_BPS / 100}%`;
export const PACKPTS_KEEP_SHARE_LABEL = `${(LEGACY_REBATE_SHARE_BPS - USER_REBATE_SHARE_BPS) / 100}%`;

/** Minimum margin on a point bundle. Redeemable value <= price * (1 - this). */
export const BUNDLE_MIN_MARGIN_RATE = 0.75;
export const BUNDLE_MAX_REDEEMABLE_OF_PRICE = 1 - BUNDLE_MIN_MARGIN_RATE;

export function shareBps(share: number | null | undefined): number {
  if (typeof share !== "number" || !Number.isFinite(share)) return LEGACY_REBATE_SHARE_BPS;
  return Math.min(LEGACY_REBATE_SHARE_BPS, Math.max(0, Math.round(share * LEGACY_REBATE_SHARE_BPS)));
}

/** User's cents from a confirmed commission at the given share (default 70%). */
export function userRebateCents(commissionCents: number, share: number = USER_REBATE_SHARE): number {
  if (!Number.isFinite(commissionCents) || commissionCents <= 0) return 0;
  return Math.floor((Math.floor(commissionCents) * shareBps(share)) / LEGACY_REBATE_SHARE_BPS);
}

/** Largest redeemable value, in cents, that still clears the bundle margin floor. */
export function maxBundleRedeemableCents(priceCents: number): number {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return 0;
  return Math.floor(priceCents * BUNDLE_MAX_REDEEMABLE_OF_PRICE);
}
