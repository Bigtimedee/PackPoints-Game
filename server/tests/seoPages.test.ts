import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { renderSeoHtml, resolveSeoPage, HOME_TITLE, type SeoSet } from "../lib/seoPages";
import { SPA_ROUTE_PATTERNS, isKnownSpaRoute } from "@shared/spaRoutes";
import { ROBOTS_TXT, buildSitemapXml } from "../routes/seo.routes";
import { CARD_BLOCKLIST } from "../lib/cardBlocklist";
import { setShareSlug } from "../contentFactory/makerShareSlug";

const root = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
const setRows = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/seoSets.json"), "utf8")) as Omit<SeoSet, "slug">[];
const SETS: SeoSet[] = setRows.map((s) => ({ ...s, slug: setShareSlug(s.setName, s.id) }));
const deps = {
  listSets: async () => SETS,
  resolveSet: async (ref: string) => SETS.find((s) => s.slug === ref || s.id === ref) ?? null,
};

const SALT = "packpts-seo-v1:";
const hash = (s: string) => crypto.createHash("sha256").update(SALT + s).digest("hex").slice(0, 20);
const livePool = new Set<string>(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/poolSurnameHashes.json"), "utf8")).hashes);
const blockedPool = new Set(CARD_BLOCKLIST.map((e) => {
  const words = e.playerIncludes.toLowerCase().split(/\s+/).filter(Boolean);
  return words[words.length - 1].replace(/[^a-z]/g, "");
}).filter((s) => s.length >= 3));

/**
 * What a reader or crawler can see as content: visible text, <title>, alt and
 * title attributes, description / og / twitter / keywords meta, and JSON-LD
 * string values. Technical tokens (iOS status-bar style, schema keys) are not content.
 */
export function seoVisibleText(html: string): string {
  const parts: string[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const walk = (v: unknown): void => { if (typeof v === "string") parts.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
    walk(JSON.parse(m[1]));
  }
  for (const m of html.matchAll(/<meta\s+(?:name|property)="(description|keywords|og:[^"]+|twitter:[^"]+)"\s+content="([^"]*)"/g)) parts.push(m[2]);
  for (const m of html.matchAll(/\s(?:alt|title|aria-label)="([^"]*)"/g)) parts.push(m[1]);
  parts.push(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " "));
  return parts.join(" ");
}

/** Every word and adjacent word pair, letters only. */
function surnameHits(html: string): string[] {
  const words = seoVisibleText(html).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const hits = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    const cands = [words[i], i + 1 < words.length ? words[i] + words[i + 1] : ""];
    for (const c of cands) {
      if (c.length < 3) continue;
      if (livePool.has(hash(c)) || blockedPool.has(c)) hits.add(c);
    }
  }
  return [...hits];
}

const SEO_URLS = ["/", "/daily", "/daily5", "/sets", "/how-to-play", "/points", ...SETS.map((s) => `/sets/${s.slug}`)];

