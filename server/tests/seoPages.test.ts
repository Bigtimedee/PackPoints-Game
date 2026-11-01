import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { renderSeoHtml, resolveSeoPage, HOME_TITLE, KIT_SETS, type SeoSet } from "../lib/seoPages";
import { SPA_ROUTE_PATTERNS, isKnownSpaRoute } from "@shared/spaRoutes";
import { ROBOTS_TXT, buildSitemapXml, buildLlmsTxt } from "../routes/seo.routes";
import { stripHtmlComments } from "../lib/stripHtmlComments";
import { CARD_BLOCKLIST } from "../lib/cardBlocklist";
import { setShareSlug } from "../contentFactory/makerShareSlug";
import { renderSeoKitMain } from "../lib/playSetsHtml";

const root = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
const setRows = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/seoSets.json"), "utf8")) as Omit<SeoSet, "slug">[];
const SETS: SeoSet[] = setRows.map((s) => ({ ...s, slug: setShareSlug(s.setName, s.id) }));
const deps = {
  listSets: async () => SETS,
  resolveSet: async (ref: string) => SETS.find((s) => s.slug === ref || s.id === ref || ref.endsWith("-" + s.id.slice(0, 8))) ?? null,
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

const SEO_URLS = ["/", "/daily", "/sets", "/how-to-play", "/points", ...SETS.map((s) => `/sets/${s.slug}`)];

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
      // Word budget covers the answer and body; FAQ, facts, crumbs and links are extra.
      const prose = main.split(/<h2>Questions<\/h2>/)[0].replace(/<nav[\s\S]*?<\/nav>/g, " ").replace(/<dl>[\s\S]*?<\/dl>/g, " ");
      const words = prose.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
      expect(words).toBeGreaterThanOrEqual(url.startsWith("/sets/") ? 120 : 150);
      expect(words).toBeLessThanOrEqual(400);
      expect((main.match(/<a href="\/[^"]*"/g) || []).length).toBeGreaterThanOrEqual(3);
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
    expect((xml.match(/<url>/g) || []).length).toBe(6 + SETS.length);
    expect(surnameHits(xml)).toEqual([]);
  });

  it("llms.txt lists core pages and live sets", () => {
    const txt = buildLlmsTxt(SETS);
    expect(txt.startsWith("# PackPTS\n")).toBe(true);
    expect(txt).toContain("https://packpts.com/daily");
    for (const s of SETS) expect(txt).toContain(`https://packpts.com/sets/${s.slug}`);
    expect(txt).not.toMatch(/[\u2013\u2014]/);
    expect(surnameHits(txt)).toEqual([]);
  });

  it("strips developer comments from served HTML but keeps scripts", () => {
    const html = `<head><!-- dev note --><script>var a="<!-- keep -->";</script><style>/* x */</style></head><body><!--seo-content-->\n<!--\n multi\n-->\n<p>hi</p><!--[if IE]>x<![endif]--></body>`;
    const out = stripHtmlComments(html);
    expect(out).not.toContain("dev note");
    expect(out).not.toContain("multi");
    expect(out).toContain('var a="<!-- keep -->"');
    expect(out).toContain("<style>/* x */</style>");
    expect(out).toContain("<p>hi</p>");
    expect(out).toContain("<!--[if IE]>");
  });

  it("set kit: no Baseball Card Pedia FAQ, verified PSA reference section", () => {
    const raw = fs.readFileSync(path.join(root, "docs/seo/content/set-pages.json"), "utf8");
    expect(raw).not.toMatch(/Pedia/);
    const kit = JSON.parse(raw).sets as any[];
    const withRef = kit.filter((k) => k.reference);
    expect(withRef.length).toBeGreaterThanOrEqual(8);
    for (const k of withRef) {
      for (const [, href] of k.reference.sources) expect(href).toMatch(/^https:\/\/www\.(psacard|beckett)\.com\//);
      const main = renderSeoKitMain(k);
      expect(main).toContain("<h2>About the full set</h2>");
      if (k.reference.sizeText) expect(main).toContain(k.reference.sizeText);
      else if (k.reference.setSize) expect(main).toContain(`set has ${k.reference.setSize} cards.`);
      expect(main).not.toMatch(/[\u2013\u2014$]/);
    }
  });

  it("index.html no longer names Goldin and drops the TikTok title comment", () => {
    expect(indexHtml).not.toMatch(/Goldin/i);
    expect(indexHtml).not.toContain("Title MUST equal the TikTok app name");
  });
  it("kit pages: answer is the first <p>, kit JSON-LD replaces the shell's, set counts are live", async () => {
    const sets = JSON.parse(fs.readFileSync(path.join(root, "docs/seo/content/set-pages.json"), "utf8")).sets;
    const kit = sets[0];
    const live: SeoSet = { ...SETS.find((s) => s.id === kit.setId)!, cardCount: 999 };
    const d = { listSets: async () => SETS, resolveSet: async () => live };
    const html = renderSeoHtml(indexHtml, await resolveSeoPage(kit.path, d));
    const main = /<main id="seo-content"[^>]*>([\s\S]*?)<\/main>/.exec(html)![1];
    expect(/<\/h1><p>([^<]*)<\/p>/.exec(main)![1]).toBe(kit.answer.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/pool of \d+ /, "pool of 999 "));
    expect(main).toContain("<dd>999</dd>");
    expect(html).not.toContain(`pool of ${kit.facts.playableCards} `);
    expect((html.match(/application\/ld\+json/g) || []).length).toBe(1);
    expect(html).toContain('"@graph"');
    expect(main).toContain('aria-label="Breadcrumb"');
    const about = renderSeoHtml(indexHtml, await resolveSeoPage("/about", deps));
    expect(about).toContain('<link rel="canonical" href="https://packpts.com/about" />');
  });
  it("a renamed kit set canonicalizes to its live slug, matching the sitemap", async () => {
    const kit = JSON.parse(fs.readFileSync(path.join(root, "docs/seo/content/set-pages.json"), "utf8")).sets[0];
    const base = SETS.find((s) => s.id === kit.setId)!;
    const renamed: SeoSet = { ...base, setName: "Renamed Set", slug: setShareSlug("Renamed Set", base.id) };
    const page = await resolveSeoPage(`/sets/${renamed.slug}`, { listSets: async () => SETS, resolveSet: async () => renamed });
    expect(page.canonical).toBe(`https://packpts.com/sets/${renamed.slug}`);
  });
  it("/daily5 and renamed set slugs 301 to the canonical URL, keeping the query", async () => {
    expect(await resolveSeoPage("/daily5?ref=abc", deps)).toMatchObject({ status: 301, location: "/daily?ref=abc" });
    const old = await resolveSeoPage("/sets/1989-topps-352b33d1", deps);
    expect(old).toMatchObject({ status: 301, location: "/sets/1989-topps-baseball-352b33d1" });
    expect(await resolveSeoPage("/sets/1987-topps-37fd025d", deps)).toMatchObject({ status: 301, location: "/sets/1987-topps-baseball-37fd025d" });
    expect((await resolveSeoPage("/sets/1989-topps-baseball-352b33d1", deps)).status).toBe(200);
    expect((await resolveSeoPage("/sets/352b33d1-c110-4e09-b641-8e3c02a94442", deps)).status).toBe(200);
  });

  it("kit set paths match the live slugs", () => {
    const kit = JSON.parse(fs.readFileSync(path.join(root, "docs/seo/content/set-pages.json"), "utf8")).sets;
    for (const k of kit) {
      const s = SETS.find((x) => x.id === k.setId);
      if (s) expect(k.path).toBe(`/sets/${s.slug}`);
    }
  });

  it("/daily free-play count is the live playable set count, never a hardcoded all-12 claim", async () => {
    const page = await resolveSeoPage("/daily", deps);
    const html = renderSeoHtml(indexHtml, page);
    expect(html).not.toContain("{{playableSetCount}}");
    expect(html).not.toMatch(/every one of the 12 integrated sets/i);
    expect(html).toContain(`Right now ${SETS.length} of the 12 integrated sets are open for free play.`);
    const none = await resolveSeoPage("/daily", { ...deps, listSets: async () => [] });
    expect(none.main).toContain("Pick any open set for free play.");
    expect(none.main).not.toContain("{{playableSetCount}}");
  });

  it("2024-25 Topps Chrome has no unverified size section", () => {
    const k = KIT_SETS.find((x) => String(x.setId).startsWith("229f0379"));
    expect(k?.reference).toBeUndefined();
  });
});
