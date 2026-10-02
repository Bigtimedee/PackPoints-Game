/**
 * Static link-preview tags for SPA routes. Crawlers do not run JS, so
 * production static serving and the Vite dev index path rewrite these
 * into index.html before the response is sent.
 * Add a pathname key here when another route needs its own preview.
 */
import { normalizeAppPath } from "@shared/buildVersion";

export interface SpaRouteMeta {
  title: string;
  description: string;
  url: string;
  type: string;
  siteName: string;
  image: string;
  imageWidth: string;
  imageHeight: string;
  imageAlt: string;
  twitterCard: string;
}

export const SPA_ROUTE_META: Readonly<Record<string, SpaRouteMeta>> = {
  "/daily": {
    title: "Daily 5. Five cards. Name them.",
    description: "A new hand every day. Same five for everyone. Play free at PackPTS.",
    url: "https://packpts.com/daily",
    type: "website",
    siteName: "PackPTS",
    image: "https://packpts.com/og/daily-1200x630.png", // If the image ever changes, append ?v=2 so X and iMessage refetch.
    imageWidth: "1200",
    imageHeight: "630",
    imageAlt: "Five masked sports cards. Daily 5 on PackPTS.",
    twitterCard: "summary_large_image",
  },
};

export function spaRouteMetaForUrl(url: string): SpaRouteMeta | null {
  const path = normalizeAppPath(url);
  return SPA_ROUTE_META[path] ?? null;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function readAttr(tag: string, name: string): string | null {
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) {
    if (match[1].toLowerCase() === name.toLowerCase()) {
      return match[2] ?? match[3] ?? "";
    }
  }
  return null;
}

function insertBeforeHeadClose(html: string, tag: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
  }
  return `${html}\n${tag}\n`;
}

function replaceMeta(
  html: string,
  attr: "property" | "name",
  key: string,
  content: string,
): string {
  const nextTag = `<meta ${attr}="${escapeAttr(key)}" content="${escapeAttr(content)}" />`;
  let replaced = false;
  const next = html.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (readAttr(tag, attr) !== key) return tag;
    if (replaced) return "";
    replaced = true;
    return nextTag;
  });
  if (replaced) return next;
  return insertBeforeHeadClose(next, nextTag);
}

function replaceTitle(html: string, content: string): string {
  const nextTag = `<title>${escapeText(content)}</title>`;
  let replaced = false;
  const next = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, () => {
    if (replaced) return "";
    replaced = true;
    return nextTag;
  });
  if (replaced) return next;
  return insertBeforeHeadClose(next, nextTag);
}

/** Replace existing head tags for a mapped route. Other URLs are returned unchanged. */
export function injectSpaRouteMeta(html: string, url: string): string {
  const meta = spaRouteMetaForUrl(url);
  if (!meta) return html;

  let next = html;
  next = replaceTitle(next, meta.title);
  next = replaceMeta(next, "name", "description", meta.description);
  next = replaceMeta(next, "property", "og:title", meta.title);
  next = replaceMeta(next, "property", "og:description", meta.description);
  next = replaceMeta(next, "property", "og:url", meta.url);
  next = replaceMeta(next, "property", "og:type", meta.type);
  next = replaceMeta(next, "property", "og:site_name", meta.siteName);
  next = replaceMeta(next, "property", "og:image", meta.image);
  next = replaceMeta(next, "property", "og:image:width", meta.imageWidth);
  next = replaceMeta(next, "property", "og:image:height", meta.imageHeight);
  next = replaceMeta(next, "property", "og:image:alt", meta.imageAlt);
  next = replaceMeta(next, "name", "twitter:card", meta.twitterCard);
  next = replaceMeta(next, "name", "twitter:title", meta.title);
  next = replaceMeta(next, "name", "twitter:description", meta.description);
  next = replaceMeta(next, "name", "twitter:image", meta.image);
  return next;
}
