import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { db } from "../db";
import { cardImageMaskCache, baseballCards, playableCards, gameSets } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { maskCardImage, CURRENT_MASK_VERSION } from "./maskCardImage";
import { buildSetMaskHint, maskedCardImageUrl } from "@shared/maskGeometry";
import { MASKED_CARDS_DIR, readWarmMaskPlan, writeWarmMaskPlan } from "./maskPlanStore";

export { readWarmMaskPlan };

export function warmMaskedFilename(cardId: string): string {
  return `${cardId}_${CURRENT_MASK_VERSION}.jpg`;
}

/** Disk hit for the current bake — no DB. Filename is the cache key. */
export function peekWarmMaskedFilename(cardId: string): string | null {
  if (!cardId) return null;
  const filename = warmMaskedFilename(cardId);
  return existsSync(path.join(MASKED_CARDS_DIR, filename)) ? filename : null;
}

const maskingQueue: Map<string, Promise<string | null>> = new Map();
const coverageRefusals = new Map<string, string>();
let activeMaskingJobs = 0;
const MAX_CONCURRENT_OCR = 2;

async function ensureDirectory(): Promise<void> {
  try {
    await fs.mkdir(MASKED_CARDS_DIR, { recursive: true });
  } catch (error) {
    console.error("[MaskingService] Failed to create directory:", error);
  }
}

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "PackPTS-ImageMasker/1.0",
      },
    });
    
    if (!response.ok) {
      console.error(`[MaskingService] Failed to download image: ${response.status}`);
      return null;
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("[MaskingService] Error downloading image:", error);
    return null;
  }
}

/** Set when a bake is refused. The masked-image route reads this once. */
export function takeCoverageRefusal(cardId: string): string | null {
  const reason = coverageRefusals.get(cardId) ?? null;
  if (reason) coverageRefusals.delete(cardId);
  return reason;
}

export async function getMaskedImagePath(cardId: string): Promise<string | null> {
  const warm = peekWarmMaskedFilename(cardId);
  if (warm) {
    return warm;
  }

  if (maskingQueue.has(cardId)) {
    return maskingQueue.get(cardId)!;
  }

  const promise = generateMaskedImage(cardId);
  maskingQueue.set(cardId, promise);
  
  try {
    const result = await promise;
    return result;
  } finally {
    maskingQueue.delete(cardId);
  }
}

async function generateMaskedImage(cardId: string): Promise<string | null> {
  await ensureDirectory();

  let imageUrl: string | null = null;
  let playerName: string | null = null;
  let setHint: string | null = null;
  let gameSetId: string | null = null;

  const [baseballCard] = await db
    .select()
    .from(baseballCards)
    .where(eq(baseballCards.id, cardId))
    .limit(1);

  if (baseballCard?.imageUrl) {
    imageUrl = baseballCard.imageUrl;
    playerName = baseballCard.playerName;
    setHint = buildSetMaskHint({
      setName: baseballCard.setName,
      year: baseballCard.year,
      sport: "baseball",
    });
  } else {
    const [playableCard] = await db
      .select()
      .from(playableCards)
      .where(eq(playableCards.id, cardId))
      .limit(1);

    if (playableCard?.imageUrl) {
      imageUrl = playableCard.imageUrl;
      playerName = playableCard.player;
      let year: number | null = null;
      let brand: string | null = null;
      let sport: string | null = null;
      if (playableCard.gameSetId) {
        gameSetId = playableCard.gameSetId;
        const [gameSet] = await db
          .select({
            year: gameSets.year,
            brand: gameSets.brand,
            sport: gameSets.sport,
            setName: gameSets.setName,
          })
          .from(gameSets)
          .where(eq(gameSets.id, playableCard.gameSetId))
          .limit(1);
        if (gameSet) {
          year = gameSet.year;
          brand = gameSet.brand;
          sport = gameSet.sport;
          setHint = buildSetMaskHint({
            year,
            brand,
            sport,
            setName: playableCard.set || gameSet.setName,
            category: playableCard.category,
          });
        }
      }
      if (!setHint) {
        setHint = buildSetMaskHint({
          setName: playableCard.set,
          category: playableCard.category,
        });
      }
    }
  }

  if (!imageUrl) {
    console.error(`[MaskingService] Card not found or no image: ${cardId}`);
    return null;
  }

  const [cached] = await db
    .select()
    .from(cardImageMaskCache)
    .where(eq(cardImageMaskCache.cardId, cardId))
    .limit(1);

  if (
    cached &&
    cached.rawImageUrl === imageUrl &&
    cached.maskVersion === CURRENT_MASK_VERSION
  ) {
    try {
      await fs.access(path.join(MASKED_CARDS_DIR, cached.maskedImagePath));
      return cached.maskedImagePath;
    } catch {
    }
  }

  while (activeMaskingJobs >= MAX_CONCURRENT_OCR) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  activeMaskingJobs++;

  try {
    const imageBuffer = await downloadImage(imageUrl);
    if (!imageBuffer) {
      return null;
    }

    const result = await maskCardImage(
      imageBuffer,
      playerName || "",
      setHint,
      { gameSetId },
    );

    if (!result.coverageOk) {
      const reason = result.coverageReason || "mask_name_uncovered";
      coverageRefusals.set(cardId, reason);
      console.error(`[MaskingService] Refusing playable mask for ${cardId}: ${reason}`, {
        source: result.source,
        layoutClass: result.layoutClass,
        maskVersion: CURRENT_MASK_VERSION,
      });
      await quarantineUncoveredName(cardId, reason);
      return null;
    }

    const filename = warmMaskedFilename(cardId);
    const filePath = path.join(MASKED_CARDS_DIR, filename);
    
    await fs.writeFile(filePath, result.maskedBuffer);
    await writeWarmMaskPlan(cardId, {
      layoutClass: result.layoutClass,
      regions: result.regions,
      maskVersion: CURRENT_MASK_VERSION,
    });

    await db
      .insert(cardImageMaskCache)
      .values({
        cardId,
        rawImageUrl: imageUrl,
        maskedImagePath: filename,
        maskVersion: CURRENT_MASK_VERSION,
        layoutClass: result.layoutClass,
        regions: result.regions,
      })
      .onConflictDoUpdate({
        target: cardImageMaskCache.cardId,
        set: {
          rawImageUrl: imageUrl,
          maskedImagePath: filename,
          maskVersion: CURRENT_MASK_VERSION,
          layoutClass: result.layoutClass,
          regions: result.regions,
          updatedAt: new Date(),
        },
      });

    console.log(`[MaskingService] Generated masked image for card ${cardId}`, {
      ocrApplied: result.ocrApplied,
      ocrMatches: result.ocrMatches,
      source: result.source,
      maskVersion: CURRENT_MASK_VERSION,
    });

    return filename;
  } catch (error) {
    console.error(`[MaskingService] Failed to mask card ${cardId}:`, error);
    return null;
  } finally {
    activeMaskingJobs--;
  }
}

