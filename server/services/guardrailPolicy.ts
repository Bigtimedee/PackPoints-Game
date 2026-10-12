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
  commissionEstimateCents: number; // price x TRADING_CARD_COMMISSION_RATE
  dailyRemainingCents: number;
  weeklyRemainingCents: number;
}

/**
 * eBay rebate = 100% of the confirmed EPN commission (Dave, Oct 12 2026).
 * Pre-purchase ceiling = MIN(commission estimate, per-user daily, per-user
 * weekly), and 0 when the reserve floor trips. The old affiliate formula,
 * haircut and margin min() no longer apply to eBay sale credits. The final
 * grant is the postback commission_cents, never more than was applied.
 */
export function computeCreditCeilingCents(c: CreditCeilings): number {
  if (!c.reserveHealthy) return 0;
  return Math.max(0, Math.floor(Math.min(
    c.commissionEstimateCents,
    c.dailyRemainingCents,
    c.weeklyRemainingCents,
  )));
}

/** Default trading card EPN commission rate used only for the pre-purchase estimate. */
export const DEFAULT_TRADING_CARD_COMMISSION_RATE = 0.02;

/** Single source for the estimate rate: env TRADING_CARD_COMMISSION_RATE, default 0.02, sane range 0..0.2. */
export function tradingCardCommissionRate(raw: string | undefined = process.env.TRADING_CARD_COMMISSION_RATE): number {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 0.2 ? n : DEFAULT_TRADING_CARD_COMMISSION_RATE;
}

/** Estimated rebate for a listing: price x rate, floored to cents. No haircut. */
export function estimateCommissionCents(priceCents: number, rate: number = tradingCardCommissionRate()): number {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return 0;
  return Math.floor(priceCents * rate);
}

/**
 * Final eBay credit from a postback: the confirmed commission, capped at the
 * credit the user applied (points are the currency). Points beyond what the
 * final credit needs are refunded.
 */
export function commissionGrant(
  appliedCreditCents: number,
  packptsSpent: number,
  commissionCents: number,
  centsPerPoint: number,
): { creditCents: number; keptPackpts: number; refundPackpts: number } {
  const credit = Math.max(0, Math.min(appliedCreditCents, Math.floor(commissionCents)));
  if (credit >= appliedCreditCents) return { creditCents: appliedCreditCents, keptPackpts: packptsSpent, refundPackpts: 0 };
  const kept = Math.min(packptsSpent, centsPerPoint > 0 ? Math.ceil(credit / centsPerPoint) : packptsSpent);
  return { creditCents: credit, keptPackpts: kept, refundPackpts: packptsSpent - kept };
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
/** Rebate credit is held this long from purchase before it can be withdrawn (outlasts eBay returns and EPN reversals). */
export const PAYOUT_HOLD_DAYS = 60;
/** A sale EPN reports as locked may release early, but never before this many days. */
export const PAYOUT_LOCKED_MIN_HOLD_DAYS = 45;

/**
 * Withdrawable = balance minus positive GRANT/ADJUSTMENT credit younger than the
 * hold. PAYOUT_REFUND (a denied payout returned) is not re-held.
 */
export function computeWithdrawableCents(
  balanceCents: number,
  ledger: { amountCents: number; type: string; createdAt: Date | string | null; locked?: boolean | null }[],
  now: Date = new Date(),
  holdDays: number = PAYOUT_HOLD_DAYS,
  lockedMinDays: number = PAYOUT_LOCKED_MIN_HOLD_DAYS,
): { withdrawableCents: number; heldCents: number } {
  let held = 0;
  for (const e of ledger) {
    if (e.amountCents <= 0) continue;
    if (e.type !== "GRANT" && e.type !== "ADJUSTMENT") continue;
    const t = e.createdAt ? new Date(e.createdAt).getTime() : now.getTime();
    const days = e.locked ? Math.min(holdDays, lockedMinDays) : holdDays;
    if (t > now.getTime() - days * 86_400_000) held += e.amountCents;
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

/**
 * Listing-card preview of what Apply would credit: the margin-backed cap,
 * clamped to the wallet balance, at the policy cents-per-point. This mirrors
 * applyRedemption -> computeAllowedRedemption so the badge equals the credit.
 */
export function previewCreditFromQuote(marginBackedRmax: number, availablePts: number, centsPerPoint: number): { pts: number; creditCents: number } {
  const pts = Math.max(0, Math.floor(Math.min(marginBackedRmax, availablePts)));
  if (!Number.isFinite(centsPerPoint) || centsPerPoint <= 0) return { pts: 0, creditCents: 0 };
  return { pts, creditCents: Math.floor(pts * centsPerPoint) };
}
