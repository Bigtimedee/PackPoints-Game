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

/** Design story crops (1080×1920) — packpts-design/play-sets/exports/ filenames. */
export const PLAY_SETS_STORY_FILES = {
  play_this_set: "play-set-story.png",
  integrated_shelf: "play-shelf-story.png",
  beat_me_from_set: "play-beatme-story.png",
} as const;

/** Design drop → files the app serves at /assets/play-sets/. Do not invent art. */
export const PLAY_SETS_DESIGN_EXPORT_DIR = "packpts-design/play-sets/exports";

export const PLAY_SETS_DESIGN_EXPORT_MAP = [
  { from: "play-set-1080.png", to: "play-this-set.png" },
  { from: "play-shelf-1080.png", to: "integrated-shelf.png" },
  { from: "play-beatme-1080.png", to: "beat-me-from-a-set.png" },
  { from: "play-set-story.png", to: "play-set-story.png" },
  { from: "play-shelf-story.png", to: "play-shelf-story.png" },
  { from: "play-beatme-story.png", to: "play-beatme-story.png" },
] as const;

export const PLAY_SETS_FORMATS = ["square", "story"] as const;
export type PlaySetsFormat = (typeof PLAY_SETS_FORMATS)[number];

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

function firstQueryString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

function normalizeSurfaceKey(value: string): string {
  return value.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

/**
 * Marketing aliases → A / B / C. `beat_me` / `beat-me` / `beat_me_from_a_set`
 * must resolve to surface C (not fall through to integrated_shelf).
 */
export function parsePlaySetsSurface(value: unknown): PlaySetsSurface {
  if (typeof value !== "string") return "integrated_shelf";
  const raw = value.trim();
  if (raw === "A" || raw === "a") return "play_this_set";
  if (raw === "B" || raw === "b") return "integrated_shelf";
  if (raw === "C" || raw === "c") return "beat_me_from_set";

  const key = normalizeSurfaceKey(raw);
  if (
    key === "beatme"
    || key.startsWith("beat_me")
    || key.startsWith("beatme_")
  ) {
    return "beat_me_from_set";
  }
  if (
    key === "play_this_set"
    || key === "play_this"
    || key === "play_set"
    || key === "play_a_set"
  ) {
    return "play_this_set";
  }
  if (key === "integrated_shelf" || key === "shelf" || key === "sets_shelf") {
    return "integrated_shelf";
  }
  if (isPlaySetsSurface(key)) return key;
  return "integrated_shelf";
}

export function parsePlaySetsFormat(value: unknown): PlaySetsFormat {
  if (typeof value !== "string") return "square";
  const key = normalizeSurfaceKey(value);
  if (
    key === "story"
    || key === "stories"
    || key === "9_16"
    || key === "1080x1920"
  ) {
    return "story";
  }
  return "square";
}

export function playSetsKitPath(surface: PlaySetsSurface): string {
  const file = PLAY_SETS_KIT_FILES[surface];
  return `${PLAY_SETS_KIT_DIR}/${file}`;
}

export function playSetsStoryKitPath(surface: PlaySetsSurface): string {
  return `${PLAY_SETS_KIT_DIR}/${PLAY_SETS_STORY_FILES[surface]}`;
}

/**
 * Clean a set UUID or public slug from `set` / `slug` / a full /sets URL.
 * Strips origin, `/sets/`, query, and hash so slug lookup is not id-only.
 */
export function normalizePlaySetsSetRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let cleaned = value.trim();
  if (!cleaned) return null;

  cleaned = cleaned.split("?")[0].split("#")[0];
  cleaned = cleaned.replace(/^https?:\/\/[^/]+/i, "");
  cleaned = cleaned.replace(/^\/+/, "");
  if (cleaned.toLowerCase().startsWith("sets/")) cleaned = cleaned.slice(5);
  if (cleaned.toLowerCase() === "sets") return null;
  try {
    cleaned = decodeURIComponent(cleaned).trim();
  } catch {
    cleaned = cleaned.trim();
  }
  cleaned = cleaned.replace(/\/+$/, "");
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  if (lower === "make" || lower.startsWith("make/") || lower.includes("/make")) return null;
  return cleaned;
}

/** Accept `set`, `slug`, or `id` — Marketing copies any of these. */
export function playSetsSetRefFromQuery(query: {
  set?: unknown;
  slug?: unknown;
  id?: unknown;
}): string | null {
  return normalizePlaySetsSetRef(
    firstQueryString(query.set) || firstQueryString(query.slug) || firstQueryString(query.id),
  );
}

export function playSetsDashedUuid(raw: string): string | null {
  if (UUID_RE.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(raw)) {
    const h = raw.toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return null;
}

/** Last 8 hex of `name-a1b2c3d4`, or a bare 8-hex prefix. */
export function playSetsSlugIdPrefix(raw: string): string | null {
  const cleaned = normalizePlaySetsSetRef(raw) ?? raw.trim().toLowerCase();
  const match = cleaned.toLowerCase().match(/-([a-f0-9]{8})$/)
    || cleaned.toLowerCase().match(/^([a-f0-9]{8})$/);
  return match?.[1] ?? null;
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
  format?: PlaySetsFormat | string | null;
}): PlaySetsImageChoice {
  const surface = parsePlaySetsSurface(opts.surface);
  const format = parsePlaySetsFormat(opts.format);
  const kit = format === "story" ? playSetsStoryKitPath(surface) : playSetsKitPath(surface);
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
