/**
 * Product-UI SoR: do not claim Apply PackPTS reduces eBay checkout
 * price/fees, or that PackPTS issues real eBay gift cards.
 *
 * Audit: docs/audits/APPLY_PACKPTS_EBAY_2026-09-20.md
 */
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PRODUCT_ROOTS = [
  path.join(ROOT, "client/src/pages"),
  path.join(ROOT, "client/src/components"),
];

const EXTRA_FILES = [
  path.join(ROOT, "client/index.html"),
  path.join(ROOT, "client/public/manifest.webmanifest"),
  path.join(ROOT, "server/storage.ts"),
  path.join(ROOT, "server/routes.ts"),
];

const TEXT_EXT = new Set([".tsx", ".ts", ".html", ".webmanifest"]);

/** Exact unsafe live strings from the 2026-09-20 audit. */
const BANNED_PHRASES = [
  "apply at checkout",
  "eBay Gift Card",
  "10% discount on qualifying",
  "toward this purchase on",
  "Use your credit token at checkout",
  "Check your email for instructions",
  "Use your PackPTS as a discount",
  "eBay card discounts",
  "Get Discount",
];

function walkTextFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTextFiles(full, out);
      continue;
    }
    if (TEXT_EXT.has(path.extname(name))) out.push(full);
  }
  return out;
}

function productFiles(): string[] {
  const files = PRODUCT_ROOTS.flatMap((dir) => walkTextFiles(dir));
  return [...files, ...EXTRA_FILES];
}

describe("eBay apply-PackPTS product copy honesty", () => {
  const files = productFiles();

  it("scans the product UI + catalog + redeem API message surfaces", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("home.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("marketplace.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("partners.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("roadmap.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("storage.ts"))).toBe(true);
  });

  it("rejects banned checkout-discount and gift-card claim strings", () => {
    const hits: { file: string; phrase: string }[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const phrase of BANNED_PHRASES) {
        if (text.includes(phrase)) {
          hits.push({ file: path.relative(ROOT, file), phrase });
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("keeps honest wallet-side language on marketplace + home FAQ", () => {
    const marketplace = readFileSync(path.join(ROOT, "client/src/pages/marketplace.tsx"), "utf8");
    const home = readFileSync(path.join(ROOT, "client/src/pages/home.tsx"), "utf8");
    const storage = readFileSync(path.join(ROOT, "server/storage.ts"), "utf8");
    const routes = readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");

    expect(marketplace).toMatch(/do not change the price/i);
    expect(home).toMatch(/do not change the price eBay charges/i);
    expect(storage).toMatch(/PackPTS Credit Token/);
    expect(storage).not.toMatch(/eBay Gift Card/);
    expect(routes).toMatch(/not usable at eBay or Goldin checkout/);
  });
});
