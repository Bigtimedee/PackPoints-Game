import {
  PACKPTS_ORIGIN,
  absolutePackptsUrl,
  parsePlaySetsHtmlPath,
  parsePlaySetsSurface,
  playSetsOgDescription,
  playSetsOgTitle,
  preferPlaySetsShareImage,
} from "@shared/playSetsShare";
import { injectPlaySetsOgTags, type PlaySetsOgMeta } from "./playSetsHtml";
import { resolvePlaySetsSet } from "./resolvePlaySetsSet";

export { injectPlaySetsOgTags };
export type { PlaySetsOgMeta };

export function isPlaySetsHtmlPath(url: string): boolean {
  return parsePlaySetsHtmlPath(url) !== null;
}

export async function resolvePlaySetsOgMeta(url: string): Promise<PlaySetsOgMeta | null> {
  const parsed = parsePlaySetsHtmlPath(url);
  if (!parsed) return null;

  if (parsed.kind === "index") {
    const image = preferPlaySetsShareImage({ surface: "integrated_shelf" });
    return {
      title: playSetsOgTitle({ surface: "integrated_shelf" }),
      description: playSetsOgDescription({ surface: "integrated_shelf" }),
      image: absolutePackptsUrl(image.path),
      url: `${PACKPTS_ORIGIN}/sets`,
      canonical: `${PACKPTS_ORIGIN}/sets`,
    };
  }

  let setName: string | null = null;
  let runtimeCoverUrl: string | undefined;
  let slug = parsed.slug;
  try {
    const set = await resolvePlaySetsSet(parsed.slug);
    if (set) {
      setName = set.setName;
      runtimeCoverUrl = set.shareImageUrl;
      slug = set.slug;
    }
  } catch (err) {
    console.error("[PlaySetsOG] set lookup failed:", (err as Error)?.message);
  }

  const surface = setName ? parsePlaySetsSurface("play_this_set") : "integrated_shelf";
  const image = preferPlaySetsShareImage({
    runtimeCoverUrl,
    surface,
  });
  const path = setName ? `/sets/${slug}` : "/sets";
  return {
    title: playSetsOgTitle({ surface, setName }),
    description: playSetsOgDescription({ surface, setName }),
    image: absolutePackptsUrl(image.path),
    url: `${PACKPTS_ORIGIN}${path}`,
    canonical: `${PACKPTS_ORIGIN}${path}`,
  };
}

export async function injectPlaySetsOgHtml(html: string, url: string): Promise<string> {
  const meta = await resolvePlaySetsOgMeta(url);
  if (!meta) return html;
  try {
    return injectPlaySetsOgTags(html, meta);
  } catch (err) {
    console.error("[PlaySetsOG] inject skipped:", (err as Error)?.message);
    return html;
  }
}