export async function preMaskCards(cardIds: string[]): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  
  const batchSize = MAX_CONCURRENT_OCR;
  for (let i = 0; i < cardIds.length; i += batchSize) {
    const batch = cardIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (cardId) => {
        const imagePath = await getMaskedImagePath(cardId);
        return { cardId, path: imagePath };
      })
    );
    
    for (const { cardId, path: imagePath } of batchResults) {
      results.set(cardId, imagePath);
    }
  }
  
  return results;
}

export function getMaskedImageUrl(cardId: string, _maskedPath?: string): string {
  return maskedCardImageUrl(cardId);
}

async function quarantineUncoveredName(cardId: string, reason: string): Promise<void> {
  try {
    await db
      .update(playableCards)
      .set({
        isPlayable: false,
        blockedReason: "mask_name_uncovered",
        imageReviewStatus: "flagged",
        quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
        lastValidationReason: reason.slice(0, 240),
        updatedAt: new Date(),
      })
      .where(eq(playableCards.id, cardId));
  } catch (error) {
    console.error(`[MaskingService] Failed to quarantine uncovered name for ${cardId}:`, error);
  }
}

export function getMaskedCardsDir(): string {
  return MASKED_CARDS_DIR;
}

export async function invalidateMaskedImageCache(opts: {
  setId?: string;
  cardIds?: string[];
  all?: boolean;
} = {}): Promise<{ deletedRows: number; deletedFiles: number; cardIds: string[] }> {
  await ensureDirectory();

  let cardIds = opts.cardIds ? [...opts.cardIds] : [];
  if (opts.setId) {
    const rows = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, opts.setId));
    cardIds.push(...rows.map((row) => row.id));
  }

  cardIds = [...new Set(cardIds.filter(Boolean))];

  let cacheRows: { cardId: string; maskedImagePath: string }[] = [];
  if (opts.all) {
    cacheRows = await db.select({
      cardId: cardImageMaskCache.cardId,
      maskedImagePath: cardImageMaskCache.maskedImagePath,
    }).from(cardImageMaskCache);
  } else if (cardIds.length > 0) {
    cacheRows = await db
      .select({
        cardId: cardImageMaskCache.cardId,
        maskedImagePath: cardImageMaskCache.maskedImagePath,
      })
      .from(cardImageMaskCache)
      .where(inArray(cardImageMaskCache.cardId, cardIds));
  }

  let deletedFiles = 0;
  for (const row of cacheRows) {
    try {
      await fs.unlink(path.join(MASKED_CARDS_DIR, row.maskedImagePath));
      deletedFiles++;
    } catch {
      // already gone
    }
    try {
      await fs.unlink(path.join(MASKED_CARDS_DIR, row.maskedImagePath.replace(/\.jpe?g$/i, ".json")));
    } catch {
      // plan sidecar already gone
    }
  }

  if (opts.all) {
    await db.delete(cardImageMaskCache);
  } else if (cacheRows.length > 0) {
    await db.delete(cardImageMaskCache).where(
      inArray(cardImageMaskCache.cardId, cacheRows.map((row) => row.cardId)),
    );
  }

  return {
    deletedRows: cacheRows.length,
    deletedFiles,
    cardIds: cacheRows.map((row) => row.cardId),
  };
}
