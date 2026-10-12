import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripePurchaseService } from "../services/stripePurchaseService";

// Store bundles use inline price_data, so Stripe line items carry ad-hoc price ids.
// Fulfillment must resolve the SKU from our own session metadata, guarded by amount.
describe("bundle SKU resolution for inline-priced checkout sessions", () => {
  const svc = stripePurchaseService as any;
  const cases: Array<[string, number]> = [["PACKPTS_15000", 499], ["PACKPTS_45000", 1499], ["PACKPTS_80000", 2499]];

  for (const [sku, cents] of cases) {
    it(`resolves ${sku} when the charged amount matches`, () => {
      expect(svc.resolveBundleSkuFromSession({ id: "cs_x", metadata: { sku } }, { amount_total: cents, quantity: 1 })).toBe(sku);
    });
  }

  it("refuses when the charged amount does not match the bundle price", () => {
    expect(svc.resolveBundleSkuFromSession({ id: "cs_x", metadata: { sku: "PACKPTS_80000" } }, { amount_total: 499, quantity: 1 })).toBeNull();
  });

  it("refuses unknown or non-bundle SKUs", () => {
    expect(svc.resolveBundleSkuFromSession({ id: "cs_x", metadata: { sku: "PRO_MONTHLY" } }, { amount_total: 999, quantity: 1 })).toBeNull();
    expect(svc.resolveBundleSkuFromSession({ id: "cs_x", metadata: {} }, { amount_total: 499, quantity: 1 })).toBeNull();
  });
});

describe("Stripe webhook route", () => {
  it("is registered and signature-verified", () => {
    const src = fs.readFileSync(path.join(__dirname, "../routes.ts"), "utf8");
    expect(src).toContain('app.post("/api/stripe/webhook"');
    expect(src).toContain("verifyAndParseWebhook(req.rawBody");
  });
});
