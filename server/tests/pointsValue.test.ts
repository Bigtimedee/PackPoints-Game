import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import fs from "fs";
import path from "path";
import { buildPointsValueResponse, rebatesLive, registerPointsValueRoute, setPointsValueLoaderForTests } from "../routes/pointsValue";
import { PAYOUT_HOLD_DAYS, PAYOUT_MIN_CENTS } from "../services/guardrailPolicy";
import * as copy from "../../client/src/lib/pointsCopy";

const snap = { centsPerPoint: 0.2, policyEffectiveFrom: "2026-01-01T00:00:00.000Z", expiry: { earnedDays: 365, purchasedDays: null, bonusDays: 90 } };

async function get(app: express.Express) {
  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/points/value`);
    return { status: r.status, cache: r.headers.get("cache-control"), body: await r.json() };
  } finally { server.close(); }
}

describe("GET /api/points/value", () => {
  afterEach(() => setPointsValueLoaderForTests(null));

  it("rebateLive defaults to false and omits any rate", async () => {
    setPointsValueLoaderForTests(async () => snap);
    const prev = process.env.REBATES_LIVE; delete process.env.REBATES_LIVE;
    const app = express(); registerPointsValueRoute(app);
    const r = await get(app);
    process.env.REBATES_LIVE = prev;
    expect(r.status).toBe(200);
    expect(r.cache).toContain("max-age=60");
    expect(r.body.rebateLive).toBe(false);
    expect(r.body.centsPerPoint).toBeUndefined();
    expect(r.body.expiry).toEqual(snap.expiry);
    expect(r.body.payoutMinimum).toEqual({ cents: PAYOUT_MIN_CENTS, display: "$10" });
    expect(r.body.holdDays).toBe(PAYOUT_HOLD_DAYS);
  });

  it("only exact REBATES_LIVE=true flips it", () => {
    expect(rebatesLive({} as any)).toBe(false);
    expect(rebatesLive({ REBATES_LIVE: "1" } as any)).toBe(false);
    expect(rebatesLive({ REBATES_LIVE: "true" } as any)).toBe(true);
    expect(buildPointsValueResponse(snap, true).centsPerPoint).toBe(0.2);
  });

  it("redemption math and endpoint share one rate lookup", () => {
    const src = fs.readFileSync(path.join(__dirname, "../services/treasuryService.ts"), "utf8");
    const body = src.slice(src.indexOf("async computeAllowedRedemption("));
    expect(body.slice(0, 600)).toContain("getPackptsValueCents()");
  });
});

describe("payout terms", () => {
  it("formats the minimum", async () => {
    const { formatPayoutMinimum } = await import("../routes/pointsValue");
    expect(formatPayoutMinimum(1000)).toBe("$10");
    expect(formatPayoutMinimum(1050)).toBe("$10.50");
  });
  it("endpoint reads the enforced constants, not literals", () => {
    const src = fs.readFileSync(path.join(__dirname, "../routes/pointsValue.ts"), "utf8");
    expect(src).toContain("cents: PAYOUT_MIN_CENTS");
    expect(src).toContain("holdDays: PAYOUT_HOLD_DAYS");
  });
});

describe("points copy", () => {
  const allStrings = (live: boolean) => [
    copy.PRIMARY.live, copy.PRIMARY.soon, copy.GUEST_KEEP, copy.FOOTNOTE_LIVE, copy.primaryCta(live),
    ...copy.stripSteps(live).flatMap((s) => [s.title, s.body]),
    ...copy.pageSteps(live).flatMap((s) => [s.title, s.body]),
    copy.valueLine(320, null), copy.expiryAnswer(snap.expiry), copy.checkoutAnswer(live), copy.addingAnswer(live, snap.expiry),
  ];
  it("has no em or en dashes", () => {
    const extra = [copy.WALLET.live("$1.00"), copy.storeLine("$1.00", snap.expiry, true), copy.storeLine(null, null, true)];
    for (const s of [...allStrings(true), ...allStrings(false), ...extra]) expect(s).not.toMatch(/[\u2013\u2014]/);
  });
  it("states the 70/30 split without promising unlimited rebates", () => {
    const split = copy.pageSteps(true)[2].body;
    expect(split).toContain("70% of the commission eBay confirms");
    expect(split).toContain("PackPTS keeps the other 30%");
    expect(split).toContain("60 days");
    expect(split).toContain("$10");
    expect(copy.addingAnswer(true, snap.expiry).toLowerCase()).not.toContain("unlimited");
    expect(copy.WALLET.live("$1.00")).toContain("70%");
    expect(copy.storeLine("$2.00", null, true)).toContain("70%");
    expect(copy.storeLine("$2.00", null, true).toLowerCase()).not.toContain("coming soon");
  });
  it("no surface ever carries rebate-off copy (Dave lock, Oct 12)", () => {
    for (const s of [...allStrings(true), ...allStrings(false), copy.WALLET.soon, copy.HOME_HERO.soon, copy.tourEarnStep(false), copy.storeLine(null, null, true)]) {
      expect(s).not.toMatch(/open soon|coming soon|once they open|when rebates open|soon you/i);
    }
  });
  it.skip("rebateLive=false surfaces carry no $ (superseded: no off-state copy)", () => {
    const soon = [copy.PRIMARY.soon, copy.primaryCta(false), ...copy.stripSteps(false).flatMap((s) => [s.title, s.body]), ...copy.pageSteps(false).flatMap((s) => [s.title, s.body]), copy.valueLine(320, copy.usdFor({ rebateLive: false, centsPerPoint: 0.2, expiry: null }, 320)), copy.checkoutAnswer(false), copy.addingAnswer(false, snap.expiry), copy.expiryAnswer(snap.expiry)];
    for (const s of soon) expect(s).not.toContain("$");
  });
  it("FAQ expiry follows the live policy", () => {
    expect(copy.expiryAnswer(snap.expiry)).toBe("Points you earn by playing last 365 days from when you earn them. Points you buy never expire. Bonus points last 90 days.");
    expect(copy.expiryAnswer({ earnedDays: 180, purchasedDays: null, bonusDays: 30 })).toContain("last 180 days");
    expect(copy.expiryAnswer(null)).toContain("don't expire");
  });
  it("value line matches the deck", () => {
    expect(copy.valueLine(320, null)).toBe("You have 320 points. Use them for cash back on real cards.");
    expect(copy.valueLine(1000, "$2.00")).toBe("Your 1,000 points are worth up to $2.00 back on eligible eBay cards.");
  });
});
