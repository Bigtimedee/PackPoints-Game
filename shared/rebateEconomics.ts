/**
 * Rebate split and point-bundle margin. One home for both rates.
 *
 * Users receive USER_REBATE_SHARE of each confirmed eBay EPN commission.
 * PackPTS keeps the rest. Rows created before this split store
 * LEGACY_REBATE_SHARE (1) and keep the full commission.
 *
 * A paid bundle stays on sale at its price and point count. The rebate value
 * of the points that purchase grants is capped at BUNDLE_MAX_REDEEMABLE_OF_PRICE
 * of the price paid (BUNDLE_MIN_MARGIN_RATE kept by PackPTS).
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

/** Rebate cents a purchase may fund: 25% of the price paid, rounded to the cent. */
export function maxBundleRedeemableCents(priceCents: number): number {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return 0;
  return Math.round((Math.floor(priceCents) * 25) / 100);
}

export interface BundleCapUses {
  purchaseUseCents: Record<string, number>;
  unlinkedUseCents: number;
  purchasedRebateCents: number;
}

export interface CapPurchase {
  id: string;
  capCents: number;
}

export interface CapBucket {
  points: number;
  source: string;
  purchaseId: string | null;
}

export interface CapUse {
  purchaseId: string | null;
  cents: number;
}

export interface SpendCapResult extends BundleCapUses {
  creditCents: number;
  pointsUsed: number;
}

function centsForPoints(points: number, centsPerPoint: number): number {
  const micro = Math.round(centsPerPoint * 10000);
  if (micro <= 0 || points <= 0) return 0;
  return Math.floor((points * micro) / 10000);
}

function pointsThatFit(cents: number, centsPerPoint: number): number {
  const micro = Math.round(centsPerPoint * 10000);
  if (micro <= 0 || cents <= 0) return 0;
  return Math.floor((cents * 10000) / micro);
}

/**
 * Spend points in FIFO order. Earned, bonus, and adjustment points convert at
 * centsPerPoint. Purchased points tied to a purchase convert only up to that
 * purchase's remaining cap. Purchased points with no purchase id share
 * unlinkedCapRemainingCents, the sum of 0.25 x price for paid bundles that
 * have no point lineage. Points that cannot convert are not spent.
 */
export function creditForPointSpend(args: {
  lots: Array<{ points: number; source: string; purchaseId?: string | null; capRemainingCents?: number | null }>;
  pointsToSpend: number;
  centsPerPoint: number;
  unlinkedCapRemainingCents: number;
  maxCreditCents?: number;
}): SpendCapResult {
  const empty: SpendCapResult = {
    creditCents: 0, pointsUsed: 0, purchasedRebateCents: 0, purchaseUseCents: {}, unlinkedUseCents: 0,
  };
  const cpp = args.centsPerPoint;
  if (!Number.isFinite(cpp) || cpp <= 0 || args.pointsToSpend <= 0) return empty;
  let pointsLeft = Math.floor(args.pointsToSpend);
  let credit = 0;
  let pointsUsed = 0;
  let purchased = 0;
  let unlinked = 0;
  const purchaseUse: Record<string, number> = {};
  const purchaseRemain = new Map<string, number>();
  let unlinkedRemain = Math.max(0, Math.floor(args.unlinkedCapRemainingCents));
  const maxCredit = args.maxCreditCents == null ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(args.maxCreditCents));

  for (const lot of args.lots) {
    if (pointsLeft <= 0 || credit >= maxCredit) break;
    const available = Math.min(Math.max(0, Math.floor(lot.points)), pointsLeft);
    if (available <= 0) continue;
    const room = maxCredit - credit;
    const roomPoints = pointsThatFit(room, cpp);
    if (roomPoints <= 0) break;
    if (lot.source !== "PURCHASED") {
      const take = Math.min(available, roomPoints);
      const add = centsForPoints(take, cpp);
      if (add <= 0) continue;
      credit += add;
      pointsUsed += take;
      pointsLeft -= take;
      continue;
    }
    let capRemain: number;
    if (lot.purchaseId) {
      if (!purchaseRemain.has(lot.purchaseId)) {
        purchaseRemain.set(lot.purchaseId, Math.max(0, Math.floor(lot.capRemainingCents ?? 0)));
      }
      capRemain = purchaseRemain.get(lot.purchaseId) ?? 0;
    } else {
      capRemain = unlinkedRemain;
    }
    const take = Math.min(available, roomPoints, pointsThatFit(capRemain, cpp));
    const add = centsForPoints(take, cpp);
    if (take <= 0 || add <= 0) continue;
    credit += add;
    pointsUsed += take;
    pointsLeft -= take;
    purchased += add;
    if (lot.purchaseId) {
      purchaseRemain.set(lot.purchaseId, capRemain - add);
      purchaseUse[lot.purchaseId] = (purchaseUse[lot.purchaseId] ?? 0) + add;
    } else {
      unlinkedRemain -= add;
      unlinked += add;
    }
  }
  return {
    creditCents: credit,
    pointsUsed,
    purchasedRebateCents: purchased,
    purchaseUseCents: purchaseUse,
    unlinkedUseCents: unlinked,
  };
}

