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
  const sets = rows.map((r: any) => toSeoSet(r, setShareSlug, applySetDisplayTitle));
  setsCache = { at: Date.now(), sets };
  return sets;
}

function toSeoSet(r: any, setShareSlug: (n: string, id: string) => string, applySetDisplayTitle: (id: string, n: string) => string): SeoSet {
    const setName = applySetDisplayTitle(r.id, r.setName);
    return { id: r.id, setName, year: r.year ?? null, brand: r.brand ?? null, sport: r.sport ?? null, cardCount: Number(r.cardCount) || 0, slug: setShareSlug(setName, r.id), coverUrls: r.coverCardUrls ?? [], coverVersions: r.coverVersions };
}

/**
 * /sets first paint: the exact /api/sets?limit=50 payload, inlined as JSON so
 * the app renders the list on its first render (no fetch), and the server
 * first row, preloads and the app's <img>s all use the same cover URLs.
 */
let setsPayloadCache: { at: number; payload: { sets: any[]; coversDisabled?: boolean } } | null = null;
const SETS_PAYLOAD_TTL_MS = 30_000;
let setsPayloadInflight: Promise<{ sets: any[]; coversDisabled?: boolean }> | null = null;
/** Stale-while-revalidate: a cached payload is served at once and refreshed in the background. */
async function setsIndexPayload(): Promise<{ sets: any[]; coversDisabled?: boolean }> {
  if (setsPayloadCache) {
    if (Date.now() - setsPayloadCache.at >= SETS_PAYLOAD_TTL_MS && !setsPayloadInflight) {
      setsPayloadInflight = loadSetsIndexPayload().finally(() => { setsPayloadInflight = null; });
      setsPayloadInflight.catch(() => {});
    }
    return setsPayloadCache.payload;
  }
  if (!setsPayloadInflight) setsPayloadInflight = loadSetsIndexPayload().finally(() => { setsPayloadInflight = null; });
  return setsPayloadInflight;
}

/** Warm the /sets payload after boot so the first visitor is not the one who pays for it. */
export function warmSetsIndexPayload(): void {
  void setsIndexPayload().catch(() => {});
}

async function loadSetsIndexPayload(): Promise<{ sets: any[]; coversDisabled?: boolean }> {
  const [{ listIntegratedPublicSets }, { setsCoversDisabled }] = await Promise.all([
    import("../services/publicSets"), import("./setsCoversDisabled"),
  ]);
  const sets = await listIntegratedPublicSets({ limit: 50, offset: 0 });
  const payload = setsCoversDisabled() ? { sets, coversDisabled: true } : { sets };
  setsPayloadCache = { at: Date.now(), payload };
  return payload;
}

function isSetsIndexUrl(url: string): boolean {
  const p = (url || "/").split("?")[0].split("#")[0].replace(/\/+$/, "");
  return p === "/sets";
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

import { stripHtmlComments } from "./stripHtmlComments";
export { stripHtmlComments };

export async function decorateSpaIndexPage(html: string, url: string): Promise<{ html: string; status: number; location?: string }> {
  const out = await decorateSpaIndexPageRaw(html, url);
  return { ...out, html: stripHtmlComments(out.html) };
}

async function decorateSpaIndexPageRaw(html: string, url: string): Promise<{ html: string; status: number; location?: string }> {
  const withSets = isPlaySetsHtmlPath(url) ? await injectPlaySetsOgHtml(html, url) : html;
  const withRoute = injectSpaRouteMeta(withSets, url);
  try {
    let deps = depsOverride ?? defaultSeoDeps;
    let inline = "";
    if (!depsOverride && isSetsIndexUrl(url)) {
      try {
        // Never hold the page: at boot the list can wait for the mask pass.
        const payload = await Promise.race([
          setsIndexPayload(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("sets payload slow")), 400).unref?.()),
        ]);
        const [{ setShareSlug }, { applySetDisplayTitle }] = await Promise.all([
          import("../contentFactory/makerShareSlug"), import("@shared/setDisplayOverride"),
        ]);
        const sets = payload.sets.map((r) => toSeoSet(r, setShareSlug, applySetDisplayTitle));
        deps = { ...deps, listSets: async () => sets };
        inline = `<script type="application/json" id="pp-sets-data">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`;
      } catch { inline = ""; }
    }
    const page = await resolveSeoPage(url, deps);
    const rendered = renderSeoHtml(withRoute, page);
    return { html: inline ? rendered.replace(/<\/body>/i, `${inline}\n</body>`) : rendered, status: page.status, ...(page.location ? { location: page.location } : {}) };
  } catch (err) {
    console.error("[SEO] page render skipped:", (err as Error)?.message);
    return { html: withRoute, status: 200 };
  }
}

export async function decorateSpaIndexHtml(html: string, url: string): Promise<string> {
  return (await decorateSpaIndexPage(html, url)).html;
}
