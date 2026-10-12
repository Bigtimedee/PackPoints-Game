import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { HOME_HERO } from "../pointsCopy";
const home = readFileSync(new URL("../../pages/home.tsx", import.meta.url), "utf8");
const covers = readFileSync(new URL("../../../../server/services/setCovers.ts", import.meta.url), "utf8");
describe("home reuses gameplay and explains redemption", () => {
  it("uses GameCard and the scan-specific bake plan without a raw image fallback", () => {
    expect(home).toContain('<GameCard imageUrl={cover.imageUrl} maskPlan={cover.maskPlan}');
    expect(home).toContain('response.headers.get("X-Mask-Plan")');
    expect(home).toContain('if (!maskPlan) throw');
    expect(home).not.toContain('<img');
    expect(covers).toContain('res.setHeader("X-Mask-Plan", JSON.stringify(maskPlan))');
    expect(covers).toContain('toPublicMaskPlan(JSON.parse(readFileSync(planFile');
  });
  it("puts eligible real-card cashback in the hero, before Play Now", () => {
    expect(HOME_HERO.live).toBe('Earn PackPTS for cashback on eligible real cards from eBay.');
    expect(HOME_HERO.soon).toBe(HOME_HERO.live);
    expect(home).toContain('{heroRebateLive ? HOME_HERO.live : HOME_HERO.soon}');
    expect(home.indexOf('HOME_HERO.live : HOME_HERO.soon')).toBeLessThan(home.indexOf('data-testid="button-play-now"'));
    expect(home).not.toContain('Pay the normal marketplace price');
    expect(home).toContain('Who is on this 1987 Topps card?');
    expect(home).toContain('<AnswerButton');
    expect(home).toContain('response.headers.get("X-Card-Options")');
    expect(home).toContain('do not change the price eBay charges');
  });
});

import { holdLine } from "../pointsCopy";
describe("hold line", () => {
  it("reads hold days and minimum from the live value", () => {
    expect(holdLine({ rebateLive: true, expiry: null, holdDays: 30, payoutMinimum: { cents: 1000, display: "$10" } }))
      .toBe("Rebates are held 30 days, then you can cash out from $10. Payouts are reviewed before they're sent.");
    expect(holdLine({ rebateLive: false, expiry: null, holdDays: 30, payoutMinimum: { cents: 1000, display: "$10" } })).toBeNull();
    expect(holdLine({ rebateLive: true, expiry: null })).toBeNull();
  });
});