/** Build the spend plan from buckets, purchase caps, and rebate cap already used. */
export function planPurchasedSpend(args: {
  buckets: CapBucket[];
  purchases: CapPurchase[];
  priorUses: CapUse[];
  pointsToSpend: number;
  centsPerPoint: number;
  maxCreditCents?: number;
}): SpendCapResult {
  const usedByPurchase = new Map<string, number>();
  let unlinkedUsed = 0;
  for (const use of args.priorUses) {
    if (!Number.isFinite(use.cents) || use.cents <= 0) continue;
    if (use.purchaseId) usedByPurchase.set(use.purchaseId, (usedByPurchase.get(use.purchaseId) ?? 0) + use.cents);
    else unlinkedUsed += use.cents;
  }
  const linked = new Set(args.buckets.map((b) => b.purchaseId).filter((id): id is string => !!id));
  const capById = new Map<string, number>();
  let unlinkedCap = 0;
  for (const purchase of args.purchases) {
    const remain = Math.max(0, Math.floor(purchase.capCents) - (usedByPurchase.get(purchase.id) ?? 0));
    capById.set(purchase.id, remain);
    if (!linked.has(purchase.id)) unlinkedCap += Math.max(0, Math.floor(purchase.capCents));
  }
  unlinkedCap = Math.max(0, unlinkedCap - unlinkedUsed);
  return creditForPointSpend({
    lots: args.buckets.filter((b) => b.points > 0).map((b) => ({
      points: b.points,
      source: b.source,
      purchaseId: b.purchaseId,
      capRemainingCents: b.purchaseId ? (capById.get(b.purchaseId) ?? 0) : null,
    })),
    pointsToSpend: args.pointsToSpend,
    centsPerPoint: args.centsPerPoint,
    unlinkedCapRemainingCents: unlinkedCap,
    maxCreditCents: args.maxCreditCents,
  });
}

/** After grant, release purchased-cap cents the lower commission did not pay. Null keeps the old treatment. */
export function settleCapUses(
  uses: BundleCapUses | null | undefined,
  finalCreditCents: number,
): BundleCapUses | null {
  if (!uses) return null;
  const purchased = Math.max(0, Math.min(Math.floor(uses.purchasedRebateCents), Math.floor(finalCreditCents)));
  const prev = Math.max(0, Math.floor(uses.purchasedRebateCents));
  if (purchased >= prev) return uses;
  let drop = prev - purchased;
  let unlinkedUseCents = Math.max(0, Math.floor(uses.unlinkedUseCents));
  const purchaseUseCents = { ...uses.purchaseUseCents };
  const fromUnlinked = Math.min(unlinkedUseCents, drop);
  unlinkedUseCents -= fromUnlinked;
  drop -= fromUnlinked;
  for (const id of Object.keys(purchaseUseCents)) {
    if (drop <= 0) break;
    const take = Math.min(Math.max(0, purchaseUseCents[id]), drop);
    purchaseUseCents[id] -= take;
    drop -= take;
    if (purchaseUseCents[id] <= 0) delete purchaseUseCents[id];
  }
  return { purchaseUseCents, unlinkedUseCents, purchasedRebateCents: purchased };
}
