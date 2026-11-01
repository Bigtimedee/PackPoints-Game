/**
 * Server-rendered SEO layer for the SPA shell (SEO_PLAN.md P0, Oct 15 2026).
 *
 * For every HTML response: own <title>, meta description, self-referencing
 * canonical, robots, and HTTP status (404 for unknown routes and unknown set
 * ids). Core pages also get an H1, real copy and plain <a href> links inside
 * #root, which React replaces on mount.
 *
 * HARD RULE: no player names. Copy here is static or built from set metadata
 * (name, year, brand, sport, card count) only. server/tests/seoPages.test.ts
 * renders every page and fails on any live-pool or blocked-pool surname.
 */
import { isKnownSpaRoute } from "@shared/spaRoutes";
import { isMaskedSetCoverUrl, setCoverSrcSet, setCoverVariantUrl, SET_COVER_SIZES } from "@shared/setCoverUrl";

/**
 * The first /sets row's masked covers as server HTML, so the LCP image paints
 * before the app boots. Same URLs, srcset and CORS mode as the app's <img>, so
 * the browser reuses the bytes. Integrated set names only (never user text).
 */
export function firstRowCoverStrip(sets: SeoSet[]): string {
  const first = sets[0];
  const urls = first?.coverUrls ?? [];
  if (!urls.length || !urls.every(isMaskedSetCoverUrl)) return "";
  const versions = first.coverVersions && first.coverVersions.length === urls.length ? first.coverVersions : undefined;
  const alt = `Masked ${esc(first.setName)} card`;
  const imgs = urls.map((u, i) => {
    const v = versions?.[i];
    return `<img src="${setCoverVariantUrl(u, 240, v)}" srcset="${setCoverSrcSet(u, v)}" sizes="${SET_COVER_SIZES}" width="250" height="350" alt="${alt}" crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async"${i === 0 ? ' fetchpriority="high"' : ""} style="flex:0 0 32%;width:32%;max-width:160px;height:auto;margin-right:-12%;border-radius:3px" />`;
  }).join("");
  return `<div aria-hidden="true" style="display:flex;overflow:hidden;padding:8px 0">${imgs}</div>`;
}

/** Preload the first /sets row's masked covers with the same srcset/sizes the <img> uses. */
export function firstRowCoverPreloads(sets: SeoSet[]): string[] {
  const first = sets[0];
  const urls = first?.coverUrls ?? [];
  if (!urls.length || !urls.every(isMaskedSetCoverUrl)) return [];
  const versions = first.coverVersions && first.coverVersions.length === urls.length ? first.coverVersions : undefined;
  return urls.map((u, i) => {
    const v = versions?.[i];
    return `<link rel="preload" as="image" href="${setCoverVariantUrl(u, 240, v)}" imagesrcset="${setCoverSrcSet(u, v)}" imagesizes="${SET_COVER_SIZES}" fetchpriority="high" crossorigin="anonymous" />`;
  });
}
import { SPA_ROUTE_META } from "./routeOg";
import { renderSeoKitMain, replaceJsonLd, applyLiveCardCount, type SeoKitPage } from "./playSetsHtml";
import coreKit from "../../docs/seo/content/core-pages.json";
import setKit from "../../docs/seo/content/set-pages.json";

/** Design's content kit (PR #272). Copy is name-leak checked in CI. */
export const KIT_CORE: SeoKitPage[] = (coreKit as unknown as { core: SeoKitPage[] }).core;
export const KIT_SETS: SeoKitPage[] = (setKit as unknown as { sets: SeoKitPage[] }).sets;
const KIT_CORE_BY_PATH = new Map(KIT_CORE.map((k) => [k.path, k]));
const KIT_SET_BY_ID = new Map(KIT_SETS.filter((k) => k.setId).map((k) => [String(k.setId), k]));

export const PLAYABLE_SET_TOKEN = "{{playableSetCount}}";
/** Fill the live count of publicly playable sets (held sets are already excluded by listSets). */
export function applyPlayableSetCount(k: SeoKitPage, liveSets: number): SeoKitPage {
  const raw = JSON.stringify(k);
  if (!raw.includes(PLAYABLE_SET_TOKEN)) return k;
  const filled = liveSets > 0
    ? raw.split(PLAYABLE_SET_TOKEN).join(String(liveSets))
    : raw.replace(/Right now \{\{playableSetCount\}\} of the 12 integrated sets are open for free play\./g, "Pick any open set for free play.");
  return JSON.parse(filled) as SeoKitPage;
}

