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

/** Drop a meta tag that describes the homepage image and not the set image. */
function removeMeta(html: string, attr: "property" | "name", key: string): string {
  const re = new RegExp(`[ \\t]*<meta\\s+${attr}="${key}"\\s+content="[^"]*"\\s*/?>[ \\t]*\\r?\\n?`, "gi");
  return html.replace(re, "");
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
  next = removeMeta(next, "property", "og:image:alt");
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

// ---------------------------------------------------------------------------
// SEO content kit pages (docs/seo/content, Design + Marketing, PR #272).
// Server HTML for core and set landing pages: h1, answer as the first <p>,
// body, facts, faq, links, crumbs, masked covers, and the page's JSON-LD.
// Copy comes only from the kit (CI name-leak checked) plus live card counts.
// ---------------------------------------------------------------------------

export interface SeoKitPage {
  path: string;
  title: string;
  description: string;
  h1: string;
  answer: string;
  body: string;
  faq: [string, string][];
  links: [string, string][];
  crumbs: [string, string][];
  jsonld: Record<string, unknown>;
  setId?: string;
  facts?: { year?: number; brand?: string; sport?: string; playableCards?: number; era?: string; designNotes?: string };
  coverImages?: { src: string; alt: string }[];
  /** Verified hobby reference facts (PSA/Beckett). setSize only when a source states it. */
  reference?: { setSize?: number; sources: [string, string][] };
}

const escHtml = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The <main> block for one kit page. cardCount overrides the snapshot count. */
export function renderSeoKitMain(page: SeoKitPage, opts: { cardCount?: number } = {}): string {
  const out: string[] = [];
  if (page.crumbs?.length > 1) {
    out.push(`<nav aria-label="Breadcrumb"><ol style="display:flex;gap:8px;list-style:none;padding:0;flex-wrap:wrap">${page.crumbs
      .map(([t, href], i) => `<li>${i < page.crumbs.length - 1 ? `<a href="${escHtml(href)}">${escHtml(t)}</a> /` : escHtml(t)}</li>`).join("")}</ol></nav>`);
  }
  out.push(`<h1>${escHtml(page.h1)}</h1>`);
  out.push(`<p>${escHtml(page.answer)}</p>`);
  if (page.facts) {
    const f = page.facts;
    const count = typeof opts.cardCount === "number" ? opts.cardCount : f.playableCards;
    const rows: [string, string | number | undefined][] = [
      ["Year", f.year], ["Brand", f.brand], ["Sport", f.sport], ["Cards in play", count], ["Era", f.era], ["Design", f.designNotes],
    ];
    out.push(`<h2>Set facts</h2><dl>${rows.filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(String(v))}</dd>`).join("")}</dl>`);
  }
  for (const para of String(page.body || "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)) out.push(`<p>${escHtml(para)}</p>`);
  if (page.coverImages?.length) {
    out.push(`<div>${page.coverImages.slice(0, 4).map((c) => `<img src="${escHtml(c.src)}" alt="${escHtml(c.alt)}" width="120" height="168" loading="lazy" decoding="async" />`).join("")}</div>`);
  }
  if (page.faq?.length) {
    out.push(`<h2>Questions</h2>${page.faq.map(([q, a]) => `<h3>${escHtml(q)}</h3><p>${escHtml(a)}</p>`).join("")}`);
  }
  const ref = page.reference;
  if (ref?.sources?.length) {
    const name = page.crumbs?.[page.crumbs.length - 1]?.[0] ?? "this set";
    const paras: string[] = [];
    if (typeof ref.setSize === "number") paras.push(`The complete ${name} set has ${ref.setSize} cards.`);
    paras.push("We do not name the top cards while a set is in play, because the names are the answers.");
    paras.push(ref.sources.some(([, h]) => h.includes("/priceguide/"))
      ? "Card values depend heavily on condition and grade. PSA lists graded values by card number."
      : "Card values depend heavily on condition and grade.");
    out.push(`<h2>About the full set</h2>${paras.map((t) => `<p>${escHtml(t)}</p>`).join("")}<p>Sources:</p><ul>${ref.sources
      .map(([t, href]) => `<li><a href="${escHtml(href)}" rel="nofollow noopener">${escHtml(t)}</a></li>`).join("")}</ul>`);
  }
  if (page.links?.length) out.push(`<nav aria-label="PackPTS"><ul>${page.links.map(([t, href]) => `<li><a href="${escHtml(href)}">${escHtml(t)}</a></li>`).join("")}</ul></nav>`);
  return out.join("");
}

/** Replace every JSON-LD block in the shell with this page's @graph. */
export function replaceJsonLd(html: string, jsonld: Record<string, unknown>): string {
  const safe = JSON.stringify(jsonld).replace(/</g, "\\u003c");
  const tag = `<script type="application/ld+json">${safe}</script>`;
  const stripped = html.replace(/[ \t]*<script type="application\/ld\+json">[\s\S]*?<\/script>[ \t]*\r?\n?/gi, "");
  return stripped.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

/** Swap the kit's snapshot card count for the live one everywhere it appears (copy, facts, JSON-LD). */
export function applyLiveCardCount(page: SeoKitPage, live: number | undefined): SeoKitPage {
  const snap = page.facts?.playableCards;
  if (typeof snap !== "number" || typeof live !== "number" || live <= 0 || snap === live) return page;
  const json = JSON.stringify(page)
    .replace(new RegExp(`pool of ${snap} `, "g"), `pool of ${live} `)
    .replace(new RegExp(`has ${snap} playable cards`, "g"), `has ${live} playable cards`);
  const next = JSON.parse(json) as SeoKitPage;
  next.facts = { ...next.facts, playableCards: live };
  return next;
}
