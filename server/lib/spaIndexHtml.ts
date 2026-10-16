/**
 * Head rewrites applied wherever the SPA index.html is sent.
 */
import { injectPlaySetsOgHtml, isPlaySetsHtmlPath } from "./playSetsOg";
import { injectSpaRouteMeta } from "./routeOg";
import { renderSeoHtml, resolveSeoPage, type SeoDeps, type SeoSet } from "./seoPages";

let setsCache: { at: number; sets: SeoSet[] } | null = null;
const SETS_TTL_MS = 5 * 60 * 1000;

async function listSeoSets(): Promise<SeoSet[]> {
  if (setsCache && Date.now() - setsCache.at < SETS_TTL_MS) return setsCache.sets;
  const [{ listIntegratedPublicSets }, { setShareSlug }, { applySetDisplayTitle }] = await Promise.all([
    import("../services/publicSets"), import("../contentFactory/makerShareSlug"), import("@shared/setDisplayOverride"),
  ]);
  const rows = await listIntegratedPublicSets({ limit: 200, offset: 0 });
  const sets = rows.map((r: any) => {
    const setName = applySetDisplayTitle(r.id, r.setName);
    return { id: r.id, setName, year: r.year ?? null, brand: r.brand ?? null, sport: r.sport ?? null, cardCount: Number(r.cardCount) || 0, slug: setShareSlug(setName, r.id), coverUrls: r.coverCardUrls ?? [], coverVersions: r.coverVersions };
  });
  setsCache = { at: Date.now(), sets };
  return sets;
}

export const defaultSeoDeps: SeoDeps = {
  listSets: listSeoSets,
  async resolveSet(idOrSlug) {
    const { resolvePlaySetsSet } = await import("./resolvePlaySetsSet");
    const found = await resolvePlaySetsSet(idOrSlug);
    if (!found) return null;
    const listed = (await listSeoSets()).find((s) => s.id === found.id);
    return listed ?? "custom";
  },
};

let depsOverride: SeoDeps | null = null;
export function setSeoDepsForTests(d: SeoDeps | null): void { depsOverride = d; }

export async function decorateSpaIndexPage(html: string, url: string): Promise<{ html: string; status: number; location?: string }> {
  const withSets = isPlaySetsHtmlPath(url) ? await injectPlaySetsOgHtml(html, url) : html;
  const withRoute = injectSpaRouteMeta(withSets, url);
  try {
    const page = await resolveSeoPage(url, depsOverride ?? defaultSeoDeps);
    return { html: renderSeoHtml(withRoute, page), status: page.status, ...(page.location ? { location: page.location } : {}) };
  } catch (err) {
    console.error("[SEO] page render skipped:", (err as Error)?.message);
    return { html: withRoute, status: 200 };
  }
}

export async function decorateSpaIndexHtml(html: string, url: string): Promise<string> {
  return (await decorateSpaIndexPage(html, url)).html;
}
