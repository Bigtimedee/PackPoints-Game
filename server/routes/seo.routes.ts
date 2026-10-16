/** robots.txt and sitemap.xml (SEO_PLAN.md P0). */
import type { Express, Request, Response } from "express";
import { defaultSeoDeps } from "../lib/spaIndexHtml";
import { ORIGIN } from "../lib/seoPages";

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

export function registerSeoRoutes(app: Express): void {
  app.get("/robots.txt", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("text/plain; charset=utf-8").send(ROBOTS_TXT);
  });
  app.get("/sitemap.xml", async (_req: Request, res: Response) => {
    let slugs: string[] = [];
    try { slugs = (await defaultSeoDeps.listSets()).map((s) => s.slug); } catch { /* core pages only */ }
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("application/xml; charset=utf-8").send(buildSitemapXml(slugs));
  });
}
