/**
 * Goldin-quiet /sets helpers. Locked: docs/SETS_POLISH.md
 * Keep this file free of React so vitest can import it in node.
 */
import { formatPackptsMonDay, isPackptsDayKey } from "@shared/packptsDay";
import { isMaskedSetCoverUrl, publicSetShareUrl } from "@shared/setCoverUrl";

export const SETS_POLISH = {
  canvas: "#0b0f16",
  ink: "#F0F2F5",
  muted: "#8F96A3",
  gold: "#F5C518",
  blue: "#2B6CEE",
  panel: "#121821",
  panelBorder: "#2a3344",
  cream: "#F3E6C8",
  stockFanAsset: "maker-set-1080.png",
  eyebrow: "SETS",
  indexTitle: "Sets",
  indexSub: "Play sets already in PackPTS.",
  playThisSet: "Play this set",
  playTodayCue: "Play today’s stack",
  fanMade: "FAN MADE",
  stackHeading: "THE STACK",
  surfaceACaption: "Share cover · runtime Surface A",
} as const;

export const FORBIDDEN_PUBLIC_SETS_COPY = [
  "times played",
  "maker rate",
  "trending",
  "dau",
  "wau",
  "mau",
  SETS_POLISH.stockFanAsset,
];

export function isStockFanUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.toLowerCase().includes(SETS_POLISH.stockFanAsset);
}

export function sanitizeCoverCardUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  for (const url of urls) {
    if (!isMaskedSetCoverUrl(url)) continue;
    out.push(url.trim());
    if (out.length >= 8) break;
  }
  return out;
}

export function sanitizePreviewCards(cards: unknown): Array<{ imageUrl: string | null; year: number | null }> {
  if (!Array.isArray(cards)) return [];
  const out: Array<{ imageUrl: string | null; year: number | null }> = [];
  for (const card of cards) {
    if (!card || typeof card !== "object") continue;
    const row = card as { imageUrl?: unknown; year?: unknown };
    const imageUrl = isMaskedSetCoverUrl(row.imageUrl) ? row.imageUrl.trim() : null;
    const year = typeof row.year === "number" && Number.isFinite(row.year) ? row.year : null;
    if (!imageUrl && year == null) continue;
    out.push({ imageUrl, year });
    if (out.length >= 8) break;
  }
  return out;
}

export type SetCoverSource =
  | { kind: "surfaceA"; src: string }
  | { kind: "stack"; urls: string[] };

/** Runtime Surface A wins. Stock fan and raw card photos never count as a cover. */
export function resolveSetCover(shareImageUrl: unknown, cardUrls: unknown): SetCoverSource {
  const share = publicSetShareUrl(shareImageUrl);
  if (share) return { kind: "surfaceA", src: share };
  return { kind: "stack", urls: sanitizeCoverCardUrls(cardUrls) };
}

/**
 * Instant for an authored `createdAt`. Naive Postgres `timestamp`
 * (`YYYY-MM-DD HH:MM:SS`) is UTC — same as drizzle Date JSON — so index
 * and detail share one America/Chicago day.
 */
export function parseAuthoredInstant(iso: string): Date | null {
  const trimmed = iso.trim();
  if (!trimmed) return null;
  if (isPackptsDayKey(trimmed)) {
    return new Date(`${trimmed}T12:00:00.000Z`);
  }
  const naive = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(trimmed);
  const d = new Date(naive ? `${naive[1]}T${naive[2]}Z` : trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatAuthoredDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = parseAuthoredInstant(iso);
  if (!d) return null;
  const label = formatPackptsMonDay(d);
  return label || null;
}

export function honestCardCountLabel(cardCount: unknown): string {
  const n = Math.max(0, Math.floor(Number(cardCount) || 0));
  return n === 1 ? "1 card" : `${n} cards`;
}

/**
 * Integrated sets have no maker. A blank username must not become "by Maker",
 * a date, or AUTHORED. User-created sets with a real username keep provenance.
 */
export function formatSetMetaLine(opts: {
  makerUsername?: string | null;
  cardCount: unknown;
  createdAt?: string | null;
  authored?: boolean;
}): string {
  const maker = (opts.makerUsername || "").trim();
  const showProvenance = opts.authored !== false && maker.length > 0;
  const parts: string[] = [];
  if (showProvenance) parts.push(`by ${maker}`);
  parts.push(honestCardCountLabel(opts.cardCount));
  if (showProvenance) {
    const date = formatAuthoredDate(opts.createdAt);
    if (date) parts.push(date);
    parts.push("AUTHORED");
  }
  return parts.join(" · ");
}

export function formatDetailMetaLine(opts: {
  makerUsername?: string | null;
  coCreatorUsername?: string | null;
  createdAt?: string | null;
  authored?: boolean;
}): string {
  const maker = (opts.makerUsername || "").trim();
  if (opts.authored === false || !maker) return "";
  const who = opts.coCreatorUsername?.trim()
    ? `by ${maker} & ${opts.coCreatorUsername.trim()}`
    : `by ${maker}`;
  const parts = [who];
  const date = formatAuthoredDate(opts.createdAt);
  if (date) parts.push(date);
  parts.push("AUTHORED");
  return parts.join(" · ");
}

/**
 * Index heading. Other sets already carry the brand inside `setName`
 * ("1987 Topps", "1989 Fleer Basketball"). When the stored name omits a
 * brand that is on the row, insert that brand. A blank brand leaves the
 * stored name. The year column is not substituted for the year in the name.
 */
export function formatIndexSetTitle(opts: {
  setName: string;
  brand?: string | null;
}): string {
  const name = (opts.setName || "").trim();
  const brand = (opts.brand || "").trim();
  if (!name) return brand;
  if (!brand || titleHasBrand(name, brand)) return name;
  const leading = /^(\d{4})\b\s*(.*)$/.exec(name);
  if (!leading) return `${brand} ${name}`;
  const rest = leading[2].trim();
  return rest ? `${leading[1]} ${brand} ${rest}` : `${leading[1]} ${brand}`;
}

function titleHasBrand(name: string, brand: string): boolean {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:[^A-Za-z0-9]|$)`, "i").test(name);
}

/** Fanned thumbs paint a solid plaque. The in-game card keeps its label. */
export type PlaqueChrome = "full" | "bar";

export function plaqueChromeShowsLabel(chrome: PlaqueChrome): boolean {
  return chrome !== "bar";
}

export function shouldShowPlayTodayCue(playedToday: boolean | null | undefined): boolean {
  return playedToday !== true;
}

/** Solo start must stay inside startGameSchema (5–20). Null = do not start. */
export function playQuestionCount(cardCount: unknown): number | null {
  const n = Math.floor(Number(cardCount) || 0);
  if (n < 5) return null;
  return Math.min(20, n);
}

export function setShareSlug(setName: string, setId: string): string {
  const kebab = (setName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const idPart = (setId || "").replace(/-/g, "").slice(0, 8).toLowerCase();
  return kebab ? `${kebab}-${idPart}` : idPart;
}

export function publicSetDisplayUrl(setName: string, setId: string): string {
  return `packpts.com/sets/${setShareSlug(setName, setId)}`;
}

export function containsForbiddenPublicSetsCopy(text: string): boolean {
  const hay = text.toLowerCase();
  return FORBIDDEN_PUBLIC_SETS_COPY.some((needle) => hay.includes(needle.toLowerCase()));
}
