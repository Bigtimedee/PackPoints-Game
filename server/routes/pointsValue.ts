/**
 * Public GET /api/points/value. No auth, cached 60s.
 * rebateLive is server-side only: env REBATES_LIVE must be exactly "true".
 * Default is false. While false the response omits centsPerPoint so no client
 * can render a dollar figure. Expiry comes from the active expiration policy
 * row (bucketService), never from DEFAULT_EXPIRATION_POLICY. If no policy row
 * is active, buckets are written with no expiry, so expiry is reported as null.
 */
import type { Express, Request, Response } from "express";
import { PAYOUT_HOLD_DAYS, PAYOUT_MIN_CENTS } from "../services/guardrailPolicy";

/** "$10" for whole dollars, "$10.50" otherwise. */
export function formatPayoutMinimum(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export interface PointsExpiry {
  earnedDays: number | null;
  purchasedDays: number | null;
  bonusDays: number | null;
}

export interface PointsValueSnapshot {
  centsPerPoint: number;
  policyEffectiveFrom: string | null;
  expiry: PointsExpiry | null;
}

export function rebatesLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REBATES_LIVE === "true";
}

export function buildPointsValueResponse(snap: PointsValueSnapshot, live: boolean, now = new Date()) {
  const base = {
    rebateLive: live,
    sources: ["ebay", "goldin"],
    expiry: snap.expiry,
    // Same constants rebateService enforces (#232), so the copy cannot drift from the rule.
    payoutMinimum: { cents: PAYOUT_MIN_CENTS, display: formatPayoutMinimum(PAYOUT_MIN_CENTS) },
    holdDays: PAYOUT_HOLD_DAYS,
    asOf: now.toISOString(),
  };
  if (!live) return base;
  return { ...base, centsPerPoint: snap.centsPerPoint, policyEffectiveFrom: snap.policyEffectiveFrom };
}

async function defaultLoader(): Promise<PointsValueSnapshot> {
  const { treasuryService } = await import("../services/treasuryService");
  const { bucketService } = await import("../services/bucketService");
  const [value, policy] = await Promise.all([
    treasuryService.getPackptsValueCents(),
    bucketService.getCurrentPolicy(),
  ]);
  return {
    ...value,
    expiry: policy
      ? {
          earnedDays: policy.earnedDaysToExpire ?? null,
          purchasedDays: policy.purchasedDaysToExpire ?? null,
          bonusDays: policy.bonusDefaultDaysToExpire ?? null,
        }
      : null,
  };
}

let loader: () => Promise<PointsValueSnapshot> = defaultLoader;
export function setPointsValueLoaderForTests(next: (() => Promise<PointsValueSnapshot>) | null): void {
  loader = next ?? defaultLoader;
}

export function registerPointsValueRoute(app: Express): void {
  app.get("/api/points/value", async (_req: Request, res: Response) => {
    try {
      const snap = await loader();
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(buildPointsValueResponse(snap, rebatesLive()));
    } catch (err) {
      console.error("[points/value] failed", err);
      res.status(503).json({ rebateLive: false, error: "unavailable" });
    }
  });
}
