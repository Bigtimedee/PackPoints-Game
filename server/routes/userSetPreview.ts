/**
 * Public /sets cover + stack payloads. No player names.
 * Kept free of db so unit tests can import this file without DATABASE_URL.
 * Locked: docs/SETS_POLISH.md
 */
import { STOCK_FAN_ASSET } from "../contentFactory/makerShareSlug";

export function isStockFanUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.toLowerCase().includes(STOCK_FAN_ASSET);
}

export function usablePublicImageUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (isStockFanUrl(trimmed)) return null;
  if (
    !(
      trimmed.startsWith("/") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("http://")
    )
  ) {
    return null;
  }
  return trimmed;
}

export function extractCardYear(set?: string | null, description?: string | null): number | null {
  for (const text of [set, description]) {
    if (!text) continue;
    const match = text.match(/\b((?:19|20)\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return null;
}

export interface PublicPreviewCard {
  imageUrl: string | null;
  year: number | null;
}

export function toPublicPreviewCard(row: {
  imageUrl?: string | null;
  set?: string | null;
  description?: string | null;
  player?: string | null;
}): PublicPreviewCard {
  return {
    imageUrl: usablePublicImageUrl(row.imageUrl),
    year: extractCardYear(row.set, row.description),
  };
}

export function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function sanitizeCoverCardUrls(value: unknown): string[] {
  return parseJsonArray(value)
    .map(usablePublicImageUrl)
    .filter((url): url is string => !!url)
    .slice(0, 8);
}

/**
 * Raw `db.execute` returns `timestamp without time zone` as
 * `YYYY-MM-DD HH:MM:SS`. Treat that wall clock as UTC so browse JSON
 * matches drizzle Date → ISO on GET /api/sets/:id.
 */
export function createdAtToIso(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const naive = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(trimmed);
  const d = new Date(naive ? `${naive[1]}T${naive[2]}Z` : trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
