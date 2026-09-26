/**
 * Layout-aware mask-band guard.
 *
 * Placement is the edge the baker painted on this card, not the set profile.
 * A full-width band (width at least 90%) that starts within
 * MASK_BAND_EDGE_TOLERANCE_PCT of the top is a top plate (limit 35% of height).
 * One that ends within that same window of the bottom is a bottom plaque
 * (limit 55%). A band that touches neither edge is misplaced.
 *
 * The tolerance is 3 percentage points. `fitNamePlateBand` pads by at least
 * 2.5% of height and snaps a plate already within 4% of the card edge onto
 * that edge, so a real bake sits at 0% or 100%. Three points keeps that padded
 * edge and rejects a band that ends 4 points short, such as a band that starts
 * 19% down and runs 77% (it ends at 96%).
 *
 * MASK_BAND_GUARD=report (default) only logs. MASK_BAND_GUARD=enforce excludes.
 * The player-name blocklist is not behind this flag.
 * Plans are `{cardId}_${CURRENT_MASK_VERSION}.json` (v4.6). A leftover v4.5
 * plan is not read. A card masked at the top and the bottom is two full-width
 * bands. Each band is checked against the edge it touches.
 * No image is re-encoded.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { warmMaskPlanFilename } from "./maskPlanStore";
import {
  invalidateMaskReadySidecar,
  maskFailureSidecarFilename,
  maskReadySidecarDir,
  readMaskFailureReason,
  writeMaskFailureSidecar,
} from "./maskReadySidecar";
import { addShutdownHook } from "../startup/shutdownHooks";

/** Top-plate bands taller than this percent of the card fail closed. 35 stays. */
export const MAX_TOP_BAND_PCT = 35;

/** Bottom-plaque bands taller than this percent of the card fail closed. 55 stays. */
export const MAX_BOTTOM_BAND_PCT = 55;

/**
 * Percentage points from the card edge. See the file header.
 * A top band starts at yPct <= tolerance. A bottom band ends at
 * yPct + hPct >= 100 - tolerance.
 */
export const MASK_BAND_EDGE_TOLERANCE_PCT = 3;

export const MASK_BAND_OVERSIZED = "mask_band_oversized";
export const MASK_BAND_MISPLACED = "mask_band_misplaced";

const BAND_REASONS = new Set<string>([MASK_BAND_OVERSIZED, MASK_BAND_MISPLACED]);

/** Same full-width cutoff the coverage assert uses for a name band. */
const FULL_WIDTH_PCT = 90;

const SCAN_BATCH = 20;
const SCAN_CONCURRENCY = 4;
const SCAN_PAUSE_MS = 50;

export type BandBox = {
  yPct?: number;
  hPct?: number;
  wPct?: number;
};

export type MaskBandReason = typeof MASK_BAND_OVERSIZED | typeof MASK_BAND_MISPLACED;

export type MaskBandGuardMode = "report" | "enforce";

export interface MaskBandGuardSetLine {
  setId: string;
  setPrefix: string;
  title: string;
  eligibleNow: number;
  wouldDrop: number;
  oversized: number;
  misplaced: number;
  eligibleAfter: number;
}

const verdictCache = new Map<string, boolean>();
const persistJobs = new Map<string, Promise<void>>();

let scanStarted = false;
let scanStop = false;

export function clearMaskBandCacheForTests(): void {
  verdictCache.clear();
  persistJobs.clear();
}

/** `report` unless MASK_BAND_GUARD is exactly `enforce`. */
export function maskBandGuardMode(): MaskBandGuardMode {
  const raw = (process.env.MASK_BAND_GUARD || "report").trim().toLowerCase();
  return raw === "enforce" ? "enforce" : "report";
}

export function maskBandGuardEnforces(): boolean {
  return maskBandGuardMode() === "enforce";
}

function fullWidthBand(region: BandBox): { start: number; end: number; height: number } | null {
  const w = Number(region.wPct);
  const y = Number(region.yPct);
  const h = Number(region.hPct);
  if (!Number.isFinite(w) || w < FULL_WIDTH_PCT) return null;
  if (!Number.isFinite(y) || !Number.isFinite(h) || h <= 0) return null;
  const start = Math.max(0, Math.min(100, y));
  const end = Math.max(0, Math.min(100, y + h));
  const height = end - start;
  if (height <= 0) return null;
  return { start, end, height };
}

