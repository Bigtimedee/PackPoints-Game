import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKPTS_KEEP_SHARE_LABEL, USER_REBATE_SHARE, USER_REBATE_SHARE_LABEL, rebateReceiptSplit } from "@shared/rebateEconomics";
import * as copy from "../../client/src/lib/pointsCopy";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/**
 * Public copy must not state what share of an eBay or EPN commission anyone keeps.
 * A digit percent within the same sentence as "commission", a spelled share, or
 * the display labels all fail. The name-leak check is a separate CI step.
 */
export const COMMISSION_PERCENT_COPY =
  /\b\d+(?:\.\d+)?\s*(?:%|\bpercent\b)[^.\n]{0,80}\bcommission\b|\bcommission\b[^.\n]{0,80}\b\d+(?:\.\d+)?\s*(?:%|\bpercent\b)|\b(?:percent|percentage)\s+of\s+(?:the\s+)?(?:ebay\s+|epn\s+)?commission\b|\bkeeps?\s+the\s+other\s+\d+\s*(?:%|\bpercent\b)|\bshare\s+of\s+(?:the\s+)?(?:ebay\s+|epn\s+)?commission\b|\b100\s*(?:%|\bpercent\b)\s+of\s+(?:the\s+)?commission\b|\b\d+\s*\/\s*\d+\s+split\b|USER_REBATE_SHARE_LABEL|PACKPTS_KEEP_SHARE_LABEL/i;

const PUBLIC_COPY_FILES = [
  "client/index.html",
  "server/lib/seoPages.ts",
  "server/lib/routeOg.ts",
  "server/lib/playSetsHtml.ts",
  "server/routes/seo.routes.ts",
  "server/services/emailService.ts",
  "docs/seo/build_kit.py",
  "docs/seo/SEO_PLAN.md",
];

function walkPublic(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkPublic(full, out);
    else if (/\.(tsx?|html|json|md|txt|py)$/.test(name)) out.push(path.relative(root, full));
  }
  return out;
}

function publicCopyFiles(): string[] {
  const walked = [
    ...walkPublic(path.join(root, "client/src/pages")),
    ...walkPublic(path.join(root, "client/src/components")),
    ...walkPublic(path.join(root, "client/src/lib")),
    ...walkPublic(path.join(root, "client/public")),
    ...walkPublic(path.join(root, "docs/seo/content")),
    ...walkPublic(path.join(root, "public")),
  ];
  return [...new Set([...PUBLIC_COPY_FILES, ...walked])];
}

describe("rebate split copy", () => {
  it("keeps the named rates at 70% and 30%", () => {
    expect(USER_REBATE_SHARE).toBe(0.7);
    expect(USER_REBATE_SHARE_LABEL).toBe("70%");
    expect(PACKPTS_KEEP_SHARE_LABEL).toBe("30%");
  });

  it("the commission percentage check catches a split and allows plain cashback", () => {
    expect(COMMISSION_PERCENT_COPY.test("your rebate is 70% of the commission eBay confirms")).toBe(true);
    expect(COMMISSION_PERCENT_COPY.test("you get 70% of the commission eBay confirms on that sale")).toBe(true);
    expect(COMMISSION_PERCENT_COPY.test("Points toward eBay cashback (70% of the eBay commission)")).toBe(true);
    expect(COMMISSION_PERCENT_COPY.test("PackPTS keeps the other 30%")).toBe(true);
    expect(COMMISSION_PERCENT_COPY.test("Your rebate is 100% of the commission confirmed for this purchase.")).toBe(true);
    expect(COMMISSION_PERCENT_COPY.test("Get a Share of the eBay Commission Back")).toBe(true);
    expect(COMMISSION_PERCENT_COPY.test("the 70/30 split")).toBe(true);
    expect(COMMISSION_PERCENT_COPY.test("percent of the commission eBay confirms")).toBe(true);
    expect(COMMISSION_PERCENT_COPY.test("{USER_REBATE_SHARE_LABEL} of the commission")).toBe(true);
    expect(COMMISSION_PERCENT_COPY.test("You earn real cashback on that purchase.")).toBe(false);
    expect(COMMISSION_PERCENT_COPY.test("PackPTS earns a commission on eBay purchases through our links.")).toBe(false);
    expect(COMMISSION_PERCENT_COPY.test("It depends on the commission eBay confirms for that sale.")).toBe(false);
    expect(COMMISSION_PERCENT_COPY.test("commission on one line.\nclicks drop from 15% to 8%")).toBe(false);
  });

  it("public copy fails on any commission percentage", () => {
    const files = publicCopyFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const rel of files) {
      const text = read(rel);
      expect(text, rel).not.toMatch(COMMISSION_PERCENT_COPY);
      expect(text, rel).not.toContain("your rebate equals the commission");
      expect(text, rel).not.toContain("seven tenths");
    }
    const lines = [
      copy.pageSteps(true)[2].body,
      copy.pageSteps(false)[2].body,
      copy.addingAnswer(true, null),
      copy.WALLET.live("$1.00"),
      copy.storeLine("$1.25", null, true),
      copy.storeLine(null, null, true),
      rebateReceiptSplit(),
      rebateReceiptSplit(0.7),
      rebateReceiptSplit(1),
    ];
    for (const line of lines) {
      expect(line, line).not.toMatch(COMMISSION_PERCENT_COPY);
      expect(line.toLowerCase()).toContain("earn real cashback");
    }
    const points = JSON.parse(read("docs/seo/content/core-pages.json")).core.find((p: { path: string }) => p.path === "/points");
    const daily = JSON.parse(read("docs/seo/content/core-pages.json")).core.find((p: { path: string }) => p.path === "/daily");
    const pointsJson = JSON.stringify(points);
    const dailyJson = JSON.stringify(daily);
    expect(pointsJson.toLowerCase()).toContain("earn real cashback");
    expect(dailyJson.toLowerCase()).toContain("earn real cashback");
    expect(pointsJson).not.toContain("seven tenths");
    // No commission percentage is exempt. Any other money token on /points still fails.
    expect(pointsJson).not.toMatch(/[$%]|\bpercent\b|\bdollars?\b/);
    expect(read("client/src/pages/terms-of-service.tsx")).toContain("You earn real cashback on that purchase, up to the value of the points you applied.");
    expect(read("client/src/pages/marketplace.tsx")).toContain("you earn real cashback");
    expect(read("server/lib/seoPages.ts")).toContain("You earn real cashback on that purchase.");
    expect(read("server/services/emailService.ts")).toContain("rebateReceiptSplit(details.userShareRate)");
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
    expect(read("client/src/components/receipt-plaque.tsx")).toContain("plaque.splitLine");
    expect(read("client/src/pages/redemptions.tsx")).toContain("userShareRate: credit?.userShareRate");
    expect(rebateReceiptSplit()).toBe("You earn real cashback on this purchase.");
    expect(rebateReceiptSplit(1)).toBe("You earn real cashback on this purchase.");
    expect(rebateReceiptSplit()).not.toMatch(/[\u2013\u2014]/);
    expect(rebateReceiptSplit()).not.toMatch(/\d/);
  });
});
