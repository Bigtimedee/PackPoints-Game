/**
 * Load a published user set and render its maker-share PNG from live rows.
 * Honesty: card photos, set name, mixtape, and count come from the set — never invented.
 */
import { db } from "../db";
import { cardPhotos, gameSets, playableCards } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { getMaskConfig } from "../services/maskConfig";
import {
  generateMakerShare,
  parseCardPhotoId,
  redactCardForShare,
  type MakerShareInput,
} from "./generateMakerShare";
import type { ScoreCardOutput } from "./generateScoreCard";

export interface PublishedSetShareSource {
  setId: string;
  setName: string;
  makerNote: string | null;
  cardCount: number;
  date: string;
}

async function loadPhotoBuffer(imageUrl: string | null): Promise<Buffer | null> {
  const photoId = parseCardPhotoId(imageUrl);
  if (!photoId) return null;
  const [photo] = await db.select({ data: cardPhotos.data })
    .from(cardPhotos)
    .where(eq(cardPhotos.id, photoId))
    .limit(1);
  return photo?.data ?? null;
}

export async function loadPublishedSetShareSource(setId: string): Promise<PublishedSetShareSource | null> {
  const [set] = await db.select({
    id: gameSets.id,
    setName: gameSets.setName,
    makerNote: gameSets.makerNote,
    createdAt: gameSets.createdAt,
    isUserCreated: gameSets.isUserCreated,
  }).from(gameSets).where(eq(gameSets.id, setId)).limit(1);

  if (!set || !set.isUserCreated) return null;

  const cards = await db.select({ id: playableCards.id })
    .from(playableCards)
    .where(and(eq(playableCards.gameSetId, setId), eq(playableCards.isPlayable, true)));

  return {
    setId: set.id,
    setName: set.setName,
    makerNote: set.makerNote,
    cardCount: cards.length,
    date: (set.createdAt ?? new Date()).toISOString().slice(0, 10),
  };
}

export async function loadMaskedCardBuffersForSet(setId: string, limit = 5): Promise<Buffer[]> {
  const cards = await db.select({
    imageUrl: playableCards.imageUrl,
    set: playableCards.set,
  }).from(playableCards)
    .where(and(eq(playableCards.gameSetId, setId), eq(playableCards.isPlayable, true)))
    .orderBy(asc(playableCards.createdAt))
    .limit(20);

  const out: Buffer[] = [];
  for (const card of cards) {
    if (out.length >= limit) break;
    const raw = await loadPhotoBuffer(card.imageUrl);
    if (!raw) continue;
    const brandKey = (card.set || "").trim();
    const mask = brandKey ? await getMaskConfig(brandKey) : null;
    const redacted = await redactCardForShare(raw, mask?.regions ?? []);
    out.push(redacted);
  }
  return out;
}

export async function generateMakerShareFromSet(
  setId: string,
  assetId: string,
): Promise<ScoreCardOutput | null> {
  const source = await loadPublishedSetShareSource(setId);
  if (!source) return null;
  const cardImages = await loadMaskedCardBuffersForSet(setId);
  const input: MakerShareInput = {
    setName: source.setName,
    makerNote: source.makerNote,
    cardCount: source.cardCount,
    date: source.date,
    cardImages,
  };
  return generateMakerShare(input, assetId);
}
