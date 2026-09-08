/**
 * Load a published user set and render its maker-share PNG from live rows.
 * Surface A: POST /api/sets/create only. Per-card cream silhouette if mask fails.
 */
import sharp from "sharp";
import { db } from "../db";
import { cardPhotos, gameSets, playableCards } from "@shared/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { getMaskConfig } from "../services/maskConfig";
import {
  generateMakerShare,
  parseCardPhotoId,
  redactCardForShare,
  type MakerCardSlot,
  type MakerShareInput,
} from "./generateMakerShare";
import { isMakerShareRasterFormat } from "./makerShareAssets";
import { MAKER_SHARE_MAX_STACK, MAKER_SHARE_VOLUME_GATE } from "./makerShareSlug";
import type { ScoreCardOutput } from "./generateScoreCard";

export interface PublishedSetShareSource {
  setId: string;
  setName: string;
  makerNote: string | null;
  cardCount: number;
  date: string;
  createdByUserId: string | null;
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

/** /make identify stores JPEG/WebP (HEIC normalized client-side). Anything else is a cream slot. */
async function isMakerSharePhotoBuffer(buf: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buf, { failOn: "none" }).metadata();
    return isMakerShareRasterFormat(meta.format);
  } catch {
    return false;
  }
}

export async function loadPublishedSetShareSource(setId: string): Promise<PublishedSetShareSource | null> {
  const [set] = await db.select({
    id: gameSets.id,
    setName: gameSets.setName,
    makerNote: gameSets.makerNote,
    createdAt: gameSets.createdAt,
    isUserCreated: gameSets.isUserCreated,
    createdByUserId: gameSets.createdByUserId,
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
    createdByUserId: set.createdByUserId,
  };
}

export async function loadMakerCardSlots(setId: string): Promise<MakerCardSlot[]> {
  const cards = await db.select({
    imageUrl: playableCards.imageUrl,
    set: playableCards.set,
  }).from(playableCards)
    .where(and(eq(playableCards.gameSetId, setId), eq(playableCards.isPlayable, true)))
    .orderBy(asc(playableCards.createdAt))
    .limit(MAKER_SHARE_MAX_STACK);

  const slots: MakerCardSlot[] = [];
  for (const card of cards) {
    try {
      const raw = await loadPhotoBuffer(card.imageUrl);
      if (!raw || !(await isMakerSharePhotoBuffer(raw))) {
        slots.push(null);
        continue;
      }
      const brandKey = (card.set || "").trim();
      const mask = brandKey ? await getMaskConfig(brandKey) : null;
      slots.push(await redactCardForShare(raw, mask?.regions ?? []));
    } catch {
      slots.push(null);
    }
  }
  return slots;
}

export async function countNonStaffPublishedSets(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM game_sets gs
    LEFT JOIN users u ON u.id = gs.created_by_user_id
    WHERE gs.is_user_created = true
      AND COALESCE(u.is_admin, false) = false
  `);
  return Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

export async function countMakerPublishedSets(userId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM game_sets
    WHERE is_user_created = true
      AND created_by_user_id = ${userId}
  `);
  return Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

export async function generateMakerShareFromSet(
  setId: string,
  assetId: string,
  opts: { userId?: string } = {},
): Promise<ScoreCardOutput | null> {
  const source = await loadPublishedSetShareSource(setId);
  if (!source) return null;
  const cardSlots = await loadMakerCardSlots(setId);

  let setsMade: number | null = null;
  const nonStaff = await countNonStaffPublishedSets();
  if (nonStaff >= MAKER_SHARE_VOLUME_GATE) {
    const makerId = opts.userId || source.createdByUserId;
    if (makerId) {
      setsMade = await countMakerPublishedSets(makerId);
    }
  }

  const input: MakerShareInput = {
    setName: source.setName,
    makerNote: source.makerNote,
    cardCount: source.cardCount,
    date: source.date,
    setId: source.setId,
    setsMade,
    cardSlots,
  };
  return generateMakerShare(input, assetId);
}
