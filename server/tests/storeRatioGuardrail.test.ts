import { describe, it, expect } from "vitest";
import { packageGuardrailService } from "../services/store/packageGuardrailService";
import { PRODUCT_DEFINITIONS, PACKPTS_BUNDLE_SKUS, PACKPTS_MONTHLY_SKUS } from "../services/productMap";

// Live/seeded values: store_package_policy minMarginRate 0.30, warn band 0.05,
// value per point = treasury 2000 micro-USD ($0.002), Stripe web 2.9% + 30c.
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
      expect(m.totalRedemptionCostCents).toBeLessThanOrEqual(m.netRevenueCents * (1 - policy.minMarginRate));
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
  it("live grants stay on sale", () => {
    expect([PRODUCT_DEFINITIONS.PACKPTS_15000.packptsGrant, PRODUCT_DEFINITIONS.PACKPTS_45000.packptsGrant, PRODUCT_DEFINITIONS.PACKPTS_80000.packptsGrant]).toEqual([1592, 4992, 8387]);
    expect([PRODUCT_DEFINITIONS.PACKPTS_MONTHLY_500.packptsGrant, PRODUCT_DEFINITIONS.PACKPTS_MONTHLY_2000.packptsGrant, PRODUCT_DEFINITIONS.PACKPTS_MONTHLY_5000.packptsGrant]).toEqual([500, 2000, 5000]);
  });
});
