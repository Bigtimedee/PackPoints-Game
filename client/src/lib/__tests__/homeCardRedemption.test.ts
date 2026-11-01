import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { HOME_HERO } from "../pointsCopy";
const home = readFileSync(new URL("../../pages/home.tsx", import.meta.url), "utf8");
const covers = readFileSync(new URL("../../../../server/services/setCovers.ts", import.meta.url), "utf8");
describe("home reuses gameplay and explains redemption", () => {
  it("uses GameCard and the scan-specific bake plan without a raw image fallback", () => {
    expect(home).toContain('<GameCard imageUrl={cover.imageUrl} maskPlan={cover.maskPlan}');
    expect(home).toContain('/plaque?retry=');
    expect(home).not.toContain('X-Mask-Plan');
    expect(home).toContain('if (!maskPlan) throw');
    expect(home).not.toContain('<img');
    expect(covers).not.toContain('X-Mask-Plan"');
    expect(covers).toContain('res.json({ maskPlan, options })');
    expect(covers).toContain('toPublicMaskPlan(JSON.parse(readFileSync(planFile');
  });
  it("puts eligible real-card cashback in the hero, before Play Now", () => {
    expect(HOME_HERO.live).toBe('Earn PackPTS for cashback on eligible real cards from eBay.');
    expect(HOME_HERO.soon).toBe(HOME_HERO.live);
    expect(home).toContain('{heroRebateLive ? HOME_HERO.live : HOME_HERO.soon}');
    expect(home.indexOf('HOME_HERO.live : HOME_HERO.soon')).toBeLessThan(home.indexOf('data-testid="button-play-now"'));
    expect(home.indexOf('HOME_HERO_TYPE.steps')).toBeLessThan(home.indexOf('data-testid="button-play-now"'));
    expect(home).toMatch(/data-testid="button-play-now"[\s\S]{0,160}href="\/daily5"/);
    expect(home).not.toContain('Pay the normal marketplace price');
    expect(home).toContain('Who is on this 1987 Topps card?');
    expect(home).toContain('<AnswerButton');
    expect(home).not.toContain('X-Card-Options');
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

import { HOME_HERO_TYPE, heroHeadline } from "../pointsCopy";
import kit from "../../../../docs/seo/content/core-pages.json";
describe("home hero type", () => {
  const h1 = (kit as any).core.find((p: any) => p.path === "/").h1 as string;
  it("renders the kit H1 visibly, split so the text matches SSR exactly", () => {
    expect(heroHeadline(h1)).toEqual(["Name the player.", "Earn real cashback."]);
    expect(heroHeadline(h1).join(" ")).toBe(h1);
    expect(home).toContain('data-testid="text-hero-title"');
    expect(home).not.toMatch(/<h1[^>]*sr-only/);
  });
  it("has no dashes, money amounts, point values or coming soon", () => {
    const all = [h1, HOME_HERO_TYPE.subhead, HOME_HERO_TYPE.trust, ...HOME_HERO_TYPE.steps.map(s => `${s.key} ${s.rest}`)].join(" ");
    expect(all).not.toMatch(/[\u2013\u2014]|\$|\d|coming soon/i);
    expect(HOME_HERO_TYPE.steps).toHaveLength(3);
  });
});
