import { db } from "../db";
import { cardSetMasks, DEFAULT_MASK_REGIONS, MaskRegion } from "@shared/schema";
import { eq } from "drizzle-orm";

interface MaskConfig {
  setKey: string;
  regions: MaskRegion[];
  maskVersion: number;
}

const maskCache = new Map<string, { config: MaskConfig; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getMaskConfig(setKey: string): Promise<MaskConfig> {
  const cacheKey = setKey || "__default__";
  const now = Date.now();
  
  const cached = maskCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.config;
  }
  
  let config: MaskConfig;
  
  if (!setKey) {
    config = {
      setKey: "__default__",
      regions: DEFAULT_MASK_REGIONS,
      maskVersion: 1,
    };
  } else {
    const [row] = await db
      .select()
      .from(cardSetMasks)
      .where(eq(cardSetMasks.setKey, setKey))
      .limit(1);
    
    if (row) {
      config = {
        setKey: row.setKey,
        regions: row.regions as MaskRegion[],
        maskVersion: row.maskVersion,
      };
    } else {
      config = {
        setKey: setKey,
        regions: DEFAULT_MASK_REGIONS,
        maskVersion: 1,
      };
    }
  }
  
  maskCache.set(cacheKey, {
    config,
    expiresAt: now + CACHE_TTL_MS,
  });
  
  return config;
}

export function clearMaskCache(setKey?: string): void {
  if (setKey) {
    maskCache.delete(setKey);
  } else {
    maskCache.clear();
  }
}

export async function resetAllMaskRegions(): Promise<void> {
  await db
    .update(cardSetMasks)
    .set({
      regions: DEFAULT_MASK_REGIONS,
      maskVersion: 1,
      updatedAt: new Date(),
    });
  maskCache.clear();
  console.log("[MaskConfig] Reset all card set masks to DEFAULT_MASK_REGIONS (blur)");
}

export async function saveMaskConfig(
  setKey: string,
  regions: MaskRegion[],
  providerSetId?: string
): Promise<MaskConfig> {
  const [existing] = await db
    .select()
    .from(cardSetMasks)
    .where(eq(cardSetMasks.setKey, setKey))
    .limit(1);
  
  if (existing) {
    await db
      .update(cardSetMasks)
      .set({
        regions,
        providerSetId: providerSetId || existing.providerSetId,
        maskVersion: existing.maskVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(cardSetMasks.setKey, setKey));
    
    const config: MaskConfig = {
      setKey,
      regions,
      maskVersion: existing.maskVersion + 1,
    };
    
    clearMaskCache(setKey);
    return config;
  } else {
    await db.insert(cardSetMasks).values({
      setKey,
      regions,
      providerSetId,
      maskVersion: 1,
    });
    
    const config: MaskConfig = {
      setKey,
      regions,
      maskVersion: 1,
    };
    
    clearMaskCache(setKey);
    return config;
  }
}
