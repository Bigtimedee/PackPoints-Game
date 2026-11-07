/**
 * Link-preview catalog for the 12 public set pages and the four static pages.
 * Filenames and alts are set ids and set names only. No player names.
 * A file is used as og:image / twitter:image only after its sha256 is listed
 * in server/assets/share/APPROVED.json (the social approval gate).
 */

export const SHARE_OG_WIDTH = 1200;
export const SHARE_OG_HEIGHT = 630;
export const SHARE_PUBLIC_DIR = "/og/share";
export const PACKPTS_ORIGIN = "https://packpts.com";

export interface ShareStaticPage {
  kind: "static";
  pagePath: "/sets" | "/how-to-play" | "/points" | "/about";
  file: string;
  alt: string;
  shareTitle: string;
  shareDescription: string;
  /** Cleared set whose already-masked cover is painted on this page. */
  cardSetId: string;
}

export interface ShareSetPage {
  kind: "set";
  pagePath: string;
  setId: string;
  file: string;
  alt: string;
  setName: string;
  year: number;
  brand: string;
  sport: string;
}

export type SharePage = ShareStaticPage | ShareSetPage;

const SETS: ShareSetPage[] = [
  page("2b77043a-6583-4d79-b59d-d2ab20291a17", "/sets/1986-topps-baseball-2b77043a", "1986 Topps Baseball", 1986, "Topps", "baseball"),
  page("3235b4fd-858a-424b-b9df-6f0f2d070d1b", "/sets/1995-upper-deck-basketball-3235b4fd", "1995 Upper Deck Basketball", 1995, "Upper Deck", "basketball"),
  page("affd57b8-2b1d-4ea3-9f51-1530d8088e5c", "/sets/1988-topps-baseball-affd57b8", "1988 Topps Baseball", 1988, "Topps", "baseball"),
  page("3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4", "/sets/1987-donruss-baseball-3ff8de8d", "1987 Donruss Baseball", 1987, "Donruss", "baseball"),
  page("d226801a-da94-47f6-a09a-3735def60b2d", "/sets/1990-hoops-basketball-d226801a", "1990 Hoops Basketball", 1990, "Hoops", "basketball"),
  page("74885a41-2043-4b7c-ab58-f9e16c05e2e3", "/sets/2022-panini-chronicles-football-74885a41", "2022 Panini Chronicles Football", 2022, "Panini", "football"),
  page("91cfdf3f-a620-4e73-adc8-22b8df221716", "/sets/1987-topps-football-91cfdf3f", "1987 Topps Football", 1987, "Topps", "football"),
  page("aea515e2-24bc-42bd-a602-1514b89e8cd1", "/sets/1989-fleer-basketball-aea515e2", "1989 Fleer Basketball", 1989, "Fleer", "basketball"),
  page("a09b2fe7-728e-431b-9df8-bbf2652aa3b2", "/sets/1994-topps-football-a09b2fe7", "1994 Topps Football", 1994, "Topps", "football"),
  page("229f0379-aa56-40a8-abe3-1af217a397e8", "/sets/2024-25-topps-chrome-basketball-229f0379", "2024-25 Topps Chrome Basketball", 2024, "Topps", "basketball"),
  page("352b33d1-c110-4e09-b641-8e3c02a94442", "/sets/1989-topps-baseball-352b33d1", "1989 Topps Baseball", 1989, "Topps", "baseball"),
  page("37fd025d-2ae1-4c92-b8ad-133375d0c722", "/sets/1987-topps-baseball-37fd025d", "1987 Topps Baseball", 1987, "Topps", "baseball"),
];

function page(setId: string, pagePath: string, setName: string, year: number, brand: string, sport: string): ShareSetPage {
  return {
    kind: "set",
    pagePath,
    setId,
    file: `${setId}.png`,
    alt: `Masked ${setName} card`,
    setName,
    year,
    brand,
    sport,
  };
}

/** Share titles and descriptions have no digits and no commission percentages. */
export const STATIC_SHARE_PAGES: ShareStaticPage[] = [
  {
    kind: "static",
    pagePath: "/sets",
    file: "sets.png",
    alt: "Masked sports cards on the PackPTS sets shelf.",
    shareTitle: "Sports Card Sets to Play | PackPTS",
    shareDescription: "Play classic and modern card sets on PackPTS. Real cards with the names masked. Free to play.",
    cardSetId: "37fd025d-2ae1-4c92-b8ad-133375d0c722",
  },
  {
    kind: "static",
    pagePath: "/how-to-play",
    file: "how-to-play.png",
    alt: "A masked sports card next to how to play PackPTS.",
    shareTitle: "How to Play PackPTS",
    shareDescription: "See a real sports card with the name masked, then pick the player. Free to play on PackPTS.",
    cardSetId: "aea515e2-24bc-42bd-a602-1514b89e8cd1",
  },
  {
    kind: "static",
    pagePath: "/points",
    file: "points.png",
    alt: "PackPTS points, earned by naming the player.",
    shareTitle: "How PackPTS Points Work",
    shareDescription: "Earn points by naming the player. Use them toward rebates on eligible eBay card purchases.",
    cardSetId: "3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4",
  },
  {
    kind: "static",
    pagePath: "/about",
    file: "about.png",
    alt: "PackPTS, a sports card game built by collectors.",
    shareTitle: "About PackPTS",
    shareDescription: "PackPTS is a free sports card game built by collectors. Real cards, names masked.",
    cardSetId: "352b33d1-c110-4e09-b641-8e3c02a94442",
  },
];

export const SET_SHARE_PAGES: readonly ShareSetPage[] = SETS;

export const SHARE_PAGES: readonly SharePage[] = [...STATIC_SHARE_PAGES, ...SETS];

export function shareImagePublicPath(file: string): string {
  return `${SHARE_PUBLIC_DIR}/${file}`;
}

export function sharePageForPath(url: string): SharePage | null {
  const raw = (url || "/").split("?")[0].split("#")[0] || "/";
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  return SHARE_PAGES.find((page) => page.pagePath === path) ?? null;
}

/** Static share copy must not carry digits or a commission percentage. */
export function staticShareCopyForbidden(text: string): boolean {
  return /\d|%|[\u2013\u2014]/.test(text);
}

export function withShareCacheBuster(url: string, buildId: string): string {
  const id = (buildId || "").trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) return url;
  const absolute = url.startsWith("http://") || url.startsWith("https://");
  let parsed: URL;
  try {
    parsed = new URL(url, PACKPTS_ORIGIN);
  } catch {
    return url;
  }
  parsed.searchParams.set("v", id);
  if (absolute) return parsed.toString();
  return `${parsed.pathname}${parsed.search}`;
}
