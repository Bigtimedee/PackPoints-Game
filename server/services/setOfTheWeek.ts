import { db } from "../db";
import { setOfTheWeek, gameSets } from "@shared/schema";
import { eq, and, lte, gte } from "drizzle-orm";

export interface ActiveSetOfWeek {
  id: string;
  setId: string;
  multiplier: number;
  startsAt: Date;
  endsAt: Date;
  setName?: string;
  brand?: string;
  year?: number;
}

let cache: { data: ActiveSetOfWeek | null; ts: number } | null = null;
const CACHE_TTL = 60_000;

export async function getActiveSetOfWeek(now?: Date): Promise<ActiveSetOfWeek | null> {
  const t = now?.getTime() ?? Date.now();
  if (cache && t - cache.ts < CACHE_TTL) return cache.data;

  const nowDate = now ?? new Date();
  const rows = await db
    .select({
      id: setOfTheWeek.id,
      setId: setOfTheWeek.setId,
      multiplier: setOfTheWeek.multiplier,
      startsAt: setOfTheWeek.startsAt,
      endsAt: setOfTheWeek.endsAt,
      setName: gameSets.setName,
      brand: gameSets.brand,
      year: gameSets.year,
    })
    .from(setOfTheWeek)
    .innerJoin(gameSets, eq(setOfTheWeek.setId, gameSets.id))
    .where(and(lte(setOfTheWeek.startsAt, nowDate), gte(setOfTheWeek.endsAt, nowDate)))
    .limit(1);

  const result = rows[0] ?? null;
  cache = { data: result, ts: t };
  return result;
}

export function clearSetOfWeekCache() {
  cache = null;
}
