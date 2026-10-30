/** robots.txt and sitemap.xml (SEO_PLAN.md P0). */
import type { Express, Request, Response } from "express";
import { defaultSeoDeps } from "../lib/spaIndexHtml";
import { ORIGIN, type SeoSet } from "../lib/seoPages";

export const ROBOTS_TXT = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /api/qa/",
  "Disallow: /api/play/",
  "Disallow: /admin",
  "",
  `Sitemap: ${ORIGIN}/sitemap.xml`,
  "",
].join("\n");

export const CORE_SITEMAP_PATHS = ["/", "/daily", "/sets", "/how-to-play", "/points", "/about"];

export function buildSitemapXml(setSlugs: string[], lastmod = new Date().toISOString().slice(0, 10)): string {
  const urls = [...CORE_SITEMAP_PATHS, ...setSlugs.map((s) => `/sets/${s}`)];
  const body = urls.map((u) => `  <url><loc>${ORIGIN}${u === "/" ? "/" : u}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** /llms.txt (llmstxt.org format): plain facts about PackPTS for AI answer engines. */
export function buildLlmsTxt(sets: Pick<SeoSet, "slug" | "setName">[]): string {
  const setLines = sets.map((s) => `- [${(s.setName || s.slug).replace(/[\[\]]/g, "")}](${ORIGIN}/sets/${s.slug})`);
  return [
    "# PackPTS",
    "",
    "> PackPTS is a free sports card guessing game. Each card is shown with the player's name blacked out, and you guess who it is. Correct guesses earn points, and points can be redeemed as cashback rebates on real card purchases.",
    "",
    "PackPTS is played in the browser at packpts.com. Daily 5 is a free daily puzzle of five masked cards that is the same for every player. Sets lets you play through classic card sets such as junk wax era baseball.",
    "",
    "## Play",
    "",
    `- [Home](${ORIGIN}/): start playing`,
    `- [Daily 5](${ORIGIN}/daily): today's five card puzzle`,
    `- [How to play](${ORIGIN}/how-to-play): rules and scoring`,
    `- [Points and rebates](${ORIGIN}/points): how points become cashback`,
    `- [Sets](${ORIGIN}/sets): every playable card set`,
    `- [About](${ORIGIN}/about)`,
    "",
    ...(setLines.length ? ["## Card sets", "", ...setLines, ""] : []),
    "## Optional",
    "",
    `- [Terms of Service](${ORIGIN}/terms-of-service)`,
    `- [Privacy Policy](${ORIGIN}/privacy-policy)`,
    `- [Sitemap](${ORIGIN}/sitemap.xml)`,
    "",
  ].join("\n");
}

export function registerSeoRoutes(app: Express): void {
  app.get("/robots.txt", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("text/plain; charset=utf-8").send(ROBOTS_TXT);
  });
  app.get("/llms.txt", async (_req: Request, res: Response) => {
    let sets: SeoSet[] = [];
    try { sets = await defaultSeoDeps.listSets(); } catch { /* core pages only */ }
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("text/plain; charset=utf-8").send(buildLlmsTxt(sets));
  });
  app.get("/sitemap.xml", async (_req: Request, res: Response) => {
    let slugs: string[] = [];
    try { slugs = (await defaultSeoDeps.listSets()).map((s) => s.slug); } catch { /* core pages only */ }
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("application/xml; charset=utf-8").send(buildSitemapXml(slugs));
  });
}
