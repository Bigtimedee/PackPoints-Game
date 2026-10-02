/**
 * Persist a v4.6 bake refusal. A database error is logged and swallowed so the
 * bake still fail-closes. List reads never select the source bytes.
 */
import sharp from "sharp";
import { and, count, desc, eq } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import type { MaskPlateBox, MaskRefusalCandidate, MaskRefusalOcrBox } from "@shared/maskRefusal";
import { maskBakeRefusals, type MaskRegion } from "@shared/schema";
import { db } from "../db";
import type { NamePlateTrace } from "./nameLocalization";

export interface MaskRefusalRecord {
  id: string;
  cardId: string;
  setId: string | null;
  reason: string;
  layoutClass: string | null;
  profileSource: string | null;
  expectedPlate: MaskPlateBox | null;
  ocrBoxes: MaskRefusalOcrBox[];
  candidates: MaskRefusalCandidate[];
  maskVersion: string;
  createdAt: string;
  imageWidth: number | null;
  imageHeight: number | null;
  debugPath: string;
  sourcePath: string;
  attemptPath: string;
}

export async function recordMaskBakeRefusal(input: {
  cardId: string;
  gameSetId: string | null;
  reason: string;
  layoutClass: string | null;
  profileSource: string | null;
  plateTrace: NamePlateTrace | null;
  paintRegions: MaskRegion[];
  sourceImage: Buffer | null;
}): Promise<boolean> {
  try {
    let contentType: string | null = null;
    let imageWidth = input.plateTrace?.imageWidth ?? null;
    let imageHeight = input.plateTrace?.imageHeight ?? null;
    if (input.sourceImage && input.sourceImage.length > 0) {
      try {
        const meta = await sharp(input.sourceImage).metadata();
        imageWidth = meta.width ?? imageWidth;
        imageHeight = meta.height ?? imageHeight;
        contentType = meta.format === "png"
          ? "image/png"
          : meta.format === "webp"
            ? "image/webp"
            : "image/jpeg";
      } catch {
        contentType = "application/octet-stream";
      }
    }
    await db.insert(maskBakeRefusals).values({
      cardId: input.cardId,
      gameSetId: input.gameSetId,
      reason: input.reason.slice(0, 240),
      layoutClass: input.layoutClass,
      profileSource: input.profileSource,
      expectedPlate: input.plateTrace?.expectedPlate ?? null,
      ocrBoxes: input.plateTrace?.ocrBoxes ?? [],
      candidates: input.plateTrace?.candidates ?? [],
      paintRegions: input.paintRegions,
      maskVersion: CURRENT_MASK_VERSION,
      sourceImage: input.sourceImage,
      contentType,
      imageWidth,
      imageHeight,
    });
    return true;
  } catch (error) {
    console.error(`[MaskRefusal] Failed to persist refusal for ${input.cardId}:`, error);
    return false;
  }
}

