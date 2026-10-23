import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKPTS_KEEP_SHARE_LABEL, USER_REBATE_SHARE, USER_REBATE_SHARE_LABEL } from "@shared/rebateEconomics";
import { rebateReceiptSplit } from "../services/emailService";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const SPLIT = `your rebate is ${USER_REBATE_SHARE_LABEL} of the commission eBay confirms on that sale.`;
const TERMS = `Your rebate is ${USER_REBATE_SHARE_LABEL} of the commission eBay reports to us for that purchase, up to the value of the points you applied. PackPTS keeps the other ${PACKPTS_KEEP_SHARE_LABEL}.`;

describe("rebate split copy", () => {
  it("keeps the named rates at 70% and 30%", () => {
    expect(USER_REBATE_SHARE).toBe(0.7);
    expect(USER_REBATE_SHARE_LABEL).toBe("70%");
    expect(PACKPTS_KEEP_SHARE_LABEL).toBe("30%");
  });

  it("terms, marketplace, SEO kit and the points page state the 70% split", () => {
    expect(read("client/src/pages/terms-of-service.tsx")).toContain(TERMS);
    const market = read("client/src/pages/marketplace.tsx");
    expect(market).toContain("{USER_REBATE_SHARE_LABEL} of the commission eBay confirms");
    expect(market).toContain("PackPTS keeps the other {PACKPTS_KEEP_SHARE_LABEL}");
    expect(market).not.toContain("equals the commission");
    expect(read("server/lib/seoPages.ts")).toContain("The rebate is 70% of the commission eBay confirms for the sale.");
    for (const rel of ["docs/seo/content/core-pages.json", "docs/seo/content/core-pages.md", "docs/seo/build_kit.py"]) {
      const text = read(rel);
      expect(text, rel).toContain(SPLIT);
      expect(text, rel).not.toContain("your rebate equals the commission");
    }
    expect(read("docs/seo/content/core-pages.json").match(/your rebate is 70% of the commission eBay confirms on that sale\./g)?.length).toBe(7);
  });

  it("split copy has no em or en dashes and does not say coming soon or unlimited", () => {
    const files = [
      "client/src/lib/pointsCopy.ts",
      "client/src/pages/marketplace.tsx",
      "client/src/pages/terms-of-service.tsx",
      "server/lib/seoPages.ts",
      "docs/seo/content/core-pages.json",
      "docs/seo/build_kit.py",
    ];
    for (const rel of files) {
      const text = read(rel);
      expect(text, rel).not.toMatch(/[\u2013\u2014]/);
      expect(text.toLowerCase(), rel).not.toContain("coming soon");
      expect(text.toLowerCase(), rel).not.toContain("unlimited rebate");
    }
    const email = read("server/services/emailService.ts");
    const receipt = email.slice(email.indexOf("export function rebateReceiptSplit"));
    expect(receipt).toContain("${USER_REBATE_SHARE_LABEL} of the commission confirmed for this purchase");
    expect(receipt).toContain("PackPTS keeps the other ${PACKPTS_KEEP_SHARE_LABEL}");
    expect(receipt).not.toMatch(/[\u2013\u2014]/);
    expect(rebateReceiptSplit()).toBe(`Your rebate is ${USER_REBATE_SHARE_LABEL} of the commission confirmed for this purchase. PackPTS keeps the other ${PACKPTS_KEEP_SHARE_LABEL}.`);
    expect(rebateReceiptSplit(1)).toBe("Your rebate is 100% of the commission confirmed for this purchase.");
    expect(rebateReceiptSplit()).not.toMatch(/[\u2013\u2014]/);
  });
});
