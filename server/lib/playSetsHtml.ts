/**
 * Inject play-sets OG/Twitter tags into the SPA index.html.
 * Pure string replace — no DB. Callers pass already-resolved meta.
 */
import {
  PACKPTS_ORIGIN,
  absolutePackptsUrl,
  containsForbiddenPlaySetsShareCopy,
} from "@shared/playSetsShare";

export interface PlaySetsOgMeta {
  title: string;
  description: string;
  image: string;
  url: string;
  canonical: string;
}

function replaceMeta(html: string, attr: "property" | "name", key: string, content: string): string {
  const safe = content
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  const re = new RegExp(
    `<meta\\s+${attr}="${key}"\\s+content="[^"]*"\\s*/?>`,
    "i",
  );
  if (re.test(html)) {
    return html.replace(re, `<meta ${attr}="${key}" content="${safe}" />`);
  }
  return html.replace(
    "</head>",
    `    <meta ${attr}="${key}" content="${safe}" />\n  </head>`,
  );
}

function replaceTag(html: string, tag: "title", content: string): string {
  const safe = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
  if (/<title>[^<]*<\/title>/i.test(html)) {
    return html.replace(/<title>[^<]*<\/title>/i, `<title>${safe}</title>`);
  }
  return html.replace("</head>", `    <title>${safe}</title>\n  </head>`);
}

function replaceCanonical(html: string, href: string): string {
  const safe = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  if (/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i.test(html)) {
    return html.replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
      `<link rel="canonical" href="${safe}" />`,
    );
  }
  return html.replace("</head>", `    <link rel="canonical" href="${safe}" />\n  </head>`);
}

export function injectPlaySetsOgTags(html: string, meta: PlaySetsOgMeta): string {
  const blob = `${meta.title}\n${meta.description}\n${meta.image}\n${meta.url}`;
  if (containsForbiddenPlaySetsShareCopy(blob)) {
    throw new Error("Play-sets OG meta rejected forbidden copy");
  }

  const image = absolutePackptsUrl(meta.image);
  const url = absolutePackptsUrl(meta.url);
  const canonical = absolutePackptsUrl(meta.canonical);

  let next = html;
  next = replaceTag(next, "title", meta.title);
  next = replaceCanonical(next, canonical);
  next = replaceMeta(next, "property", "og:title", meta.title);
  next = replaceMeta(next, "property", "og:description", meta.description);
  next = replaceMeta(next, "property", "og:image", image);
  next = replaceMeta(next, "property", "og:url", url);
  next = replaceMeta(next, "name", "twitter:title", meta.title);
  next = replaceMeta(next, "name", "twitter:description", meta.description);
  next = replaceMeta(next, "name", "twitter:image", image);
  next = replaceMeta(next, "name", "description", meta.description);
  return next;
}

export function defaultPlaySetsOgImageFallback(): string {
  return `${PACKPTS_ORIGIN}/assets/play-sets/integrated-shelf.png`;
}
