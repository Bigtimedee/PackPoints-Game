import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
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
    expect(home).toContain('Redeem them for cashback on eligible real trading cards from eBay and Goldin.');
    expect(home.indexOf('Redeem them for cashback')).toBeLessThan(home.indexOf('data-testid="button-play-now"'));
    expect(home).toContain('after your purchase is confirmed');
    expect(home).toContain('do not change the price eBay charges');
  });
});
