import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const DISCLOSURE = "PackPTS earns a commission on eBay purchases through our links.";

describe("GTM audit legal copy", () => {
  it("affiliate disclosure sits next to eBay links and on /points", () => {
    expect(read("../../components/affiliate-disclosure.tsx")).toContain(DISCLOSURE);
    expect(read("../../pages/points.tsx")).toContain("<AffiliateDisclosure");
    expect(read("../../pages/game.tsx")).toContain("<AffiliateDisclosure");
    expect(read("../../pages/marketplace.tsx").match(/<AffiliateDisclosure/g)?.length).toBeGreaterThanOrEqual(4);
    for (const p of ["../../pages/home.tsx", "../../pages/store.tsx", "../../pages/marketplace.tsx"]) {
      expect(read(p)).not.toContain("We may earn an affiliate commission");
    }
  });

  it("terms match the live product", () => {
    const t = read("../../pages/terms-of-service.tsx");
    expect(t).not.toContain("baseball trading card trivia game");
    expect(t).not.toContain("no one adds it by hand");
    expect(t).toContain("baseball, basketball or football");
    expect(t).toContain("60 days");
    expect(t).toContain("$10");
    expect(t).toContain("Purchased points can be applied to listings and count toward rebates");
    expect(t).toContain("except through the rebate program");
    expect(t).toContain("Submitted evidence never adds a rebate by itself");
    expect(t).toContain(DISCLOSURE);
    expect(t).toContain("/dmca");
    expect(t).not.toMatch(/[\u2013\u2014]/);
    expect(t).not.toMatch(/counsel/i);
  });

  it("DMCA page is routed and linked from both footers", () => {
    const d = read("../../pages/dmca.tsx");
    expect(d).toContain('TAKEDOWN_EMAIL = "support@packpts.com"');
    expect(d).not.toMatch(/[\u2013\u2014]/);
    expect(read("../../App.tsx")).toContain('<Route path="/dmca" component={DmcaPage} />');
    expect(read("../../pages/home.tsx")).toContain('href="/dmca"');
    expect(read("../../../index.html")).toContain('href="/dmca"');
  });
});