describe("SEO pages", () => {
  it("fixtures are real snapshots", () => {
    expect(livePool.size).toBeGreaterThan(1000);
    expect(SETS.length).toBeGreaterThanOrEqual(10);
  });

  it("the surname scan catches a planted name", () => {
    expect(surnameHits(`<p>${"x"}</p>`)).toEqual([]);
    const planted = CARD_BLOCKLIST[0].playerIncludes;
    expect(surnameHits(`<p>${planted}</p>`).length).toBeGreaterThan(0);
  });

  for (const url of SEO_URLS) {
    it(`${url}: 200, own canonical, H1, 150 to 400 words, plain links, no player surnames, no dashes`, async () => {
      const page = await resolveSeoPage(url, deps);
      expect(page.status).toBe(200);
      const html = renderSeoHtml(indexHtml, page);
      const canon = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
      const want = url === "/daily5" ? "https://packpts.com/daily" : `https://packpts.com${url}`;
      expect(canon).toBe(want);
      expect((html.match(/<h1>/g) || []).length).toBe(1);
      const main = /<main id="seo-content"[^>]*>([\s\S]*?)<\/main>/.exec(html)![1];
      const words = main.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
      expect(words).toBeGreaterThanOrEqual(150);
      expect(words).toBeLessThanOrEqual(400);
      for (const href of ["/daily", "/sets", "/how-to-play", "/points"]) expect(main).toContain(`href="${href}"`);
      expect(surnameHits(html)).toEqual([]);
      expect(html).not.toMatch(/[\u2013\u2014]/);
      expect(html).not.toMatch(/Goldin/i);
    });
  }

  it("homepage title is the approved one; /points and /daily have their own head", async () => {
    const home = renderSeoHtml(indexHtml, await resolveSeoPage("/", deps));
    expect(home).toContain(`<title>${HOME_TITLE.replace(/&/g, "&amp;")}</title>`);
    expect(HOME_TITLE).toBe("PackPTS: Name the Player Sports Card Game | Earn Points");
    const points = renderSeoHtml(indexHtml, await resolveSeoPage("/points", deps));
    expect(points).not.toContain(`<title>${HOME_TITLE}</title>`);
    expect(points).toContain('<link rel="canonical" href="https://packpts.com/points" />');
    const daily = renderSeoHtml(indexHtml, await resolveSeoPage("/daily", deps));
    expect(daily).toContain('<link rel="canonical" href="https://packpts.com/daily" />');
  });

  it("unknown routes and unknown set ids are 404 with noindex and no canonical", async () => {
    for (const url of ["/nope-xyz", "/how-it-works", "/sets/not-a-real-set-00000000"]) {
      const page = await resolveSeoPage(url, deps);
      expect(page.status).toBe(404);
      const html = renderSeoHtml(indexHtml, page);
      expect(html).toContain('<meta name="robots" content="noindex" />');
      expect(html).not.toContain('rel="canonical"');
      expect(html).toContain('<div id="root">');
    }
  });

  it("set lookup errors never 404", async () => {
    const page = await resolveSeoPage("/sets/anything", { listSets: async () => [], resolveSet: async () => { throw new Error("db"); } });
    expect(page.status).toBe(200);
  });

  it("app pages get a self canonical and private ones are noindex", async () => {
    const lb = await resolveSeoPage("/leaderboard?x=1", deps);
    expect(lb.canonical).toBe("https://packpts.com/leaderboard");
    expect((await resolveSeoPage("/admin/users", deps)).noindex).toBe(true);
    expect((await resolveSeoPage("/game/solo", deps)).noindex).toBe(true);
  });

  it("every App.tsx route is known to the server", () => {
    const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
    const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    for (const p of paths) expect(SPA_ROUTE_PATTERNS, p).toContain(p);
    expect(isKnownSpaRoute("/sets/abc")).toBe(true);
    expect(isKnownSpaRoute("/wp-login.php")).toBe(false);
  });

  it("robots.txt and sitemap.xml", () => {
    expect(ROBOTS_TXT).toContain("Disallow: /api/qa/");
    expect(ROBOTS_TXT).toContain("Disallow: /api/play/");
    expect(ROBOTS_TXT).toContain("Sitemap: https://packpts.com/sitemap.xml");
    const xml = buildSitemapXml(SETS.map((s) => s.slug));
    for (const u of ["/", "/daily", "/sets", "/how-to-play", "/points"]) expect(xml).toContain(`<loc>https://packpts.com${u}</loc>`);
    expect((xml.match(/<url>/g) || []).length).toBe(5 + SETS.length);
    expect(surnameHits(xml)).toEqual([]);
  });

  it("index.html no longer names Goldin and drops the TikTok title comment", () => {
    expect(indexHtml).not.toMatch(/Goldin/i);
    expect(indexHtml).not.toContain("Title MUST equal the TikTok app name");
  });
});
