/**
 * Re-evaluate name-plate coverage for playable cards in active integrated sets.
 * Pure report helpers live here so tests do not spawn a process.
 * 1989 Fleer Basketball is a 168-card checklist.
 */
import sharp from "sharp";
import { maskCardImage } from "./maskCardImage";
import { NAME_VISIBLE_OUTSIDE_MASK, verifyNameVisibleOutsideMask } from "./nameOutsideMask";

export interface ExpectedLeakPair {
  cardId: string;
  leak: boolean;
}

export interface ExpectedLeakComparison {
  cardId: string;
  expectedLeak: boolean;
  actualLeak: boolean;
  reason: string | null;
  match: boolean;
}

/** JSON array of `{ cardId, leak }` pairs. `leak` is the outside-mask surname check only. */
export function parseExpectedLeaks(raw: string): ExpectedLeakPair[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("expected leak list must be a JSON array of { cardId, leak }");
  }
  return parsed.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new Error(`expected leak row ${index} is not an object`);
    }
    const record = row as { cardId?: unknown; leak?: unknown };
    const cardId = typeof record.cardId === "string" ? record.cardId.trim() : "";
    if (!cardId) throw new Error(`expected leak row ${index} is missing cardId`);
    if (typeof record.leak !== "boolean") {
      throw new Error(`expected leak row ${index} leak must be true or false`);
    }
    return { cardId, leak: record.leak };
  });
}

/**
 * Compare expected outside-mask leaks with sweep results.
 * `actualLeak` is true only when the reason is `name_visible_outside_mask`.
 * A missing card is `card_not_found` and does not match.
 */
export function compareExpectedLeaks(
  pairs: ExpectedLeakPair[],
  results: Array<Pick<SweepCardResult, "id" | "reason">>,
): ExpectedLeakComparison[] {
  const byId = new Map(results.map((row) => [row.id, row]));
  return pairs.map((pair) => {
    const found = byId.get(pair.cardId);
    if (!found) {
      return {
        cardId: pair.cardId,
        expectedLeak: pair.leak,
        actualLeak: false,
        reason: "card_not_found",
        match: false,
      };
    }
    const actualLeak = found.reason === NAME_VISIBLE_OUTSIDE_MASK;
    return {
      cardId: pair.cardId,
      expectedLeak: pair.leak,
      actualLeak,
      reason: found.reason,
      match: actualLeak === pair.leak,
    };
  });
}

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
  /** Surname plate was not the set profile's plate. */
  layoutDisagreed?: boolean;
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
  /** Cards whose detected name plate was not the set profile's plate. */
  layoutDisagreed: number;
  /** Fail counts keyed by reason, including surname leaks and plate misses. */
  exclusionsByReason: Record<string, number>;
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
    const exclusionsByReason: Record<string, number> = {};
    for (const card of set.cards) {
      if (card.pass || !card.reason) continue;
      exclusionsByReason[card.reason] = (exclusionsByReason[card.reason] || 0) + 1;
    }
    return {
      setId: set.setId,
      setName: set.setName,
      cardCount: set.cards.length,
      pass,
      fail: set.cards.length - pass,
      nameVisibleOutsideMask: set.cards.filter((card) => card.reason === NAME_VISIBLE_OUTSIDE_MASK).length,
      layoutDisagreed: set.cards.filter((card) => card.layoutDisagreed).length,
      exclusionsByReason,
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
      gameSetId: input.gameSetId,
    });
    if (!result.coverageOk) {
      return {
        id: input.id,
        width: meta.width || 0,
        height: meta.height || 0,
        pass: false,
        reason: result.coverageReason,
        layoutDisagreed: result.layoutDisagreed,
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
        layoutDisagreed: result.layoutDisagreed,
      };
    }
    return {
      id: input.id,
      width: meta.width || 0,
      height: meta.height || 0,
      pass: outside.ok,
      reason: outside.reason,
      layoutDisagreed: result.layoutDisagreed,
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
