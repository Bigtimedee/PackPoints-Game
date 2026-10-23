import { describe, expect, it } from "vitest";
import { PRODUCT_DEFINITIONS } from "../services/productMap";
import {
  maxBundleRedeemableCents,
  planPurchasedSpend,
  settleCapUses,
} from "@shared/rebateEconomics";

const CPP = 0.2;
const LIVE = [
  { sku: "PACKPTS_15000", price: 499, points: 1592, cap: 125 },
  { sku: "PACKPTS_45000", price: 1499, points: 4992, cap: 375 },
  { sku: "PACKPTS_80000", price: 2499, points: 8387, cap: 625 },
  { sku: "PACKPTS_MONTHLY_500", price: 499, points: 500, cap: 125 },
  { sku: "PACKPTS_MONTHLY_2000", price: 1499, points: 2000, cap: 375 },
  { sku: "PACKPTS_MONTHLY_5000", price: 2999, points: 5000, cap: 750 },
] as const;

describe("live bundle rebate caps", () => {
  it("keeps every live bundle at its current price and point count", () => {
    for (const row of LIVE) {
      const def = PRODUCT_DEFINITIONS[row.sku as keyof typeof PRODUCT_DEFINITIONS] as { priceUsd: number; packptsGrant: number };
      expect(def.priceUsd).toBe(row.price);
      expect(def.packptsGrant).toBe(row.points);
    }
  });

  it("caps each purchase at 25% of the price paid", () => {
    expect(maxBundleRedeemableCents(499)).toBe(125);
    expect(maxBundleRedeemableCents(1499)).toBe(375);
    expect(maxBundleRedeemableCents(2499)).toBe(625);
    expect(maxBundleRedeemableCents(2999)).toBe(750);
  });

  it("enforces the cap when the bundle's points are spent", () => {
    for (const row of LIVE) {
      const face = Math.floor(row.points * CPP);
      const spent = planPurchasedSpend({
        buckets: [{ points: row.points, source: "PURCHASED", purchaseId: row.sku }],
        purchases: [{ id: row.sku, capCents: row.cap }],
        priorUses: [],
        pointsToSpend: row.points,
        centsPerPoint: CPP,
      });
      expect(spent.creditCents).toBe(Math.min(face, row.cap));
      expect(spent.purchasedRebateCents).toBe(spent.creditCents);
      expect(spent.pointsUsed).toBeLessThanOrEqual(row.points);
    }
  });

  it("uses the sum of paid-bundle caps when points have no purchase lineage", () => {
    const spent = planPurchasedSpend({
      buckets: [{ points: 1592 + 4992, source: "PURCHASED", purchaseId: null }],
      purchases: [
        { id: "starter", capCents: 125 },
        { id: "value", capCents: 375 },
      ],
      priorUses: [],
      pointsToSpend: 1592 + 4992,
      centsPerPoint: CPP,
    });
    expect(spent.creditCents).toBe(125 + 375);
    expect(spent.unlinkedUseCents).toBe(500);
    expect(spent.purchaseUseCents).toEqual({});
  });

  it("does not cap earned points", () => {
    const spent = planPurchasedSpend({
      buckets: [{ points: 1000, source: "EARNED", purchaseId: null }],
      purchases: [],
      priorUses: [],
      pointsToSpend: 1000,
      centsPerPoint: CPP,
    });
    expect(spent.creditCents).toBe(200);
    expect(spent.purchasedRebateCents).toBe(0);
  });

  it("stops at the quote ceiling and at cap already used", () => {
    const quote = planPurchasedSpend({
      buckets: [{ points: 1592, source: "PURCHASED", purchaseId: "starter" }],
      purchases: [{ id: "starter", capCents: 125 }],
      priorUses: [],
      pointsToSpend: 1592,
      centsPerPoint: CPP,
      maxCreditCents: 40,
    });
    expect(quote.creditCents).toBe(40);
    const again = planPurchasedSpend({
      buckets: [{ points: 967, source: "PURCHASED", purchaseId: "starter" }],
      purchases: [{ id: "starter", capCents: 125 }],
      priorUses: [{ purchaseId: "starter", cents: 125 }],
      pointsToSpend: 967,
      centsPerPoint: CPP,
    });
    expect(again.creditCents).toBe(0);
  });

  it("leaves a pending rebate alone when it has no cap record", () => {
    expect(settleCapUses(null, 70)).toBeNull();
    const settled = settleCapUses({
      purchaseUseCents: { starter: 125 },
      unlinkedUseCents: 0,
      purchasedRebateCents: 125,
    }, 70);
    expect(settled?.purchasedRebateCents).toBe(70);
    expect(settled?.purchaseUseCents.starter).toBe(70);
  });
});
