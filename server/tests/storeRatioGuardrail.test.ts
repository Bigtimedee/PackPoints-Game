import { describe, it, expect } from "vitest";
import { packageGuardrailService } from "../services/store/packageGuardrailService";
import { PRODUCT_DEFINITIONS, PACKPTS_BUNDLE_SKUS, PACKPTS_MONTHLY_SKUS } from "../services/productMap";

// Floor is 75% even if a stored policy still says 0.30. Value per point =
// treasury 2000 micro-USD ($0.002), Stripe web 2.9% + 30c.
const policy: any = { minMarginRate: 0.30, warnMarginBand: 0.05, maxValuePerPtMicrousd: 2000, allowOverride: false, reserveRate: 1.0 };
const fee: any = { channel: "web_stripe", feeRate: 0.029, feeFixedCents: 30, platformFeeRate: 0 };
const evalSku = (price: number, pts: number) => {
  const m = packageGuardrailService.computeMetrics(price, pts, "web_stripe", fee, policy);
  return { m, d: packageGuardrailService.evaluateMetrics(m, policy).decision };
};

describe("store ratio: every SKU passes the enforced package guardrail", () => {
  for (const sku of [...PACKPTS_BUNDLE_SKUS, ...PACKPTS_MONTHLY_SKUS]) {
    it(`${sku} passes`, () => {
      const def: any = PRODUCT_DEFINITIONS[sku];
      const { m, d } = evalSku(def.priceUsd, def.packptsGrant);
      expect(d).not.toBe("BLOCK");
      expect(m.totalRedemptionCostCents).toBeLessThanOrEqual(Math.floor(m.netRevenueCents * 0.25));
      expect(m.totalRedemptionCostCents).toBeLessThanOrEqual(Math.floor(def.priceUsd * 0.25));
    });
  }
  it("bundle grants are the largest that pass (one more point blocks)", () => {
    for (const sku of PACKPTS_BUNDLE_SKUS) {
      const def: any = PRODUCT_DEFINITIONS[sku];
      expect(evalSku(def.priceUsd, def.packptsGrant + 1).d).toBe("BLOCK");
    }
  });
  it("the old grants block", () => {
    expect(evalSku(499, 15000).d).toBe("BLOCK");
    expect(evalSku(1499, 45000).d).toBe("BLOCK");
    expect(evalSku(2499, 80000).d).toBe("BLOCK");
  });
  it("new grants", () => {
    expect([PRODUCT_DEFINITIONS.PACKPTS_15000.packptsGrant, PRODUCT_DEFINITIONS.PACKPTS_45000.packptsGrant, PRODUCT_DEFINITIONS.PACKPTS_80000.packptsGrant]).toEqual([567, 1782, 2997]);
  });
  it("a 30% policy cannot sell a bundle whose redeemable value exceeds 25% of price", () => {
    const weak: any = { ...policy, minMarginRate: 0.30 };
    for (const [price, pts] of [[499, 1592], [1499, 4992], [2499, 8387]] as const) {
      const m = packageGuardrailService.computeMetrics(price, pts, "web_stripe", fee, weak);
      expect(packageGuardrailService.evaluateMetrics(m, weak).decision).toBe("BLOCK");
      expect(m.totalRedemptionCostCents).toBeGreaterThan(Math.floor(price * 0.25));
    }
  });
});
