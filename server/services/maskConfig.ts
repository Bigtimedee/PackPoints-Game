import { db } from "../db";
import { cardSetMasks, gameSets, DEFAULT_MASK_REGIONS, MaskRegion } from "@shared/schema";
import { eq } from "drizzle-orm";
import { buildSetMaskHint, isMaskSetUuid, regionsEqual } from "@shared/maskGeometry";
import { getMaskProfile } from "../masking/maskProfiles";

interface MaskConfig {
  setKey: string;
  regions: MaskRegion[];
  maskVersion: number;
  profileId?: string;
}

const maskCache = new Map<string, { config: MaskConfig; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function regionsFromHint(hint: string): { regions: MaskRegion[]; profileId: string } {
  const profile = getMaskProfile(hint);
  return {
    regions: profile.regions.map((region) => ({ ...region })),
    profileId: profile.id,
  };
}

async function hintFromSetKey(setKey: string): Promise<string> {
  if (!isMaskSetUuid(setKey)) return setKey;
  try {
    const [gameSet] = await db
      .select({
        year: gameSets.year,
        brand: gameSets.brand,
        sport: gameSets.sport,
        setName: gameSets.setName,
      })
      .from(gameSets)
      .where(eq(gameSets.id, setKey))
      .limit(1);

    if (!gameSet) return setKey;
    return buildSetMaskHint(gameSet);
  } catch {
    return setKey;
  }
}

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
      profileId: "default",
    };
  } else {
    const [row] = await db
      .select()
      .from(cardSetMasks)
      .where(eq(cardSetMasks.setKey, setKey))
      .limit(1);

    const hint = await hintFromSetKey(setKey);
    const fromProfile = regionsFromHint(hint);
    const dbRegions = row ? (row.regions as MaskRegion[]) : null;
    const dbIsDefault = !dbRegions || regionsEqual(dbRegions, DEFAULT_MASK_REGIONS);

    if (row && !dbIsDefault) {
      config = {
        setKey: row.setKey,
        regions: dbRegions,
        maskVersion: row.maskVersion,
        profileId: fromProfile.profileId,
      };
    } else {
      config = {
        setKey,
        regions: fromProfile.regions,
        maskVersion: row?.maskVersion ?? 1,
        profileId: fromProfile.profileId,
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