/**
 * One full-width band. Null when the band is within the limit for the edge
 * the baker actually painted. Narrow boxes are ignored.
 */
export function maskBandRegionFailure(region: BandBox): MaskBandReason | null {
  const band = fullWidthBand(region);
  if (!band) return null;
  const touchesTop = band.start <= MASK_BAND_EDGE_TOLERANCE_PCT;
  const touchesBottom = band.end >= 100 - MASK_BAND_EDGE_TOLERANCE_PCT;
  if (!touchesTop && !touchesBottom) return MASK_BAND_MISPLACED;
  if (touchesTop && band.height > MAX_TOP_BAND_PCT) return MASK_BAND_OVERSIZED;
  if (touchesBottom && !touchesTop && band.height > MAX_BOTTOM_BAND_PCT) return MASK_BAND_OVERSIZED;
  if (touchesTop && touchesBottom && band.height > MAX_BOTTOM_BAND_PCT) return MASK_BAND_OVERSIZED;
  return null;
}

/** Misplaced wins when any full-width band floats. Otherwise any oversized band. */
export function maskBandFailure(regions: readonly BandBox[] | null | undefined): MaskBandReason | null {
  if (!regions || regions.length === 0) return null;
  let oversized = false;
  for (const region of regions) {
    const issue = maskBandRegionFailure(region);
    if (issue === MASK_BAND_MISPLACED) return MASK_BAND_MISPLACED;
    if (issue === MASK_BAND_OVERSIZED) oversized = true;
  }
  return oversized ? MASK_BAND_OVERSIZED : null;
}

function safeCardId(cardId: string): boolean {
  return Boolean(cardId) && !cardId.includes("/") && !cardId.includes("\\") && !cardId.includes("..") && !cardId.includes("\0");
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function cacheKey(dir: string, cardId: string): string {
  const plan = path.join(dir, warmMaskPlanFilename(cardId));
  const fail = path.join(dir, maskFailureSidecarFilename(cardId));
  return `${maskBandGuardMode()}\0${dir}\0${cardId}\0${mtime(plan)}\0${mtime(fail)}`;
}

export function readPlanRegions(dir: string, cardId: string): BandBox[] | null {
  if (!safeCardId(cardId)) return null;
  const filePath = path.join(dir, warmMaskPlanFilename(cardId));
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as { regions?: unknown };
    if (!raw || !Array.isArray(raw.regions)) return null;
    const regions: BandBox[] = [];
    for (const region of raw.regions) {
      if (!region || typeof region !== "object") continue;
      const source = region as Record<string, unknown>;
      regions.push({
        yPct: Number(source.yPct),
        hPct: Number(source.hPct),
        wPct: Number(source.wPct),
      });
    }
    return regions;
  } catch {
    return null;
  }
}

function remember(dir: string, cardId: string, excluded: boolean): void {
  verdictCache.set(cacheKey(dir, cardId), excluded);
}

/**
 * Mark the card unplayable only while it is still playable, so a name-leak
 * quarantine stays `mask_name_uncovered`.
 */
export function persistMaskBand(cardId: string, reason: MaskBandReason): Promise<void> {
  const existing = persistJobs.get(cardId);
  if (existing) return existing;
  const job = (async () => {
    try {
      await db
        .update(playableCards)
        .set({
          isPlayable: false,
          blockedReason: reason,
          imageReviewStatus: "flagged",
          quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
          lastValidationReason: reason,
          updatedAt: new Date(),
        })
        .where(and(eq(playableCards.id, cardId), eq(playableCards.isPlayable, true)));
    } catch (error) {
      persistJobs.delete(cardId);
      console.error(`[MaskBand] Failed to record ${reason} for ${cardId}:`, error);
    }
  })();
  persistJobs.set(cardId, job);
  return job;
}

/** Enforce-mode refusal. Does not write the masked JPEG. No-op in report mode. */
export async function rejectMaskBand(cardId: string, reason: MaskBandReason, dir = maskReadySidecarDir()): Promise<void> {
  if (!maskBandGuardEnforces() || !safeCardId(cardId)) return;
  const existing = readMaskFailureReason(cardId, dir);
  if (existing !== "mask_name_uncovered") {
    writeMaskFailureSidecar(cardId, reason, dir);
    await persistMaskBand(cardId, reason);
  }
  invalidateMaskReadySidecar(cardId, dir);
  remember(dir, cardId, true);
}

