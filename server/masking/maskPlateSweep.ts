/**
 * Re-evaluate name-plate coverage for playable cards in active integrated sets.
 * Pure report helpers live here so tests do not spawn a process.
 * 1989 Fleer Basketball is a 168-card checklist.
 */
import sharp from "sharp";
import { maskCardImage } from "./maskCardImage";
import { NAME_VISIBLE_OUTSIDE_MASK, verifyNameVisibleOutsideMask } from "./nameOutsideMask";

export const FLEER_1989_BASKETBALL_CARDS = 168;

/** Relative gap from the set median that flags a scan as a tight or odd crop. */
export const ASPECT_OUTLIER_RATIO = 0.08;
export const SIZE_OUTLIER_RATIO = 0.12;

export interface SweepCardResult {
  id: string;
  width: number;
  height: number;
  pass: boolean;
  reason: string | null;
}

export interface SweepOutlier {
  id: string;
  width: number;
  height: number;
  aspect: number;
  medianAspect: number;
  medianWidth: number;
  medianHeight: number;
}

export interface SweepSetReport {
  setId: string;
  setName: string;
  cardCount: number;
  pass: number;
  fail: number;
  /** Cards whose surname was read outside the mask band. */
  nameVisibleOutsideMask: number;
  outliers: SweepOutlier[];
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function flagDimensionOutliers(cards: SweepCardResult[]): SweepOutlier[] {
  const usable = cards.filter((card) => card.width > 0 && card.height > 0);
  if (usable.length < 2) return [];
  const medianWidth = median(usable.map((card) => card.width));
  const medianHeight = median(usable.map((card) => card.height));
  const medianAspect = median(usable.map((card) => card.width / card.height));
  const outliers: SweepOutlier[] = [];
  for (const card of usable) {
    const aspect = card.width / card.height;
    const aspectGap = medianAspect > 0 ? Math.abs(aspect - medianAspect) / medianAspect : 0;
    const widthGap = medianWidth > 0 ? Math.abs(card.width - medianWidth) / medianWidth : 0;
    const heightGap = medianHeight > 0 ? Math.abs(card.height - medianHeight) / medianHeight : 0;
    if (aspectGap <= ASPECT_OUTLIER_RATIO && widthGap <= SIZE_OUTLIER_RATIO && heightGap <= SIZE_OUTLIER_RATIO) {
      continue;
    }
    outliers.push({
      id: card.id,
      width: card.width,
      height: card.height,
      aspect,
      medianAspect,
      medianWidth,
      medianHeight,
    });
  }
  return outliers;
}

export function reportMaskSweep(sets: Array<{
  setId: string;
  setName: string;
  cards: SweepCardResult[];
}>): SweepSetReport[] {
  return sets.map((set) => {
    const pass = set.cards.filter((card) => card.pass).length;
    return {
      setId: set.setId,
      setName: set.setName,
      cardCount: set.cards.length,
      pass,
      fail: set.cards.length - pass,
      nameVisibleOutsideMask: set.cards.filter((card) => card.reason === NAME_VISIBLE_OUTSIDE_MASK).length,
      outliers: flagDimensionOutliers(set.cards),
    };
  });
}

/** In-memory bake plus the post-bake name check. Does not write a cache file. */
export async function evaluateCardBuffer(input: {
  id: string;
  buffer: Buffer;
  playerName: string;
  setHint: string | null;
  gameSetId?: string | null;
}): Promise<SweepCardResult> {
  try {
    const meta = await sharp(input.buffer).metadata();
    const result = await maskCardImage(input.buffer, input.playerName, input.setHint, {
      skipOcr: true,
      gameSetId: input.gameSetId,
    });
    if (!result.coverageOk) {
      return {
        id: input.id,
        width: meta.width || 0,
        height: meta.height || 0,
        pass: false,
        reason: result.coverageReason,
      };
    }
    const outside = await verifyNameVisibleOutsideMask({
      buffer: result.maskedBuffer,
      playerName: input.playerName,
      regions: result.regions,
      imageWidth: meta.width || undefined,
      imageHeight: meta.height || undefined,
    });
    if (outside.skipped) {
      return {
        id: input.id,
        width: meta.width || 0,
        height: meta.height || 0,
        pass: false,
        reason: "name_check_incomplete",
      };
    }
    return {
      id: input.id,
      width: meta.width || 0,
      height: meta.height || 0,
      pass: outside.ok,
      reason: outside.reason,
    };
  } catch {
    return {
      id: input.id,
      width: 0,
      height: 0,
      pass: false,
      reason: "mask_evaluate_failed",
    };
  }
}
