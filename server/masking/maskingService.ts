import fs from "fs/promises";
import path from "path";
import { db } from "../db";
import { cardImageMaskCache, baseballCards, playableCards } from "@shared/schema";
import { eq } from "drizzle-orm";
import { maskCardImage, CURRENT_MASK_VERSION } from "./maskCardImage";

const MASKED_CARDS_DIR = path.join(process.cwd(), "data", "masked-cards");

const maskingQueue: Map<string, Promise<string | null>> = new Map();
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

export async function getMaskedImagePath(cardId: string): Promise<string | null> {
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
  let setName: string | null = null;

  const [baseballCard] = await db
    .select()
    .from(baseballCards)
    .where(eq(baseballCards.id, cardId))
    .limit(1);

  if (baseballCard?.imageUrl) {
    imageUrl = baseballCard.imageUrl;
    playerName = baseballCard.playerName;
    setName = baseballCard.setName;
  } else {
    const [playableCard] = await db
      .select()
      .from(playableCards)
      .where(eq(playableCards.id, cardId))
      .limit(1);

    if (playableCard?.imageUrl) {
      imageUrl = playableCard.imageUrl;
      playerName = playableCard.player;
      setName = playableCard.set;
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
      setName || null
    );

    const filename = `${cardId}_${CURRENT_MASK_VERSION}.jpg`;
    const filePath = path.join(MASKED_CARDS_DIR, filename);
    
    await fs.writeFile(filePath, result.maskedBuffer);

    await db
      .insert(cardImageMaskCache)
      .values({
        cardId,
        rawImageUrl: imageUrl,
        maskedImagePath: filename,
        maskVersion: CURRENT_MASK_VERSION,
      })
      .onConflictDoUpdate({
        target: cardImageMaskCache.cardId,
        set: {
          rawImageUrl: imageUrl,
          maskedImagePath: filename,
          maskVersion: CURRENT_MASK_VERSION,
          updatedAt: new Date(),
        },
      });

    console.log(`[MaskingService] Generated masked image for card ${cardId}`, {
      ocrApplied: result.ocrApplied,
      ocrMatches: result.ocrMatches,
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
        const path = await getMaskedImagePath(cardId);
        return { cardId, path };
      })
    );
    
    for (const { cardId, path } of batchResults) {
      results.set(cardId, path);
    }
  }
  
  return results;
}

export function getMaskedImageUrl(cardId: string, maskedPath: string): string {
  return `/api/cards/${cardId}/masked-image`;
}
