/**
 * Head rewrites applied wherever the SPA index.html is sent.
 */
import { injectPlaySetsOgHtml, isPlaySetsHtmlPath } from "./playSetsOg";
import { injectSpaRouteMeta } from "./routeOg";

export async function decorateSpaIndexHtml(html: string, url: string): Promise<string> {
  const withSets = isPlaySetsHtmlPath(url) ? await injectPlaySetsOgHtml(html, url) : html;
  return injectSpaRouteMeta(withSets, url);
}
