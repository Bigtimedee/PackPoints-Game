import { db } from "../../db";
import { gameSets, userActiveSets, matchContextLog } from "@shared/schema";
import { eq, desc, and, gte, inArray } from "drizzle-orm";
import type { GameSet } from "@shared/schema";

export interface GameContext {
  gameSet: GameSet;
  contextKey: string;
}

export function buildContextKey(sport: string, year: number, brand: string): string {
  return `${sport}:${year}:${brand}`;
}

export function parseContextKey(contextKey: string): { sport: string; year: number; brand: string } | null {
  const parts = contextKey.split(":");
  if (parts.length !== 3) return null;
  const [sport, yearStr, brand] = parts;
  const year = parseInt(yearStr, 10);
  if (isNaN(year)) return null;
  return { sport, year, brand };
}

export function gameSetToContext(gameSet: GameSet): GameContext {
  return {
    gameSet,
    contextKey: buildContextKey(gameSet.sport, gameSet.year, gameSet.brand),
  };
}

export async function getActiveGameSets(): Promise<GameSet[]> {
  return db.select().from(gameSets).where(eq(gameSets.isActive, true));
}

export async function getGameSetById(id: string): Promise<GameSet | null> {
  const results = await db.select().from(gameSets).where(eq(gameSets.id, id)).limit(1);
  return results[0] || null;
}

export async function getDefaultGameSets(limit: number = 2): Promise<GameSet[]> {
  return db
    .select()
    .from(gameSets)
    .where(eq(gameSets.isActive, true))
    .limit(limit);
}

export async function getUserActiveContexts(
  userId: string | null,
  maxContexts: number = 5
): Promise<GameContext[]> {
  if (!userId) {
    const defaults = await getDefaultGameSets(maxContexts);
    return defaults.map(gameSetToContext);
  }

  const userSets = await db
    .select({
      gameSet: gameSets,
      lastUsedAt: userActiveSets.lastUsedAt,
      isDefault: userActiveSets.isDefault,
    })
    .from(userActiveSets)
    .innerJoin(gameSets, eq(userActiveSets.gameSetId, gameSets.id))
    .where(
      and(
        eq(userActiveSets.userId, userId),
        eq(gameSets.isActive, true)
      )
    )
    .orderBy(desc(userActiveSets.isDefault), desc(userActiveSets.lastUsedAt))
    .limit(maxContexts);

  if (userSets.length > 0) {
    return userSets.map((row) => gameSetToContext(row.gameSet));
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentMatches = await db
    .select({
      gameSet: gameSets,
    })
    .from(matchContextLog)
    .innerJoin(gameSets, eq(matchContextLog.gameSetId, gameSets.id))
    .where(
      and(
        eq(matchContextLog.userId, userId),
        eq(gameSets.isActive, true),
        gte(matchContextLog.createdAt, sevenDaysAgo)
      )
    )
    .orderBy(desc(matchContextLog.createdAt))
    .limit(maxContexts);

  if (recentMatches.length > 0) {
    const uniqueSets = new Map<string, GameSet>();
    for (const match of recentMatches) {
      if (!uniqueSets.has(match.gameSet.id)) {
        uniqueSets.set(match.gameSet.id, match.gameSet);
      }
      if (uniqueSets.size >= maxContexts) break;
    }
    return Array.from(uniqueSets.values()).map(gameSetToContext);
  }

  const defaults = await getDefaultGameSets(maxContexts);
  return defaults.map(gameSetToContext);
}

export async function updateUserActiveSets(
  userId: string,
  gameSetIds: string[],
  defaultSetId?: string
): Promise<void> {
  const validSets = await db
    .select()
    .from(gameSets)
    .where(
      and(
        inArray(gameSets.id, gameSetIds),
        eq(gameSets.isActive, true)
      )
    );

  const validSetIds = new Set(validSets.map((s) => s.id));

  await db.delete(userActiveSets).where(eq(userActiveSets.userId, userId));

  const now = new Date();
  for (const setId of gameSetIds) {
    if (!validSetIds.has(setId)) continue;

    await db.insert(userActiveSets).values({
      userId,
      gameSetId: setId,
      lastUsedAt: now,
      isDefault: setId === defaultSetId,
    });
  }

  for (const setId of gameSetIds) {
    if (!validSetIds.has(setId)) continue;

    await db.insert(matchContextLog).values({
      userId,
      gameSetId: setId,
      eventType: "SET_SELECTED",
    });
  }
}

export async function logMatchContext(
  userId: string,
  gameSetId: string,
  matchId: string | null,
  eventType: "MATCH_STARTED" | "MATCH_COMPLETED"
): Promise<void> {
  await db.insert(matchContextLog).values({
    userId,
    gameSetId,
    matchId,
    eventType,
  });

  await db
    .update(userActiveSets)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(userActiveSets.userId, userId),
        eq(userActiveSets.gameSetId, gameSetId)
      )
    );
}

export function buildMarketplaceQuery(
  gameSet: GameSet,
  userQuery?: string
): string {
  const keywords = gameSet.marketplaceKeywords as string[];
  const baseKeyword = keywords.length > 0 ? keywords[0] : `${gameSet.year} ${gameSet.brand} ${gameSet.sport}`;
  
  if (userQuery && userQuery.trim()) {
    return `${baseKeyword} ${userQuery.trim()}`;
  }
  
  return baseKeyword;
}

export function validateContextQuery(query: string, gameSet: GameSet): boolean {
  const lowerQuery = query.toLowerCase();
  const yearStr = gameSet.year.toString();
  const brandLower = gameSet.brand.toLowerCase();
  
  return lowerQuery.includes(yearStr) && lowerQuery.includes(brandLower);
}

export function getBroadeningQuery(gameSet: GameSet): string {
  return `${gameSet.year} ${gameSet.brand} ${gameSet.sport}`;
}

export function getContextTags(gameSet: GameSet): string[] {
  return [
    `sport:${gameSet.sport}`,
    `year:${gameSet.year}`,
    `brand:${gameSet.brand.toLowerCase()}`,
  ];
}
