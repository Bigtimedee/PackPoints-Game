/**
 * Renders every SEO page (sitemap URLs plus /daily5 and 404) to HTML files so
 * scripts/seo-name-leak-check can scan the real server output in CI.
 * Set list: live /api/sets (public) when reachable, else the test fixture.
 * Usage: npx tsx scripts/render-seo-pages.ts <outDir> [--base https://packpts.com]
 */
import fs from "fs";
import path from "path";
import { resolveSeoPage, renderSeoHtml, type SeoSet } from "../server/lib/seoPages";
import { CORE_SITEMAP_PATHS } from "../server/routes/seo.routes";
import { setShareSlug } from "../server/contentFactory/makerShareSlug";
import { applySetDisplayTitle } from "../shared/setDisplayOverride";

async function main() {
  const out = process.argv[2] || "seo-html";
  const bi = process.argv.indexOf("--base");
  const base = bi > 0 ? process.argv[bi + 1] : "https://packpts.com";
  let rows: any[] = [];
  try {
    const r = await fetch(`${base}/api/sets?limit=50`);
    if (r.ok) rows = (await r.json()).sets ?? [];
  } catch { rows = []; }
  if (!rows.length) rows = JSON.parse(fs.readFileSync(path.join(process.cwd(), "server/tests/fixtures/seoSets.json"), "utf8"));
  const sets: SeoSet[] = rows.map((r) => {
    const setName = applySetDisplayTitle(r.id, r.setName);
    return { id: r.id, setName, year: r.year ?? null, brand: r.brand ?? null, sport: r.sport ?? null, cardCount: Number(r.cardCount) || 0, slug: setShareSlug(setName, r.id) };
  });
  const deps = { listSets: async () => sets, resolveSet: async (ref: string) => sets.find((s) => s.slug === ref || s.id === ref || ref.endsWith(s.id.replace(/-/g, "").slice(0, 8))) ?? null };
  const shell = fs.readFileSync(path.join(process.cwd(), "client/index.html"), "utf8");
  fs.mkdirSync(out, { recursive: true });
  const urls = [...CORE_SITEMAP_PATHS, ...sets.map((s) => `/sets/${s.slug}`), "/nope-xyz"];
  for (const u of urls) {
    const page = await resolveSeoPage(u, deps);
    const file = path.join(out, `${u === "/" ? "home" : u.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_")}.html`);
    fs.writeFileSync(file, renderSeoHtml(shell, page));
  }
  console.log(`rendered ${urls.length} pages from ${rows.length} sets into ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
