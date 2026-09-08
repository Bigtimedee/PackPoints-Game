/**
 * Public /sets cover + stack payloads. No player names.
 * Locked: docs/SETS_POLISH.md
 */
import { sql } from "drizzle-orm";
import { addPackptsDays, getPackptsDayKey } from "@shared/packptsDay";
import { db } from "../db";
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

/** completed_at is a varchar ISO/date prefix; compare as CT day keys. */
export async function userPlayedSetToday(userId: string, setId: string): Promise<boolean> {
  const today = getPackptsDayKey();
  const tomorrow = addPackptsDays(today, 1);
  const result = await db.execute(sql`
    SELECT 1 AS hit
    FROM game_sessions
    WHERE user_id = ${userId}
      AND status = 'completed'
      AND (questions->0->'card'->>'gameSetId') = ${setId}
      AND completed_at IS NOT NULL
      AND completed_at >= ${today}
      AND completed_at < ${tomorrow}
    LIMIT 1
  `);
  return result.rows.length > 0;
}
