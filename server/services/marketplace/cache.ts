import { db } from "../../db";
import { marketplaceCache } from "@shared/schema";
import { eq, and, lt, gt } from "drizzle-orm";
import type { MarketplaceSource } from "./types";

const DEFAULT_TTL_SECONDS = 300;

export async function getFromCache<T>(
  source: MarketplaceSource,
  cacheKey: string
): Promise<{ data: T; lastUpdated: string } | null> {
  const now = new Date();
  
  const cached = await db.query.marketplaceCache.findFirst({
    where: and(
      eq(marketplaceCache.source, source),
      eq(marketplaceCache.cacheKey, cacheKey),
      gt(marketplaceCache.expiresAt, now)
    ),
  });

  if (cached) {
    return {
      data: cached.payload as T,
      lastUpdated: cached.createdAt?.toISOString() || now.toISOString(),
    };
  }

  return null;
}

export async function setCache<T>(
  source: MarketplaceSource,
  cacheKey: string,
  data: T,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  await db
    .insert(marketplaceCache)
    .values({
      source,
      cacheKey,
      payload: data as any,
      expiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: marketplaceCache.cacheKey,
      set: {
        source,
        payload: data as any,
        expiresAt,
        createdAt: now,
      },
    });
}

export async function getOrSetCache<T>(
  source: MarketplaceSource,
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<{ data: T; lastUpdated: string; cached: boolean }> {
  const cached = await getFromCache<T>(source, cacheKey);
  
  if (cached) {
    return { ...cached, cached: true };
  }

  const data = await fetcher();
  await setCache(source, cacheKey, data, ttlSeconds);
  
  return {
    data,
    lastUpdated: new Date().toISOString(),
    cached: false,
  };
}

export async function clearExpiredCache(): Promise<number> {
  const now = new Date();
  const deleted = await db
    .delete(marketplaceCache)
    .where(lt(marketplaceCache.expiresAt, now))
    .returning({ id: marketplaceCache.id });

  return deleted.length;
}
