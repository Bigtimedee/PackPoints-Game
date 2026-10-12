/**
 * Pure guardrail helpers (no DB) shared by the profit guardrail, treasury and
 * store services so they can be unit-tested and so the numbers have one home.
 */

/**
 * Hard minimum for the reserve floor, in cents. Redemptions pause whenever the
 * funded reserve (margin booked minus margin consumed) is below
 * max(policy.reserveFloorCents, MIN_RESERVE_FLOOR_CENTS).
 *
 * $25 = one user's default daily credit cap (perUserDailyCreditCents). With a
 * floor of $0 the pause could only trip once the reserve was already negative,
 * i.e. after we had paid out money we never earned. A policy may raise the
 * floor; it can never lower it below this.
 */
export const MIN_RESERVE_FLOOR_CENTS = 2500;

export function effectiveReserveFloorCents(policyFloorCents: number | null | undefined): number {
  const f = Number(policyFloorCents ?? 0);
  return Math.max(Number.isFinite(f) ? f : 0, MIN_RESERVE_FLOOR_CENTS);
}

/** Fail closed: no active policy means redemptions are not healthy. */
export function isReserveHealthy(
  fundedReserveCents: number,
  policyFloorCents: number | null | undefined,
  hasActivePolicy: boolean,
): boolean {
  if (!hasActivePolicy) return false;
  return fundedReserveCents >= effectiveReserveFloorCents(policyFloorCents);
}

export interface CreditCeilings {
  reserveHealthy: boolean;
  meaningfulCreditCents: number; // maxDiscountPct * price
  allowedCapCents: number; // margin pool + this transaction's margin
  dailyRemainingCents: number;
  weeklyRemainingCents: number;
  formulaCreditCents: number; // affiliate formula: h*A*P*(1-m) net of fees
}

/**
 * Final credit = MIN of every ceiling, INCLUDING the affiliate formula, so
 * credit can never exceed the (haircut, margin-retained) eBay revenue share
 * on this purchase. Before Oct 2026 the formula was computed but left out of
 * the min(), letting credit reach maxDiscountPct (15%) of price against ~1-2%
 * affiliate revenue.
 */
export function computeCreditCeilingCents(c: CreditCeilings): number {
  if (!c.reserveHealthy) return 0;
  return Math.max(0, Math.floor(Math.min(
    c.meaningfulCreditCents,
    c.allowedCapCents,
    c.dailyRemainingCents,
    c.weeklyRemainingCents,
    c.formulaCreditCents,
  )));
}

/** Fields an admin may set on profit_policy, with their fallback defaults. */
export const PROFIT_POLICY_DEFAULTS = {
  minMarginM: 0.25,
  affiliateRateA: 0.02,
  affiliateHaircutH: 0.70,
  processingFeeRateR: 0.00,
  fixedFeeFCents: 0,
  packptsValueVMicrousd: 2000,
  maxDiscountPct: 0.15,
  perUserDailyCreditCents: 2500,
  perUserWeeklyCreditCents: 10000,
  minRedemptionPackpts: 1,
  reserveFloorCents: MIN_RESERVE_FLOOR_CENTS,
} as const;

export type ProfitPolicyFields = { -readonly [K in keyof typeof PROFIT_POLICY_DEFAULTS]: number };
export const PROFIT_POLICY_FIELDS = Object.keys(PROFIT_POLICY_DEFAULTS) as (keyof ProfitPolicyFields)[];

/**
 * Merge a partial admin update onto the CURRENT active policy. Omitted fields
 * keep their current values; defaults are used only when there is no current
 * policy. Unknown keys (id, enabled, effectiveFrom, ...) are dropped.
 */
export function mergeProfitPolicyUpdate(
  current: Partial<Record<string, unknown>> | null | undefined,
  patch: Partial<Record<string, unknown>> | null | undefined,
): ProfitPolicyFields {
  const out = {} as ProfitPolicyFields;
  for (const k of PROFIT_POLICY_FIELDS) {
    const p = patch?.[k];
    const c = current?.[k];
    if (typeof p === "number" && Number.isFinite(p)) out[k] = p;
    else if (typeof c === "number" && Number.isFinite(c)) out[k] = c;
    else out[k] = PROFIT_POLICY_DEFAULTS[k];
  }
  return out;
}

/**
 * Store value-per-point is DERIVED from the treasury PackPTS value
 * (profit_policy.packptsValueVMicrousd). The stored store column is legacy and
 * is ignored whenever a treasury value exists, so the two can never drift.
 */
export function syncedValuePerPtMicrousd(storedMicrousd: number, treasuryMicrousd: number | null): number {
  return treasuryMicrousd !== null && treasuryMicrousd > 0 ? treasuryMicrousd : storedMicrousd;
}

/** Smallest cash-back payout a user can request ($10). */
export const PAYOUT_MIN_CENTS = 1000;
/** Rebate credit is held this long before it can be withdrawn (outlasts eBay's 30-day return window). */
export const PAYOUT_HOLD_DAYS = 30;

/**
 * Withdrawable = balance minus positive GRANT/ADJUSTMENT credit younger than the
 * hold. PAYOUT_REFUND (a denied payout returned) is not re-held.
 */
export function computeWithdrawableCents(
  balanceCents: number,
  ledger: { amountCents: number; type: string; createdAt: Date | string | null }[],
  now: Date = new Date(),
  holdDays: number = PAYOUT_HOLD_DAYS,
): { withdrawableCents: number; heldCents: number } {
  const cutoff = now.getTime() - holdDays * 86_400_000;
  let held = 0;
  for (const e of ledger) {
    if (e.amountCents <= 0) continue;
    if (e.type !== "GRANT" && e.type !== "ADJUSTMENT") continue;
    const t = e.createdAt ? new Date(e.createdAt).getTime() : now.getTime();
    if (t > cutoff) held += e.amountCents;
  }
  const heldCents = Math.min(Math.max(0, balanceCents), held);
  return { withdrawableCents: Math.max(0, balanceCents - heldCents), heldCents };
}

/** Lowercase, trim; for emails strip +tags and gmail dots so aliases collide. */
export function normalizePayoutDestination(dest: string): string {
  const d = (dest || "").trim().toLowerCase();
  const m = d.match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m) return d.replace(/\s+/g, "");
  let [, local, domain] = m;
  local = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") { local = local.replace(/\./g, ""); domain = "gmail.com"; }
  return `${local}@${domain}`;
}

export type PayoutReviewFlag = "SHARED_DEVICE" | "SHARED_IP" | "SHARED_DESTINATION";

export function payoutReviewFlags(counts: { device: number; ip: number; destination: number }): PayoutReviewFlag[] {
  const f: PayoutReviewFlag[] = [];
  if (counts.device > 0) f.push("SHARED_DEVICE");
  if (counts.ip > 0) f.push("SHARED_IP");
  if (counts.destination > 0) f.push("SHARED_DESTINATION");
  return f;
}

/** Minimum PackPTS per marketplace redemption. 1 = any whole point earns. */
export const REDEMPTION_MIN_PACKPTS = 1;