function kitPage(k: SeoKitPage, cardCount?: number, livePath?: string, liveSets = 0): SeoPage {
  const counted = applyPlayableSetCount(k, liveSets);
  const page = typeof cardCount === "number" ? applyLiveCardCount(counted, cardCount) : counted;
  // Set pages canonicalize to the live slug (the one in sitemap.xml), even if the set was renamed after the kit snapshot.
  const canonPath = livePath ?? page.path;
  return {
    status: 200, title: page.title, description: page.description, canonical: `${ORIGIN}${canonPath === "/" ? "/" : canonPath}`,
    noindex: false, h1: page.h1, main: renderSeoKitMain(page), jsonld: page.jsonld,
  };
}

export const ORIGIN = "https://packpts.com";
export const HOME_TITLE = "PackPTS: Name the Player Sports Card Game | Earn Points";
export const HOME_DESCRIPTION =
  "Name the player on real sports cards with the name masked. Play the free Daily 5, explore classic sets, and earn points for eBay rebates.";

export interface SeoSet { id: string; setName: string; year: number | null; brand: string | null; sport: string | null; cardCount: number; slug: string; coverUrls?: string[]; coverVersions?: string[] }
export interface SeoDeps {
  listSets: () => Promise<SeoSet[]>;
  /** null when the id or slug is not a live public set. "custom" for a live user-made set (never rendered: its name is user text). */
  resolveSet: (idOrSlug: string) => Promise<SeoSet | "custom" | null>;
}
export interface SeoPage {
  status: 200 | 301 | 404;
  /** Redirect target (path plus query) when status is 301. */
  location?: string;
  title: string;
  description: string;
  canonical: string | null;
  noindex: boolean;
  h1?: string;
  body?: string;
  /** Full <main> inner HTML from the kit (h1 included). Wins over h1/body. */
  main?: string;
  /** Hide the boot spinner so the server content (and its LCP image) paints above the fold. */
  hideLoader?: boolean;
  /** <link rel="preload"> tags for the LCP images. */
  preload?: string[];
  /** JSON-LD @graph replacing the shell's JSON-LD. */
  jsonld?: Record<string, unknown>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const a = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
const p = (t: string) => `<p>${t}</p>`;

function nav(sets: SeoSet[]): string {
  const core = [a("/", "Home"), a("/daily", "Daily 5"), a("/sets", "All sets"), a("/how-to-play", "How to play"), a("/points", "How points work")];
  const setLinks = sets.map((s) => `<li>${a(`/sets/${s.slug}`, s.setName)}</li>`).join("");
  return `<nav aria-label="PackPTS"><p>${core.join(" · ")}</p>${sets.length ? `<h2>Sets you can play</h2><ul>${setLinks}</ul>` : ""}</nav>`;
}

const SPORT_WORD: Record<string, string> = { baseball: "baseball", basketball: "basketball", football: "football", hockey: "hockey" };

/** Static pages with their own head. Indexable unless listed in NOINDEX. */
const STATIC_META: Record<string, { title: string; description: string }> = {
  "/leaderboard": { title: "Leaderboard | PackPTS", description: "See who leads PackPTS today and this week in the sports card name the player game." },
  "/creators": { title: "For Creators | PackPTS", description: "Make and share your own PackPTS card sets with your audience." },
  "/partners": { title: "Partners | PackPTS", description: "Partner with PackPTS, the free sports card game where players name the player on real cards." },
  "/roadmap": { title: "Roadmap | PackPTS", description: "What we are building next for PackPTS, the sports card name the player game." },
  "/privacy-policy": { title: "Privacy Policy | PackPTS", description: "How PackPTS collects, uses and protects your information." },
  "/terms-of-service": { title: "Terms of Service | PackPTS", description: "The terms that apply when you play PackPTS." },
  "/dmca": { title: "Copyright and Takedowns | PackPTS", description: "How to send PackPTS a copyright or takedown request." },
  "/store": { title: "Store | PackPTS", description: "Add points and passes to your PackPTS account." },
  "/marketplace": { title: "Marketplace | PackPTS", description: "Browse sports cards on eBay from PackPTS." },
};
const NOINDEX_PREFIXES = ["/admin", "/auth", "/profile", "/game/", "/match/", "/lobby", "/queue", "/redeem", "/redemptions",
  "/store/", "/reset-password", "/forgot-password", "/review/", "/collab/", "/invite", "/friends", "/make", "/waitlist"];

function pathOf(url: string): string {
  const raw = (url || "/").split("?")[0].split("#")[0] || "/";
  return raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
}

function homePage(sets: SeoSet[]): SeoPage {
  return {
    status: 200, title: HOME_TITLE, description: HOME_DESCRIPTION, canonical: `${ORIGIN}/`, noindex: false,
    h1: "Name the player on classic sports cards",
    body: [
      p("PackPTS is a free sports card game. We deal a real trading card with the name masked, and you pick the player from four choices. No download, no card collection needed, and it plays in any phone or desktop browser."),
      p(`Start with the ${a("/daily", "Daily 5")}: the same five cards for everyone, new every day at midnight Central Time. Share your score and see if your friends can beat it. Want more? ${a("/sets", "Pick a set")} and play a full game from a single year and brand, like the junk wax era Topps and Donruss sets many collectors grew up opening.`),
      p(`Every correct answer earns points. Points go into your wallet and can be used for rebates on eligible card purchases on eBay. ${a("/points", "See how points work")}. New here? ${a("/how-to-play", "Read how to play")}; it takes under a minute.`),
      p("Card names are always masked during play, so the game tests what you remember: the uniform, the pose, the photo, the era. Sign up free to keep your points, track streaks and invite friends."),
      nav(sets),
    ].join(""),
  };
}

function dailyPage(sets: SeoSet[]): SeoPage {
  return {
    // Design's approved Daily 5 head (routeOg.ts), so title, og and twitter agree.
    status: 200, title: SPA_ROUTE_META["/daily"].title,
    description: SPA_ROUTE_META["/daily"].description,
    canonical: `${ORIGIN}/daily`, noindex: false,
    h1: "Daily 5: five cards, name the player",
    body: [
      p("Daily 5 is a free daily sports card game. Every day at midnight Central Time we deal five real trading cards with the names masked. Everyone gets the same five. For each card, pick the player from four choices."),
      p("You get one run per day, so make it count. When you finish you see your score out of five and can share it with a link that challenges a friend to beat you on the same cards. Come back each day to build a streak."),
      p(`Daily 5 draws from the classic sets in PackPTS, mostly late 1980s baseball. Correct answers earn points into your wallet. ${a("/points", "How points work")}. Prefer a longer game? ${a("/sets", "Play a full set")}.`),
      p(`Like a daily puzzle game, but with real cards. ${a("/how-to-play", "How to play")}.`),
      nav(sets),
    ].join(""),
  };
}

function howToPlayPage(sets: SeoSet[]): SeoPage {
  return {
    status: 200, title: "How to Play PackPTS: Guess the Player on Sports Cards",
    description: "How PackPTS works: a real card with the name masked, four choices, points for correct answers. Daily 5 and full set games. Free.",
    canonical: `${ORIGIN}/how-to-play`, noindex: false,
    h1: "How to play PackPTS",
    body: [
      p("PackPTS shows you a real sports card with the player name covered by a gold bar. Below the card are four names. Pick the one you think is on the card and submit. You see right away if you were correct, then move to the next card."),
      `<h2>Two ways to play</h2>`,
      p(`${a("/daily", "Daily 5")} is five cards, the same for everyone, once per day. ${a("/sets", "Set games")} let you pick a set, like a 1987 or 1988 baseball release, and play a longer game from that set alone.`),
      `<h2>Scoring</h2>`,
      p(`Each correct answer earns points. Points are never shown on the card while you play; you see your total when the game ends. Points land in your wallet. ${a("/points", "Learn what points are for")}.`),
      `<h2>Like Wordle, but with real cards</h2>`,
      p("If you like daily puzzle games, Daily 5 works the same way: one short run a day and a score to share. The difference is that every puzzle is a real card from sets collectors know."),
      `<h2>Do I need an account?</h2>`,
      p("No. You can play as a guest. A free account keeps your points, streaks and history across devices."),
      nav(sets),
    ].join(""),
  };
}

function pointsPage(sets: SeoSet[]): SeoPage {
  return {
    status: 200, title: "PackPTS Points: Earn Points Playing, Use Them for eBay Rebates",
    description: "How PackPTS points work: earn points by naming the player, then use them for rebates on eligible eBay card purchases. Rebates are held 60 days.",
    canonical: `${ORIGIN}/points`, noindex: false,
    h1: "How PackPTS points work",
    body: [
      p("You earn PackPTS points by playing. Each correct answer in the Daily 5 or a set game adds points to your wallet. Points are shown when a game ends, not while you play."),
      `<h2>What points are for</h2>`,
      p("When you buy an eligible card on eBay through PackPTS, you can use points toward a rebate on that purchase. You earn real cashback on that purchase. Rebates are held for 60 days before they can be paid out, and payouts are reviewed before they are sent."),
      `<h2>Do points expire?</h2>`,
      p(`Points can expire under the current points policy. Your wallet shows any points that are close to expiring. Full details are on this page after it loads and in the ${a("/terms-of-service", "terms")}.`),
      `<h2>Invite friends</h2>`,
      p("Share your invite link. When a friend signs up and finishes a first game, you both get points."),
      p(`${a("/how-to-play", "How to play")} · ${a("/daily", "Play the Daily 5")}`),
      nav(sets),
    ].join(""),
  };
}

function setsIndexPage(sets: SeoSet[]): SeoPage {
  const sports = [...new Set(sets.map((s) => SPORT_WORD[String(s.sport || "").toLowerCase()]).filter(Boolean))];
  return {
    status: 200, title: "Sports Card Sets to Play: Name the Player Games | PackPTS",
    description: "Pick a classic sports card set and name the player on every card. Late 1980s baseball and more. Free to play on PackPTS.",
    canonical: `${ORIGIN}/sets`, noindex: false,
    h1: "Sports card sets you can play",
    body: [
      p(`Every set on PackPTS is a name the player game built from real cards in one release. Pick a set and we deal its cards with the names masked; you choose the player from four names. There are ${sets.length} sets live now${sports.length ? `, covering ${sports.join(", ")}` : ""}.`),
      p("Most sets come from the junk wax era of the late 1980s, when Topps, Donruss and Fleer printed cards in huge numbers and a whole generation of collectors opened packs. If you collected then, you will recognize the designs."),
      p(`Short on time? The ${a("/daily", "Daily 5")} is five cards a day, the same for everyone. ${a("/how-to-play", "How to play")} · ${a("/points", "How points work")}`),
      nav(sets),
    ].join(""),
  };
}

function setPage(set: SeoSet, sets: SeoSet[]): SeoPage {
  const sport = SPORT_WORD[String(set.sport || "").toLowerCase()] || "sports";
  const era = set.year && set.year >= 1986 && set.year <= 1993 ? " It is part of the junk wax era, when cards were printed in huge numbers." : "";
  const siblings = sets.filter((s) => s.id !== set.id && (s.year === set.year || s.brand === set.brand)).slice(0, 6);
  return {
    status: 200, title: `${set.setName} Card Game: Guess the Player | PackPTS`,
    description: `Play ${set.setName} on PackPTS: a real card with the name masked, pick the player from four choices. Free, no download.`,
    canonical: `${ORIGIN}/sets/${set.slug}`, noindex: false,
    h1: `${set.setName}: Name the Player Game`,
    body: [
      p(`Play ${esc(set.setName)} on PackPTS: we deal a real ${esc(set.setName)} card with the name masked and you pick the player from four choices. Free, no download.`),
      `<h2>About this set</h2>`,
      p(`${esc(set.setName)} is a ${set.year ? `${set.year} ` : ""}${set.brand ? `${esc(set.brand)} ` : ""}${sport} card release.${era} PackPTS has ${set.cardCount} cards from this set in play. Names stay masked during the game, so you have to recognize the photo, the team and the design.`),
      p("For a full numbered checklist, see a dedicated checklist site. We do not publish card lists for sets in play, so the game stays fair."),
      `<h2>How the game works</h2>`,
      p(`Each card shows four names. Pick one and submit; correct answers earn points. ${a("/how-to-play", "Full rules")} · ${a("/points", "How points work")} · ${a("/daily", "Play the Daily 5")}`),
      siblings.length ? `<h2>Related sets</h2><ul>${siblings.map((s) => `<li>${a(`/sets/${s.slug}`, s.setName)}</li>`).join("")}</ul>` : "",
      nav(sets),
    ].join(""),
  };
}

export const NOT_FOUND_PAGE: SeoPage = {
  status: 404, title: "Page not found | PackPTS", description: "This page does not exist on PackPTS.", canonical: null, noindex: true,
};

export async function resolveSeoPage(url: string, deps: SeoDeps): Promise<SeoPage> {
  const path = pathOf(url);
  if (!isKnownSpaRoute(path)) return NOT_FOUND_PAGE;
  const sets = await deps.listSets().catch(() => [] as SeoSet[]);
  const query = (url || "").includes("?") ? `?${(url.split("?")[1] || "").split("#")[0]}` : "";
  const redirect = (to: string): SeoPage => ({ ...NOT_FOUND_PAGE, status: 301, noindex: true, location: `${to}${query === "?" ? "" : query}` });
  if (path === "/daily5") return redirect("/daily");
  const corePath = path;
  const core = KIT_CORE_BY_PATH.get(corePath);
  if (core) {
    const page = kitPage(core, undefined, undefined, sets.length);
    if (corePath === "/sets") {
      // The index data the page fetches on mount, then the first row's covers.
      // The list itself is inlined as JSON (spaIndexHtml), so only the covers are preloaded.
      page.preload = firstRowCoverPreloads(sets);
      const strip = firstRowCoverStrip(sets);
      if (strip && page.main) {
        page.main = page.main.replace(/(<\/h1>)/, `$1${strip}`);
        page.hideLoader = true;
      }
    }
    return page;
  }
  if (path === "/") return homePage(sets);
  if (path === "/daily" || path === "/daily5") return dailyPage(sets);
  if (path === "/how-to-play") return howToPlayPage(sets);
  if (path === "/points") return pointsPage(sets);
  if (path === "/sets") return setsIndexPage(sets);
  const m = /^\/sets\/([^/]+)$/.exec(path);
  if (m) {
    let set: SeoSet | "custom" | null;
    try {
      set = await deps.resolveSet(decodeURIComponent(m[1]));
    } catch {
      // DB not ready (boot) or a lookup error: never a 404 for a set that may exist.
      return { status: 200, title: "Card set | PackPTS", description: HOME_DESCRIPTION, canonical: `${ORIGIN}${path}`, noindex: false };
    }
    if (set === "custom") {
      return { status: 200, title: "Custom card set | PackPTS", description: "A custom name the player card set on PackPTS.", canonical: `${ORIGIN}${path}`, noindex: true };
    }
    if (!set) return NOT_FOUND_PAGE;
    // A renamed set's old slug (shared on X) 301s to the live slug. Bare ids stay 200 (in-app links).
    const ref = decodeURIComponent(m[1]).toLowerCase();
    const isId = /^[0-9a-f]{8}(-?[0-9a-f]{4}){3}-?[0-9a-f]{12}$/.test(ref);
    if (!isId && ref !== set.slug) return redirect(`/sets/${set.slug}`);
    const kit = KIT_SET_BY_ID.get(String(set.id));
    return kit ? kitPage(kit, set.cardCount, `/sets/${set.slug}`) : setPage(set, sets);
  }
  const meta = STATIC_META[path];
  const noindex = NOINDEX_PREFIXES.some((pre) => path === pre || path.startsWith(pre.endsWith("/") ? pre : `${pre}/`) || path === pre.replace(/\/$/, ""));
  return {
    status: 200,
    title: meta?.title ?? "PackPTS",
    description: meta?.description ?? HOME_DESCRIPTION,
    canonical: `${ORIGIN}${path}`,
    noindex,
  };
}

function setHeadTag(html: string, re: RegExp, tag: string): string {
  return re.test(html) ? html.replace(re, tag) : html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

/** Apply a resolved page to the SPA shell. */
export function renderSeoHtml(html: string, page: SeoPage): string {
  let next = html;
  next = setHeadTag(next, /<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${esc(page.title)}</title>`);
  next = setHeadTag(next, /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${esc(page.description)}" />`);
  if (page.canonical) {
    next = setHeadTag(next, /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${esc(page.canonical)}" />`);
    next = setHeadTag(next, /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${esc(page.canonical)}" />`);
  } else {
    next = next.replace(/[ \t]*<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>[ \t]*\r?\n?/i, "");
  }
  if (page.noindex) next = setHeadTag(next, /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i, `<meta name="robots" content="noindex" />`);
  if (page.jsonld) next = replaceJsonLd(next, page.jsonld);
  if (page.hideLoader) next = next.replace(/<\/head>/i, `    <style>#initial-loader{display:none!important}</style>\n  </head>`);
  if (page.preload?.length) next = next.replace(/<\/head>/i, `    ${page.preload.join("\n    ")}\n  </head>`);
  if (page.h1 || page.main) {
    const inner = page.main ?? `<h1>${esc(page.h1 ?? "")}</h1>${page.body ?? ""}`;
    const block = `<main id="seo-content" style="max-width:720px;margin:0 auto;padding:24px 16px;font-family:system-ui,sans-serif;color:hsl(220 10% 75%);line-height:1.5">${inner}</main>`;
    // After the spinner, still inside #root, so React replaces it on mount.
    next = next.includes("<!--seo-content-->")
      ? next.replace("<!--seo-content-->", block)
      : next.replace(/(<div id="root">)/i, `$1\n      ${block}`);
  }
  return next;
}