function asPlate(value: unknown): MaskPlateBox | null {
  if (!value || typeof value !== "object") return null;
  const box = value as MaskPlateBox;
  if (![box.x, box.y, box.w, box.h].every((n) => typeof n === "number")) return null;
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

function toRecord(row: {
  id: string;
  cardId: string;
  gameSetId: string | null;
  reason: string;
  layoutClass: string | null;
  profileSource: string | null;
  expectedPlate: MaskPlateBox | null;
  ocrBoxes: MaskRefusalOcrBox[];
  candidates: MaskRefusalCandidate[];
  maskVersion: string;
  createdAt: Date;
  imageWidth: number | null;
  imageHeight: number | null;
}): MaskRefusalRecord {
  return {
    id: row.id,
    cardId: row.cardId,
    setId: row.gameSetId,
    reason: row.reason,
    layoutClass: row.layoutClass,
    profileSource: row.profileSource,
    expectedPlate: asPlate(row.expectedPlate),
    ocrBoxes: Array.isArray(row.ocrBoxes) ? row.ocrBoxes : [],
    candidates: Array.isArray(row.candidates) ? row.candidates : [],
    maskVersion: row.maskVersion,
    createdAt: row.createdAt.toISOString(),
    imageWidth: row.imageWidth,
    imageHeight: row.imageHeight,
    debugPath: `/api/qa/rejected-cards/${row.cardId}/debug.png`,
    sourcePath: `/api/qa/rejected-cards/${row.cardId}/source`,
    attemptPath: `/api/qa/rejected-cards/${row.cardId}/attempt.png`,
  };
}

const listColumns = {
  id: maskBakeRefusals.id,
  cardId: maskBakeRefusals.cardId,
  gameSetId: maskBakeRefusals.gameSetId,
  reason: maskBakeRefusals.reason,
  layoutClass: maskBakeRefusals.layoutClass,
  profileSource: maskBakeRefusals.profileSource,
  expectedPlate: maskBakeRefusals.expectedPlate,
  ocrBoxes: maskBakeRefusals.ocrBoxes,
  candidates: maskBakeRefusals.candidates,
  maskVersion: maskBakeRefusals.maskVersion,
  createdAt: maskBakeRefusals.createdAt,
  imageWidth: maskBakeRefusals.imageWidth,
  imageHeight: maskBakeRefusals.imageHeight,
};

export async function listMaskBakeRefusals(
  setId: string | null,
  offset: number,
  limit: number,
): Promise<{ total: number; refusals: MaskRefusalRecord[] }> {
  const where = setId ? eq(maskBakeRefusals.gameSetId, setId) : undefined;
  const [totals] = await db
    .select({ total: count() })
    .from(maskBakeRefusals)
    .where(where);
  const rows = await db
    .select(listColumns)
    .from(maskBakeRefusals)
    .where(where)
    .orderBy(desc(maskBakeRefusals.createdAt), desc(maskBakeRefusals.id))
    .offset(offset)
    .limit(limit);
  return {
    total: Number(totals?.total) || 0,
    refusals: rows.map(toRecord),
  };
}

export interface StoredRefusalImage {
  cardId: string;
  contentType: string;
  sourceImage: Buffer;
  expectedPlate: MaskPlateBox | null;
  ocrBoxes: MaskRefusalOcrBox[];
  candidates: MaskRefusalCandidate[];
  paintRegions: MaskRegion[];
  imageWidth: number | null;
  imageHeight: number | null;
}

/** Latest refusal for this card, including the upright source. Null when none was stored. */
export async function latestMaskBakeRefusalImage(cardId: string): Promise<StoredRefusalImage | null> {
  if (!cardId || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..")) return null;
  const [row] = await db
    .select({
      cardId: maskBakeRefusals.cardId,
      contentType: maskBakeRefusals.contentType,
      sourceImage: maskBakeRefusals.sourceImage,
      expectedPlate: maskBakeRefusals.expectedPlate,
      ocrBoxes: maskBakeRefusals.ocrBoxes,
      candidates: maskBakeRefusals.candidates,
      paintRegions: maskBakeRefusals.paintRegions,
      imageWidth: maskBakeRefusals.imageWidth,
      imageHeight: maskBakeRefusals.imageHeight,
    })
    .from(maskBakeRefusals)
    .where(and(eq(maskBakeRefusals.cardId, cardId)))
    .orderBy(desc(maskBakeRefusals.createdAt), desc(maskBakeRefusals.id))
    .limit(1);
  if (!row?.sourceImage || row.sourceImage.length === 0) return null;
  return {
    cardId: row.cardId,
    contentType: row.contentType || "application/octet-stream",
    sourceImage: row.sourceImage,
    expectedPlate: asPlate(row.expectedPlate),
    ocrBoxes: Array.isArray(row.ocrBoxes) ? row.ocrBoxes : [],
    candidates: Array.isArray(row.candidates) ? row.candidates : [],
    paintRegions: Array.isArray(row.paintRegions) ? row.paintRegions : [],
    imageWidth: row.imageWidth,
    imageHeight: row.imageHeight,
  };
}
