import { describe, it, expect } from "vitest";
import {
  computeCreditCeilingCents,
  effectiveReserveFloorCents,
  isReserveHealthy,
  mergeProfitPolicyUpdate,
  MIN_RESERVE_FLOOR_CENTS,
  PROFIT_POLICY_DEFAULTS,
  syncedValuePerPtMicrousd,
} from "../services/guardrailPolicy";
import { profitGuardrailService } from "../services/profitGuardrailService";

const base = {
  reserveHealthy: true,
  meaningfulCreditCents: 1500, // 15% of $100
  allowedCapCents: 1_000_000,
  dailyRemainingCents: 2500,
  weeklyRemainingCents: 10000,
  formulaCreditCents: 105, // 1.05% of $100
};

describe("credit ceiling includes the affiliate formula cap", () => {
  it("credit never exceeds the affiliate formula even when every other cap is generous", () => {
    expect(computeCreditCeilingCents(base)).toBe(105);
  });
  it("formula cap of 0 means no credit", () => {
    expect(computeCreditCeilingCents({ ...base, formulaCreditCents: 0 })).toBe(0);
  });
  it("other caps still bind when lower than the formula", () => {
    expect(computeCreditCeilingCents({ ...base, dailyRemainingCents: 40 })).toBe(40);
    expect(computeCreditCeilingCents({ ...base, allowedCapCents: 10 })).toBe(10);
  });
  it("unhealthy reserve pays nothing", () => {
    expect(computeCreditCeilingCents({ ...base, reserveHealthy: false })).toBe(0);
  });
  it("end to end with live-shaped policy: $100 eBay purchase caps at ~1.05%, not 15%", () => {
    const policy: any = { ...PROFIT_POLICY_DEFAULTS };
    const calc = profitGuardrailService.computeRmax(10_000, policy);
    const formulaCreditCents = Math.floor(calc.Rmax * (policy.packptsValueVMicrousd / 10000));
    const credit = computeCreditCeilingCents({ ...base, formulaCreditCents });
    expect(credit).toBeLessThanOrEqual(Math.floor(10_000 * policy.affiliateRateA));
    expect(credit).toBe(105); // 0.7*0.02*0.75*$100 = $1.05 = 525 PackPTS at $0.002
  });
});

describe("reserve floor fails closed", () => {
  it("a $0 policy floor is raised to the minimum", () => {
    expect(MIN_RESERVE_FLOOR_CENTS).toBeGreaterThan(0);
    expect(effectiveReserveFloorCents(0)).toBe(MIN_RESERVE_FLOOR_CENTS);
    expect(effectiveReserveFloorCents(null)).toBe(MIN_RESERVE_FLOOR_CENTS);
    expect(effectiveReserveFloorCents(50_000)).toBe(50_000);
  });
  it("pause trips below the floor and with no active policy", () => {
    expect(isReserveHealthy(0, 0, true)).toBe(false);
    expect(isReserveHealthy(MIN_RESERVE_FLOOR_CENTS - 1, 0, true)).toBe(false);
    expect(isReserveHealthy(MIN_RESERVE_FLOOR_CENTS, 0, true)).toBe(true);
    expect(isReserveHealthy(1_000_000, 0, false)).toBe(false);
  });
  it("default policy floor is nonzero", () => {
    expect(PROFIT_POLICY_DEFAULTS.reserveFloorCents).toBeGreaterThan(0);
  });
});

describe("profit-policy update merges partial patches", () => {
  const current = {
    ...PROFIT_POLICY_DEFAULTS,
    maxDiscountPct: 0.05,
    perUserDailyCreditCents: 1000,
    reserveFloorCents: 9000,
    packptsValueVMicrousd: 1000,
  };
  it("omitted fields keep their current values", () => {
    const m = mergeProfitPolicyUpdate(current, { minRedemptionPackpts: 250 });
    expect(m.minRedemptionPackpts).toBe(250);
    expect(m.maxDiscountPct).toBe(0.05);
    expect(m.perUserDailyCreditCents).toBe(1000);
    expect(m.reserveFloorCents).toBe(9000);
    expect(m.packptsValueVMicrousd).toBe(1000);
  });
  it("empty patch is a no-op", () => {
    expect(mergeProfitPolicyUpdate(current, {})).toEqual(current);
  });
  it("defaults only when there is no current policy", () => {
    expect(mergeProfitPolicyUpdate(null, {})).toEqual(PROFIT_POLICY_DEFAULTS);
  });
  it("drops unknown keys like id/enabled and non-numeric values", () => {
    const m: any = mergeProfitPolicyUpdate(current, { id: "x", enabled: false, maxDiscountPct: "0.9" } as any);
    expect(m.id).toBeUndefined();
    expect(m.enabled).toBeUndefined();
    expect(m.maxDiscountPct).toBe(0.05);
  });
});

describe("store value-per-point follows the treasury value", () => {
  it("treasury value wins over the stored store column", () => {
    expect(syncedValuePerPtMicrousd(2000, 1500)).toBe(1500);
    expect(syncedValuePerPtMicrousd(2000, null)).toBe(2000);
  });
});
