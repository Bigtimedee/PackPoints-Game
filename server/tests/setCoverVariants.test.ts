import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { coverVariantBytes } from "../services/setCovers";
import { setCoverSrcSet, setCoverVariantUrl, setCoverVersionFromEtag, SET_COVER_WIDTHS } from "@shared/setCoverUrl";
import { firstRowCoverPreloads, renderSeoHtml, resolveSeoPage } from "../lib/seoPages";

const ID = "2b77043a-0000-4000-8000-000000000001";
const base = `/api/sets/${ID}/covers/0`;

describe("/sets cover variants", () => {
  it("downscales the masked JPEG to webp without cropping", async () => {
    const jpeg = await sharp({ create: { width: 750, height: 1050, channels: 3, background: "#204080" } }).jpeg().toBuffer();
    const out = await coverVariantBytes("/tmp/x.jpg", 1, 240, async () => jpeg);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(240);
    expect(meta.height).toBe(336);
    expect(out.length).toBeLessThan(jpeg.length);
  });

  it("variant URLs carry only the slot, width and a hash version", () => {
    const v = setCoverVersionFromEtag('"abcdef0123456789abcdef"');
    expect(v).toBe("abcdef012345");
    expect(setCoverVariantUrl(base, 180, v)).toBe(`${base}?w=180&f=webp&v=abcdef012345`);
    expect(setCoverVariantUrl(base, 180, "not-a-version")).toBe(`${base}?w=180&f=webp`);
    expect(setCoverSrcSet(base, v).split(", ")).toHaveLength(SET_COVER_WIDTHS.length);
  });

  it("/sets HTML preloads the first row with the same srcset as the img", async () => {
    const sets = [{ id: ID, setName: "1986 Topps Baseball", year: 1986, brand: "Topps", sport: "baseball", cardCount: 407, slug: "x", coverUrls: [base], coverVersions: ["abcdef012345"] }];
    expect(firstRowCoverPreloads(sets)[0]).toContain(`imagesrcset="${setCoverSrcSet(base, "abcdef012345")}"`);
    const html = renderSeoHtml("<html><head><title>x</title></head><body><div id=\"root\"><!--seo-content--></div></body></html>",
      await resolveSeoPage("/sets", { listSets: async () => sets, resolveSet: async () => null }));
    expect(html).toContain('fetchpriority="high"');
    // Server-rendered first row: same srcset and CORS mode as the app <img> and the preload.
    const main = /<main id="seo-content"[^>]*>([\s\S]*?)<\/main>/.exec(html)![1];
    expect(main).toContain(`srcset="${setCoverSrcSet(base, "abcdef012345")}"`);
    expect(main).toContain('alt="Masked 1986 Topps Baseball card"');
    expect(html.match(/rel="preload" as="image"[^>]*crossorigin="anonymous"/)).toBeTruthy();
    expect(html).not.toContain('href="/api/sets?limit=50"'); // list is inlined as JSON instead
    expect(firstRowCoverPreloads([{ ...sets[0], coverUrls: ["https://x.bubble.io/a.jpg"] }])).toEqual([]);
  });
});
