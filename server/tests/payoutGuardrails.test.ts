import { describe, it, expect } from "vitest";
import {
  PAYOUT_MIN_CENTS,
  PAYOUT_HOLD_DAYS,
  computeWithdrawableCents,
  normalizePayoutDestination,
  payoutReviewFlags,
} from "../services/guardrailPolicy";

const now = new Date("2026-10-12T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("payout minimum and hold", () => {
  it("minimum is $10 and hold is 30 days", () => {
    expect(PAYOUT_MIN_CENTS).toBe(1000);
    expect(PAYOUT_HOLD_DAYS).toBe(30);
  });
  it("credit younger than 30 days is held", () => {
    const r = computeWithdrawableCents(1500, [
      { amountCents: 500, type: "GRANT", createdAt: daysAgo(5) },
      { amountCents: 1000, type: "GRANT", createdAt: daysAgo(40) },
    ], now);
    expect(r).toEqual({ withdrawableCents: 1000, heldCents: 500 });
  });
  it("adjustments are held; payout refunds are not", () => {
    const r = computeWithdrawableCents(1200, [
      { amountCents: 200, type: "ADJUSTMENT", createdAt: daysAgo(1) },
      { amountCents: 1000, type: "PAYOUT_REFUND", createdAt: daysAgo(1) },
    ], now);
    expect(r.withdrawableCents).toBe(1000);
  });
  it("held never exceeds the balance", () => {
    expect(computeWithdrawableCents(300, [{ amountCents: 900, type: "GRANT", createdAt: daysAgo(1) }], now))
      .toEqual({ withdrawableCents: 0, heldCents: 300 });
  });
});

describe("multi-account review flags", () => {
  it("normalizes email aliases so they collide", () => {
    expect(normalizePayoutDestination(" Dave.M+pp@GMail.com ")).toBe("davem@gmail.com");
    expect(normalizePayoutDestination("x+1@example.com")).toBe("x@example.com");
    expect(normalizePayoutDestination("x.y@example.com")).toBe("x.y@example.com");
  });
  it("flags each shared signal", () => {
    expect(payoutReviewFlags({ device: 0, ip: 0, destination: 0 })).toEqual([]);
    expect(payoutReviewFlags({ device: 1, ip: 2, destination: 1 })).toEqual(["SHARED_DEVICE", "SHARED_IP", "SHARED_DESTINATION"]);
  });
});

import { CASH_REDEEMABLE_SOURCES, isCashRedeemableSource, clampToEarned, PURCHASED_POINTS_CASH_VALUE_MICROUSD } from "../services/guardrailPolicy";
describe("earned-only cash redemption", () => {
  it("only EARNED converts to cash", () => {
    expect(CASH_REDEEMABLE_SOURCES).toEqual(["EARNED"]);
    expect(isCashRedeemableSource("PURCHASED")).toBe(false);
    expect(isCashRedeemableSource("BONUS")).toBe(false);
    expect(isCashRedeemableSource("EARNED")).toBe(true);
    expect(PURCHASED_POINTS_CASH_VALUE_MICROUSD).toBe(0);
  });
  it("clamps to earned points even with a large bought balance", () => {
    expect(clampToEarned(5000, 95_000, 2000)).toBe(2000);
    expect(clampToEarned(5000, 80_000, 0)).toBe(0);
  });
});
