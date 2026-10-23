import { describe, it, expect } from "vitest";
import {
  computeCreditCeilingCents,
  effectiveReserveFloorCents,
  isReserveHealthy,
  mergeProfitPolicyUpdate,
  MIN_RESERVE_FLOOR_CENTS,
  PROFIT_POLICY_DEFAULTS,
  syncedValuePerPtMicrousd,
  tradingCardCommissionRate,
  estimateCommissionCents,
  commissionGrant,
  computeWithdrawableCents,
  PAYOUT_HOLD_DAYS,
  PAYOUT_LOCKED_MIN_HOLD_DAYS,
} from "../services/guardrailPolicy";
import { LEGACY_REBATE_SHARE, userRebateCents, USER_REBATE_SHARE } from "@shared/rebateEconomics";
import { upToBackLabel } from "../../client/src/lib/pointsCopy";
import { profitGuardrailService } from "../services/profitGuardrailService";

const base = {
  reserveHealthy: true,
  commissionEstimateCents: 200, // caller already applied the user share
  dailyRemainingCents: 2500,
  weeklyRemainingCents: 10000,
};

describe("eBay rebate share (estimate before purchase)", () => {
  it("ceiling is the commission estimate when caps are generous", () => {
    expect(computeCreditCeilingCents(base)).toBe(200);
  });
  it("per-user caps still bind", () => {
    expect(computeCreditCeilingCents({ ...base, dailyRemainingCents: 40 })).toBe(40);
    expect(computeCreditCeilingCents({ ...base, weeklyRemainingCents: 0 })).toBe(0);
  });
  it("unhealthy reserve pays nothing", () => {
    expect(computeCreditCeilingCents({ ...base, reserveHealthy: false })).toBe(0);
  });
  it("estimate = price x TRADING_CARD_COMMISSION_RATE, default 0.02, no haircut", () => {
    expect(tradingCardCommissionRate(undefined)).toBe(0.02);
    expect(tradingCardCommissionRate("0.045")).toBe(0.045);
    expect(tradingCardCommissionRate("abc")).toBe(0.02);
    expect(tradingCardCommissionRate("0.9")).toBe(0.02);
    expect(estimateCommissionCents(5000, 0.02)).toBe(100);
    expect(estimateCommissionCents(2500, 0.02)).toBe(50);
    expect(estimateCommissionCents(10000, 0.045)).toBe(450);
  });
  it("grant = 70% of confirmed commission, capped at applied credit, extra points refunded", () => {
    expect(USER_REBATE_SHARE).toBe(0.7);
    expect(userRebateCents(100)).toBe(70);
    expect(userRebateCents(250)).toBe(175);
    expect(userRebateCents(61)).toBe(42);
    expect(commissionGrant(100, 500, 100, 0.2)).toEqual({ creditCents: 70, keptPackpts: 350, refundPackpts: 150 });
    expect(commissionGrant(100, 500, 250, 0.2)).toEqual({ creditCents: 100, keptPackpts: 500, refundPackpts: 0 });
    expect(commissionGrant(100, 500, 61, 0.2)).toEqual({ creditCents: 42, keptPackpts: 210, refundPackpts: 290 });
  });
  it("the About $X back badge shows 70% of the commission estimate", () => {
    const gross = estimateCommissionCents(10_000);
    const shown = userRebateCents(gross);
    expect(gross).toBe(200);
    expect(shown).toBe(140);
    expect(upToBackLabel(shown)).toBe("About $1.40 back");
  });
  it("a row stored at 1.0 still pays 100% of the commission", () => {
    expect(LEGACY_REBATE_SHARE).toBe(1);
    expect(userRebateCents(100, LEGACY_REBATE_SHARE)).toBe(100);
    expect(commissionGrant(100, 500, 100, 0.2, LEGACY_REBATE_SHARE)).toEqual({ creditCents: 100, keptPackpts: 500, refundPackpts: 0 });
    expect(commissionGrant(100, 500, 61, 0.2, LEGACY_REBATE_SHARE)).toEqual({ creditCents: 61, keptPackpts: 305, refundPackpts: 195 });
  });
  it("hold is 60 days; a locked sale releases at 45, never earlier", () => {
    expect(PAYOUT_HOLD_DAYS).toBe(60);
    expect(PAYOUT_LOCKED_MIN_HOLD_DAYS).toBe(45);
    const now = new Date("2026-12-31T00:00:00Z");
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
    expect(computeWithdrawableCents(1000, [{ amountCents: 1000, type: "GRANT", createdAt: ago(50) }], now).withdrawableCents).toBe(0);
    expect(computeWithdrawableCents(1000, [{ amountCents: 1000, type: "GRANT", createdAt: ago(50), locked: true }], now).withdrawableCents).toBe(1000);
    expect(computeWithdrawableCents(1000, [{ amountCents: 1000, type: "GRANT", createdAt: ago(40), locked: true }], now).withdrawableCents).toBe(0);
    expect(computeWithdrawableCents(1000, [{ amountCents: 1000, type: "GRANT", createdAt: ago(61) }], now).withdrawableCents).toBe(1000);
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
