import { describe, it, expect } from "vitest";
import {
  getInvoiceSubscriptionId,
  getInvoiceSubscriptionMetadata,
  getInvoiceLinePriceId,
  getSubscriptionPeriodEnd,
} from "../services/stripeCompat";

describe("stripeCompat: basil/clover and legacy Stripe shapes", () => {
  it("reads the subscription id from invoice.parent (basil+) and legacy invoice.subscription", () => {
    expect(getInvoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_new" } } })).toBe("sub_new");
    expect(getInvoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: "sub_obj" } } } })).toBe("sub_obj");
    expect(getInvoiceSubscriptionId({ subscription: "sub_old" })).toBe("sub_old");
    expect(getInvoiceSubscriptionId({ parent: null })).toBeNull();
    expect(getInvoiceSubscriptionId({})).toBeNull();
  });

  it("reads subscription metadata from either shape", () => {
    expect(getInvoiceSubscriptionMetadata({ parent: { subscription_details: { metadata: { userId: "u1" } } } })?.userId).toBe("u1");
    expect(getInvoiceSubscriptionMetadata({ subscription_details: { metadata: { userId: "u2" } } })?.userId).toBe("u2");
    expect(getInvoiceSubscriptionMetadata({})).toBeUndefined();
  });

  it("reads the line price id from pricing.price_details (basil+) and legacy price", () => {
    expect(getInvoiceLinePriceId({ lines: { data: [{ pricing: { price_details: { price: "price_new" } } }] } })).toBe("price_new");
    expect(getInvoiceLinePriceId({ lines: { data: [{ price: { id: "price_old" } }] } })).toBe("price_old");
    expect(getInvoiceLinePriceId({ lines: { data: [] } })).toBeUndefined();
  });

  it("reads the period end from the purchased item (basil+) and the legacy subscription field", () => {
    expect(getSubscriptionPeriodEnd({ items: { data: [{ current_period_end: 1800000000 }] } }).getTime()).toBe(1800000000 * 1000);
    expect(getSubscriptionPeriodEnd({ current_period_end: 1700000000, items: { data: [{ price: { id: "p1" } }] } }).getTime()).toBe(1700000000 * 1000);
  });

  it("does not take the longest period across mixed items", () => {
    const sub = { items: { data: [
      { price: { id: "p_monthly" }, current_period_end: 100 },
      { price: { id: "p_annual" }, current_period_end: 900 },
    ] } };
    expect(getSubscriptionPeriodEnd(sub).getTime()).toBe(100 * 1000);
    expect(getSubscriptionPeriodEnd(sub, "p_monthly").getTime()).toBe(100 * 1000);
    expect(getSubscriptionPeriodEnd(sub, "p_annual").getTime()).toBe(900 * 1000);
  });

  it("throws instead of producing an Invalid Date when no period end exists", () => {
    expect(() => getSubscriptionPeriodEnd({ items: { data: [{}] } })).toThrow(/current_period_end/);
  });
});
