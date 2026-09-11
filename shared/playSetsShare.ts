/**
 * Play-integrated set share kit — locked product contract.
 *
 * Destinations: /sets or /sets/{slug} only.
 * UTMs: utm_source=share&utm_medium=play_sets&utm_campaign=integrated
 * Brand: PackPTS. No /make, no Maker Rate, no public volume claims.
 *
 * Spec: docs/PLAY_SETS_SHARE.md
 */

export const PACKPTS_ORIGIN = "https://packpts.com";

export const PLAY_SETS_UTM = {
  utm_source: "share",
  utm_medium: "play_sets",
  utm_campaign: "integrated",
} as const;

export const PLAY_SETS_SURFACES = [
  "play_this_set",
  "integrated_shelf",
  "beat_me_from_set",
] as const;

export type PlaySetsSurface = (typeof PLAY_SETS_SURFACES)[number];

export const PLAY_SETS_KIT_FILES = {
  play_this_set: "play-this-set.png",
  integrated_shelf: "integrated-shelf.png",
  beat_me_from_a_set: "beat-me-from-a-set.png",
  beat_me_from_set: "beat-me-from-a-set.png",
} as const;

export const PLAY_SETS_KIT_DIR = "/assets/play-sets";

export const PLAY_SETS_COPY = {
  play_this_set: {
    eyebrow: "PLAY THIS SET",
    title: "Play this set",
    description: "Play this set on PackPTS.",
    caption: "Play this set on PackPTS.",
  },
  integrated_shelf: {
    eyebrow: "SETS",
    title: "Sets",
    description: "Play sets already in PackPTS.",
    caption: "Play sets already in PackPTS.",
  },
  beat_me_from_set: {
    eyebrow: "BEAT ME",
    title: "Beat me from a set",
    description: "Beat me on this set.",
    caption: "Beat me on this set.",
  },
} as const;

export const FORBIDDEN_PLAY_SETS_SHARE = [
  "/make",
  "snap-to-set",
  "snap to set",
  "maker rate",
  "packpoints",
  "times played",
  "trending",
  "maker-set-1080.png",
] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isPlaySetsSurface(value: unknown): value is PlaySetsSurface {
  return typeof value === "string" && (PLAY_SETS_SURFACES as readonly string[]).includes(value);
}

export function parsePlaySetsSurface(value: unknown): PlaySetsSurface {
  if (value === "A" || value === "a") return "play_this_set";
  if (value === "B" || value === "b") return "integrated_shelf";
  if (value === "C" || value === "c") return "beat_me_from_set";
  if (value === "beat_me_from_a_set") return "beat_me_from_set";
  if (isPlaySetsSurface(value)) return value;
  return "integrated_shelf";
}

export function playSetsKitPath(surface: PlaySetsSurface): string {
  const file = PLAY_SETS_KIT_FILES[surface];
  return `${PLAY_SETS_KIT_DIR}/${file}`;
}

