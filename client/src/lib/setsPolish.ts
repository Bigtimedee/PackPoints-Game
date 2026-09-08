/**
 * Goldin-quiet /sets helpers. Locked: docs/SETS_POLISH.md
 * Keep this file free of React so vitest can import it in node.
 */
import { isUsableImageUrl } from "./shareAssetUrl";

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
  volumeGate: 10,
  eyebrow: "SETS",
  indexTitle: "Maker sets",
  indexSub: "Built from the PC. Authored, not scrolled.",
  shortShelfTitle: "A short shelf.",
  shortShelfBody: "Real maker sets only — no filler. Snap yours on /make.",
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
  return urls
    .filter((u): u is string => isUsableImageUrl(u) && !isStockFanUrl(u))
    .map((u) => u.trim())
    .slice(0, 8);
}

export type SetCoverSource =
  | { kind: "surfaceA"; src: string }
  | { kind: "stack"; urls: string[] };

/** Runtime Surface A wins. Stock fan never counts as a cover. */
export function resolveSetCover(shareImageUrl: unknown, cardUrls: unknown): SetCoverSource {
  if (isUsableImageUrl(shareImageUrl) && !isStockFanUrl(shareImageUrl)) {
    return { kind: "surfaceA", src: shareImageUrl.trim() };
  }
  return { kind: "stack", urls: sanitizeCoverCardUrls(cardUrls) };
}

export function formatAuthoredDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  return `${mon} ${d.getUTCDate()}`;
}

export function honestCardCountLabel(cardCount: unknown): string {
  const n = Math.max(0, Math.floor(Number(cardCount) || 0));
  return n === 1 ? "1 card" : `${n} cards`;
}

export function formatSetMetaLine(opts: {
  makerUsername?: string | null;
  cardCount: unknown;
  createdAt?: string | null;
  authored?: boolean;
}): string {
  const parts: string[] = [];
  const maker = (opts.makerUsername || "").trim() || "Maker";
  parts.push(`by ${maker}`);
  parts.push(honestCardCountLabel(opts.cardCount));
  const date = formatAuthoredDate(opts.createdAt);
  if (date) parts.push(date);
  if (opts.authored !== false) parts.push("AUTHORED");
  return parts.join(" · ");
}

export function formatDetailMetaLine(opts: {
  makerUsername?: string | null;
  coCreatorUsername?: string | null;
  createdAt?: string | null;
  authored?: boolean;
}): string {
  const maker = (opts.makerUsername || "").trim() || "Maker";
  const who = opts.coCreatorUsername?.trim()
    ? `by ${maker} & ${opts.coCreatorUsername.trim()}`
    : `by ${maker}`;
  const parts = [who];
  const date = formatAuthoredDate(opts.createdAt);
  if (date) parts.push(date);
  if (opts.authored !== false) parts.push("AUTHORED");
  return parts.join(" · ");
}

/** Honest published-list length only — never an admin Maker Rate field. */
export function shouldShowShortShelf(publishedCount: number): boolean {
  const n = Math.max(0, Math.floor(publishedCount));
  return n > 0 && n < SETS_POLISH.volumeGate;
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