/**
 * True only in enforce mode, when this card's baked band is oversized or misplaced.
 * Report mode returns false and writes nothing.
 * A missing plan stays false. The next bake applies the check.
 */
export function isMaskBandExcluded(cardId: string, dir = maskReadySidecarDir()): boolean {
  if (!maskBandGuardEnforces() || !safeCardId(cardId)) return false;
  const key = cacheKey(dir, cardId);
  const hit = verdictCache.get(key);
  if (hit != null) return hit;

  const marker = readMaskFailureReason(cardId, dir);
  if (marker && BAND_REASONS.has(marker)) {
    invalidateMaskReadySidecar(cardId, dir);
    void persistMaskBand(cardId, marker as MaskBandReason);
    remember(dir, cardId, true);
    return true;
  }

  const regions = readPlanRegions(dir, cardId);
  const issue = maskBandFailure(regions);
  if (!issue) {
    remember(dir, cardId, false);
    return false;
  }
  if (marker !== "mask_name_uncovered") {
    try {
      writeMaskFailureSidecar(cardId, issue, dir);
    } catch (error) {
      console.error(`[MaskBand] Failed to write fail marker for ${cardId}:`, error);
    }
    void persistMaskBand(cardId, issue);
  }
  invalidateMaskReadySidecar(cardId, dir);
  remember(dir, cardId, true);
  return true;
}

function setPrefix(setId: string): string {
  return setId.slice(0, 8);
}

function cleanTitle(title: string | null | undefined): string {
  const text = (title || "untitled").replace(/[\r\n]+/g, " ").trim();
  return text || "untitled";
}