export function absolutePackptsUrl(pathOrUrl: string, origin = PACKPTS_ORIGIN): string {
  const trimmed = (pathOrUrl || "").trim();
  if (!trimmed) return origin;
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${origin.replace(/\/$/, "")}${path}`;
}

export function playSetsUtmQuery(): string {
  const params = new URLSearchParams(PLAY_SETS_UTM);
  return params.toString();
}

/**
 * Only /sets or /sets/{slug|uuid}. Unknown or unsafe slugs fall back to /sets.
 * Never returns /make or any other product path.
 */
export function canonicalPlaySetsPath(slugOrId?: string | null): "/sets" | `/sets/${string}` {
  const raw = (slugOrId || "").trim();
  if (!raw) return "/sets";

  let cleaned = raw.replace(/^https?:\/\/[^/]+/i, "");
  cleaned = cleaned.split("?")[0].split("#")[0];
  cleaned = cleaned.replace(/^\/+/, "");
  if (cleaned.toLowerCase().startsWith("sets/")) cleaned = cleaned.slice(5);
  if (cleaned.toLowerCase() === "sets") return "/sets";
  cleaned = decodeURIComponent(cleaned).trim();

  if (!cleaned) return "/sets";
  const lower = cleaned.toLowerCase();
  if (lower === "make" || lower.startsWith("make/") || lower.includes("/make")) return "/sets";
  if (UUID_RE.test(cleaned)) return `/sets/${cleaned.toLowerCase()}`;
  if (SLUG_RE.test(lower) && lower.length <= 80) return `/sets/${lower}`;
  return "/sets";
}

export function playSetsSharePath(slugOrId?: string | null): string {
  const path = canonicalPlaySetsPath(slugOrId);
  return `${path}?${playSetsUtmQuery()}`;
}

export function playSetsShareUrl(opts?: {
  slugOrId?: string | null;
  origin?: string;
}): string {
  const origin = (opts?.origin || PACKPTS_ORIGIN).replace(/\/$/, "");
  return `${origin}${playSetsSharePath(opts?.slugOrId)}`;
}

export function isPlaySetsShareDestination(url: string): boolean {
  try {
    const parsed = new URL(url, PACKPTS_ORIGIN);
    const path = parsed.pathname.replace(/\/$/, "") || "/";
    if (path !== "/sets" && !path.startsWith("/sets/")) return false;
    if (path.startsWith("/make") || path.includes("/make")) return false;
    return (
      parsed.searchParams.get("utm_source") === PLAY_SETS_UTM.utm_source
      && parsed.searchParams.get("utm_medium") === PLAY_SETS_UTM.utm_medium
      && parsed.searchParams.get("utm_campaign") === PLAY_SETS_UTM.utm_campaign
    );
  } catch {
    return false;
  }
}

export function isStockFanShareUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.toLowerCase().includes("maker-set-1080.png");
}

export function isPlaySetsKitUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes(PLAY_SETS_KIT_DIR);
}

export function isUsableShareImageUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (isStockFanShareUrl(trimmed)) return false;
  return (
    trimmed.startsWith("/")
    || trimmed.startsWith("https://")
    || trimmed.startsWith("http://")
  );
}

export type PlaySetsImageKind = "runtime" | "kit";

export interface PlaySetsImageChoice {
  kind: PlaySetsImageKind;
  path: string;
}

/**
 * Runtime set cover / masked-stack crop wins. Kit templates are cold-post
 * placeholders only — never substitute kit A once a real set cover exists.
 */
export function preferPlaySetsShareImage(opts: {
  runtimeCoverUrl?: string | null;
  surface?: PlaySetsSurface | string | null;
  wantKit?: boolean;
}): PlaySetsImageChoice {
  const surface = parsePlaySetsSurface(opts.surface);
  const kit = playSetsKitPath(surface);
  if (opts.wantKit) return { kind: "kit", path: kit };
  if (isUsableShareImageUrl(opts.runtimeCoverUrl) && !isPlaySetsKitUrl(opts.runtimeCoverUrl)) {
    return { kind: "runtime", path: opts.runtimeCoverUrl.trim() };
  }
  return { kind: "kit", path: kit };
}

export function playSetsOgTitle(opts: {
  surface?: PlaySetsSurface;
  setName?: string | null;
}): string {
  const name = (opts.setName || "").trim();
  if (name) return `${name} · PackPTS`;
  const surface = opts.surface ?? "integrated_shelf";
  if (surface === "play_this_set") return "Play this set · PackPTS";
  if (surface === "beat_me_from_set") return "Beat me from a set · PackPTS";
  return "Sets · PackPTS";
}

export function playSetsOgDescription(opts: {
  surface?: PlaySetsSurface;
  setName?: string | null;
}): string {
  const name = (opts.setName || "").trim();
  const surface = opts.surface ?? (name ? "play_this_set" : "integrated_shelf");
  if (surface === "beat_me_from_set") {
    return name ? `Beat me on ${name}.` : PLAY_SETS_COPY.beat_me_from_set.description;
  }
  if (name) return `Play ${name} on PackPTS.`;
  return PLAY_SETS_COPY[surface].description;
}

export function containsForbiddenPlaySetsShareCopy(text: string): boolean {
  const hay = text.toLowerCase();
  return FORBIDDEN_PLAY_SETS_SHARE.some((needle) => hay.includes(needle.toLowerCase()));
}

export function parsePlaySetsHtmlPath(
  url: string,
): { kind: "index" } | { kind: "detail"; slug: string } | null {
  const pathOnly = url.split("?")[0].split("#")[0];
  if (pathOnly === "/sets" || pathOnly === "/sets/") return { kind: "index" };
  const match = /^\/sets\/([^/]+)$/.exec(pathOnly);
  if (!match) return null;
  return { kind: "detail", slug: decodeURIComponent(match[1]) };
}
