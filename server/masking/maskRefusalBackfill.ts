/**
 * Dry-run the v4.6 resolver for cards that were already refused.
 * Writes mask_bake_refusals only. Does not paint a mask, write a sidecar,
 * or change playability.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { gameSets, maskBakeRefusals, playableCards, type MaskRegion } from "@shared/schema";
import { db } from "../db";
import { PINNED_SET_COVERS } from "../config/pinnedCovers";
import { MASK_DEAL_BLOCK_REASONS, isMaskDealBlockReason } from "./maskDealRefusal";
import { maskBandFailure, maskBandGuardEnforces } from "./maskBandLimit";
import { maskCardImage } from "./maskCardImage";
import { currentMaskRefusalIds, readMaskFailureReason } from "./maskReadySidecar";
import { recordMaskBakeRefusal } from "./maskRefusalLog";
import { downloadMaskSource, isMaskBakeTimeout, ocrSkipped, runWarmBakeJob } from "./maskingService";
import type { NamePlateTrace } from "./nameLocalization";

export const RESOLVES_NOW_REASON = "resolves_now";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface RefusalBackfillCard {
  id: string;
  gameSetId: string;
  player: string | null;
  imageUrl: string | null;
  imageRotation: number;
  blockedReason: string | null;
  setName: string;
}

export interface RefusalDryRunResult {
  coverageOk: boolean;
  coverageReason: string | null;
  layoutClass: "TOP_PLATE" | "BOTTOM_PLAQUE" | "PSA_SLAB" | "UNKNOWN";
  source: "ocr+profile" | "profile" | "ocr" | "default";
  regions: MaskRegion[];
  plateTrace: NamePlateTrace;
  sourceBuffer: Buffer;
}

export interface RefusalBackfillCounts {
  scanned: number;
  inserted: number;
  skipped: number;
  errors: number;
  remaining: number;
}

type SourceLoader = (card: RefusalBackfillCard) => Promise<Buffer | null>;
type DryRunner = (card: RefusalBackfillCard, source: Buffer) => Promise<RefusalDryRunResult>;

let sourceLoaderOverride: SourceLoader | null = null;
let dryRunOverride: DryRunner | null = null;

export function setRefusalBackfillHooksForTests(hooks: {
  loadSource?: SourceLoader | null;
  dryRun?: DryRunner | null;
} | null): void {
  sourceLoaderOverride = hooks?.loadSource ?? null;
  dryRunOverride = hooks?.dryRun ?? null;
}

export function backfillLimit(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

/** Same refuse reasons as a live bake. A pass is stored as resolves_now and does not clear the card. */
export function backfillRefusalReason(result: {
  coverageOk: boolean;
  coverageReason: string | null;
  regions: MaskRegion[];
}): string {
  if (!result.coverageOk) return (result.coverageReason || "mask_name_uncovered").slice(0, 240);
  const band = maskBandFailure(result.regions);
  if (band && maskBandGuardEnforces()) return band;
  return RESOLVES_NOW_REASON;
}

function pinnedStarRank(): Map<string, number> {
  const rank = new Map<string, number>();
  for (const list of Object.values(PINNED_SET_COVERS)) {
    for (const id of [...list.picks, ...list.alternates]) {
      if (!rank.has(id)) rank.set(id, rank.size);
    }
  }
  return rank;
}

export function sortBackfillCards<T extends { id: string }>(cards: T[]): T[] {
  const rank = pinnedStarRank();
  const tail = rank.size;
  return cards.slice().sort((a, b) => {
    const delta = (rank.get(a.id) ?? tail) - (rank.get(b.id) ?? tail);
    if (delta !== 0) return delta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

async function recordedCardIds(cardIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (cardIds.length === 0) return found;
  const rows = await db
    .select({ cardId: maskBakeRefusals.cardId })
    .from(maskBakeRefusals)
    .where(and(
      inArray(maskBakeRefusals.cardId, cardIds),
      eq(maskBakeRefusals.maskVersion, CURRENT_MASK_VERSION),
    ));
  for (const row of rows) found.add(row.cardId);
  return found;
}

async function refusalCandidates(setId: string | null): Promise<RefusalBackfillCard[]> {
  const sidecarIds = [...currentMaskRefusalIds()];
  const reasonMatch = inArray(playableCards.blockedReason, [...MASK_DEAL_BLOCK_REASONS]);
  const refused = sidecarIds.length > 0
    ? or(reasonMatch, inArray(playableCards.id, sidecarIds))
    : reasonMatch;
  const filters = [
    eq(gameSets.isActive, true),
    eq(gameSets.isUserCreated, false),
    refused,
  ];
  if (setId) filters.push(eq(playableCards.gameSetId, setId));
  const rows = await db
    .select({
      id: playableCards.id,
      gameSetId: playableCards.gameSetId,
      player: playableCards.player,
      imageUrl: playableCards.imageUrl,
      imageRotation: playableCards.imageRotation,
      blockedReason: playableCards.blockedReason,
      setName: gameSets.setName,
    })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(and(...filters));
  return rows.filter((row) => {
    const sidecar = readMaskFailureReason(row.id);
    return Boolean(sidecar) || isMaskDealBlockReason(row.blockedReason);
  });
}

async function dryRunCard(card: RefusalBackfillCard): Promise<RefusalDryRunResult | null> {
  return runWarmBakeJob(card.id, async (setStage) => {
    setStage("fetch");
    const source = sourceLoaderOverride
      ? await sourceLoaderOverride(card)
      : card.imageUrl
        ? await downloadMaskSource(card.imageUrl, card.id)
        : null;
    if (!source || source.length === 0) return null;
    if (dryRunOverride) return dryRunOverride(card, source);
    setStage("ocr");
    const result = await maskCardImage(source, card.player ?? "", card.setName, {
      gameSetId: card.gameSetId,
      imageRotation: card.imageRotation,
      cardId: card.id,
      recordOrientNote: false,
      skipOcr: ocrSkipped(card.id),
      onStage: (stage) => setStage(stage),
    });
    return result;
  });
}

export async function backfillMaskBakeRefusals(
  setId: string | null,
  limit: number,
): Promise<RefusalBackfillCounts> {
  const candidates = sortBackfillCards(await refusalCandidates(setId));
  const already = await recordedCardIds(candidates.map((card) => card.id));
  const todo = candidates.filter((card) => !already.has(card.id));
  const batch = todo.slice(0, limit);
  let inserted = 0;
  let errors = 0;

  for (const card of batch) {
    if ((await recordedCardIds([card.id])).has(card.id)) {
      already.add(card.id);
      continue;
    }
    try {
      const result = await dryRunCard(card);
      if (!result) {
        errors += 1;
        continue;
      }
      const wrote = await recordMaskBakeRefusal({
        cardId: card.id,
        gameSetId: card.gameSetId,
        reason: backfillRefusalReason(result),
        layoutClass: result.layoutClass,
        profileSource: result.source,
        plateTrace: result.plateTrace,
        paintRegions: result.regions,
        sourceImage: result.sourceBuffer,
      });
      if (wrote) inserted += 1;
      else errors += 1;
    } catch (error) {
      errors += 1;
      if (!isMaskBakeTimeout(error)) {
        console.error(`[MaskRefusal] backfill failed for ${card.id}:`, error);
      }
    }
  }

  const skipped = candidates.filter((card) => already.has(card.id)).length;
  return {
    scanned: batch.length,
    inserted,
    skipped,
    errors,
    remaining: Math.max(0, todo.length - inserted),
  };
}