/** One summary line. `set=all title=all` is the total. */
export function formatMaskBandGuardLine(row: {
  setPrefix: string;
  title: string;
  eligibleNow: number;
  wouldDrop: number;
  oversized: number;
  misplaced: number;
}): string {
  const eligibleAfter = row.eligibleNow - row.wouldDrop;
  return `[mask-band-guard] set=${row.setPrefix} title=${cleanTitle(row.title)} eligibleNow=${row.eligibleNow} wouldDrop=${row.wouldDrop} oversized=${row.oversized} misplaced=${row.misplaced} eligibleAfter=${eligibleAfter}`;
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

function planCardIds(dir: string): string[] {
  const suffix = `_${CURRENT_MASK_VERSION}.json`;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const cardIds: string[] = [];
  for (const name of names) {
    if (!name.endsWith(suffix)) continue;
    const cardId = name.slice(0, -suffix.length);
    if (!safeCardId(cardId)) continue;
    cardIds.push(cardId);
  }
  return cardIds;
}

/**
 * Read every baked plan for the current mask version off the request path.
 * Report mode logs and excludes nothing. Enforce mode also writes fail markers.
 */
export async function runMaskBandGuardScan(opts?: {
  dir?: string;
  batchSize?: number;
  concurrency?: number;
  pauseMs?: number;
  shouldStop?: () => boolean;
}): Promise<{ mode: MaskBandGuardMode; lines: string[] }> {
  const dir = opts?.dir ?? maskReadySidecarDir();
  const batchSize = opts?.batchSize ?? SCAN_BATCH;
  const concurrency = opts?.concurrency ?? SCAN_CONCURRENCY;
  const pauseMs = opts?.pauseMs ?? SCAN_PAUSE_MS;
  const shouldStop = opts?.shouldStop ?? (() => false);
  const mode = maskBandGuardMode();
  const cardIds = planCardIds(dir);
  const failures = new Map<string, MaskBandReason>();

  for (let i = 0; i < cardIds.length; i += batchSize) {
    if (shouldStop()) break;
    const batch = cardIds.slice(i, i + batchSize);
    await mapPool(batch, concurrency, async (cardId) => {
      const issue = maskBandFailure(readPlanRegions(dir, cardId));
      if (issue) failures.set(cardId, issue);
    });
    if (pauseMs > 0 && i + batchSize < cardIds.length && !shouldStop()) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }

  const lines = await maskBandGuardLines(cardIds, failures);
  for (const line of lines) console.log(line);

  if (mode === "enforce") {
    const failedIds = [...failures.entries()];
    for (let i = 0; i < failedIds.length; i += batchSize) {
      if (shouldStop()) break;
      const batch = failedIds.slice(i, i + batchSize);
      await mapPool(batch, concurrency, async ([cardId, reason]) => {
        await rejectMaskBand(cardId, reason, dir);
      });
      if (pauseMs > 0 && i + batchSize < failedIds.length && !shouldStop()) {
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
    }
  }

  return { mode, lines };
}

async function maskBandGuardLines(
  scannedIds: string[],
  failures: Map<string, MaskBandReason>,
): Promise<string[]> {
  const uniqueIds = [...new Set(scannedIds)];
  if (uniqueIds.length === 0) {
    return [formatMaskBandGuardLine({
      setPrefix: "all",
      title: "all",
      eligibleNow: 0,
      wouldDrop: 0,
      oversized: 0,
      misplaced: 0,
    })];
  }

  const owners = await db
    .select({
      id: playableCards.id,
      gameSetId: playableCards.gameSetId,
      setName: gameSets.setName,
    })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(inArray(playableCards.id, uniqueIds));

  const setName = new Map<string, string>();
  const cardsBySet = new Map<string, string[]>();
  for (const row of owners) {
    if (!row.gameSetId) continue;
    setName.set(row.gameSetId, row.setName || "untitled");
    const list = cardsBySet.get(row.gameSetId) ?? [];
    list.push(row.id);
    cardsBySet.set(row.gameSetId, list);
  }

  const setIds = [...cardsBySet.keys()];
  const eligibleBySet = new Map<string, Set<string>>();
  if (setIds.length > 0) {
    const { eligibleDealFilter } = await import("../services/playableSetEligibility");
    const eligible = await db
      .select({ id: playableCards.id, gameSetId: playableCards.gameSetId })
      .from(playableCards)
      .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
      .where(and(
        inArray(playableCards.gameSetId, setIds),
        eligibleDealFilter("playable_cards"),
        sql`LOWER(playable_cards.category) = LOWER(game_sets.sport)`,
      ));
    for (const row of eligible) {
      const set = eligibleBySet.get(row.gameSetId) ?? new Set<string>();
      set.add(row.id);
      eligibleBySet.set(row.gameSetId, set);
    }
  }

  const rows: MaskBandGuardSetLine[] = [];
  for (const setId of [...cardsBySet.keys()].sort()) {
    const eligible = eligibleBySet.get(setId) ?? new Set<string>();
    let oversized = 0;
    let misplaced = 0;
    for (const cardId of eligible) {
      const issue = failures.get(cardId);
      if (issue === MASK_BAND_OVERSIZED) oversized += 1;
      else if (issue === MASK_BAND_MISPLACED) misplaced += 1;
    }
    const wouldDrop = oversized + misplaced;
    const eligibleNow = eligible.size;
    rows.push({
      setId,
      setPrefix: setPrefix(setId),
      title: cleanTitle(setName.get(setId)),
      eligibleNow,
      wouldDrop,
      oversized,
      misplaced,
      eligibleAfter: eligibleNow - wouldDrop,
    });
  }

  const total = rows.reduce((sum, row) => ({
    eligibleNow: sum.eligibleNow + row.eligibleNow,
    wouldDrop: sum.wouldDrop + row.wouldDrop,
    oversized: sum.oversized + row.oversized,
    misplaced: sum.misplaced + row.misplaced,
  }), { eligibleNow: 0, wouldDrop: 0, oversized: 0, misplaced: 0 });

  return [
    ...rows.map((row) => formatMaskBandGuardLine(row)),
    formatMaskBandGuardLine({
      setPrefix: "all",
      title: "all",
      ...total,
    }),
  ];
}

/** Production boot. One walk per process. Report mode does not exclude. */
export function startMaskBandGuardScan(): void {
  if (scanStarted) return;
  scanStarted = true;
  scanStop = false;
  addShutdownHook(() => {
    scanStop = true;
  });
  void runMaskBandGuardScan({ shouldStop: () => scanStop }).catch((err) => {
    console.error("[Startup] FATAL: mask band guard scan crashed:", err instanceof Error ? err.message : err);
  });
}
