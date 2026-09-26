/**
 * Fail closed when the full-width name bands cover more than 35% of the card.
 * Already-baked v4.5 cards are judged from `{cardId}_v4.5.json` (written at bake).
 * No image re-encode and no mask-version bump.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { playableCards } from "@shared/schema";
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

/** Strictly above this fraction of image height. 35.0% stays servable. */
export const MAX_MASK_BAND_FRACTION = 0.35;

export const MASK_BAND_OVERSIZED = "mask_band_oversized";

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

const verdictCache = new Map<string, boolean>();
const persistJobs = new Map<string, Promise<void>>();

let scanStarted = false;
let scanStop = false;

export function clearMaskBandCacheForTests(): void {
  verdictCache.clear();
  persistJobs.clear();
}

/** Union of full-width band heights, as a fraction of the card (0 to 1). */
export function maskedBandFraction(regions: readonly BandBox[] | null | undefined): number {
  if (!regions || regions.length === 0) return 0;
  const spans: Array<[number, number]> = [];
  for (const region of regions) {
    const w = Number(region.wPct);
    const y = Number(region.yPct);
    const h = Number(region.hPct);
    if (!Number.isFinite(w) || w < FULL_WIDTH_PCT) continue;
    if (!Number.isFinite(y) || !Number.isFinite(h) || h <= 0) continue;
    const start = Math.max(0, Math.min(100, y));
    const end = Math.max(0, Math.min(100, y + h));
    if (end > start) spans.push([start, end]);
  }
  if (spans.length === 0) return 0;
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = spans[0][0];
  let curEnd = spans[0][1];
  for (let i = 1; i < spans.length; i++) {
    const start = spans[i][0];
    const end = spans[i][1];
    if (start <= curEnd) curEnd = Math.max(curEnd, end);
    else {
      total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  total += curEnd - curStart;
  return total / 100;
}

export function isOversizedMaskBand(regions: readonly BandBox[] | null | undefined): boolean {
  return maskedBandFraction(regions) > MAX_MASK_BAND_FRACTION;
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
  return `${dir}\0${cardId}\0${mtime(plan)}\0${mtime(fail)}`;
}

function regionsFromPlan(filePath: string): BandBox[] | null {
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

/**
 * Mark the card unplayable only while it is still playable, so a name-leak
 * quarantine (`mask_name_uncovered`, already is_playable false) is left as-is.
 */
export function persistOversizedBand(cardId: string): Promise<void> {
  const existing = persistJobs.get(cardId);
  if (existing) return existing;
  const job = (async () => {
    try {
      await db
        .update(playableCards)
        .set({
          isPlayable: false,
          blockedReason: MASK_BAND_OVERSIZED,
          imageReviewStatus: "flagged",
          quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
          lastValidationReason: MASK_BAND_OVERSIZED,
          updatedAt: new Date(),
        })
        .where(and(eq(playableCards.id, cardId), eq(playableCards.isPlayable, true)));
    } catch (error) {
      persistJobs.delete(cardId);
      console.error(`[MaskBand] Failed to record oversized band for ${cardId}:`, error);
    }
  })();
  persistJobs.set(cardId, job);
  return job;
}

function remember(dir: string, cardId: string, oversized: boolean): void {
  verdictCache.set(cacheKey(dir, cardId), oversized);
}

/**
 * True when this card's baked band is over the limit.
 * A fail marker wins. Otherwise the v4.5 plan sidecar is read (no re-encode).
 * The first oversized hit writes `mask_band_oversized` and drops `{cardId}_*.ok`.
 * Missing plan geometry stays false; the next bake applies the check.
 */
export function isMaskBandOversized(cardId: string, dir = maskReadySidecarDir()): boolean {
  if (!safeCardId(cardId)) return false;
  const key = cacheKey(dir, cardId);
  const hit = verdictCache.get(key);
  if (hit != null) return hit;

  const reason = readMaskFailureReason(cardId, dir);
  if (reason === MASK_BAND_OVERSIZED) {
    invalidateMaskReadySidecar(cardId, dir);
    void persistOversizedBand(cardId);
    remember(dir, cardId, true);
    return true;
  }

  const planPath = path.join(dir, warmMaskPlanFilename(cardId));
  if (!existsSync(planPath)) {
    remember(dir, cardId, false);
    return false;
  }
  const regions = regionsFromPlan(planPath);
  if (!regions || !isOversizedMaskBand(regions)) {
    remember(dir, cardId, false);
    return false;
  }

  if (reason !== "mask_name_uncovered") {
    try {
      writeMaskFailureSidecar(cardId, MASK_BAND_OVERSIZED, dir);
    } catch (error) {
      console.error(`[MaskBand] Failed to write fail marker for ${cardId}:`, error);
    }
    void persistOversizedBand(cardId);
  }
  invalidateMaskReadySidecar(cardId, dir);
  remember(dir, cardId, true);
  return true;
}

/** Bake-time refusal. Does not write the masked JPEG. */
export async function rejectOversizedMaskBand(cardId: string, dir = maskReadySidecarDir()): Promise<void> {
  if (!safeCardId(cardId)) return;
  const reason = readMaskFailureReason(cardId, dir);
  if (reason !== "mask_name_uncovered") {
    writeMaskFailureSidecar(cardId, MASK_BAND_OVERSIZED, dir);
    await persistOversizedBand(cardId);
  }
  invalidateMaskReadySidecar(cardId, dir);
  remember(dir, cardId, true);
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

/**
 * Off the request path. Reads plan sidecars already on disk and writes
 * `mask_band_oversized` markers. Bounded batch plus a short pause.
 */
export async function markOversizedBakedCards(opts?: {
  dir?: string;
  batchSize?: number;
  concurrency?: number;
  pauseMs?: number;
  shouldStop?: () => boolean;
}): Promise<{ scanned: number; marked: number }> {
  const dir = opts?.dir ?? maskReadySidecarDir();
  const batchSize = opts?.batchSize ?? SCAN_BATCH;
  const concurrency = opts?.concurrency ?? SCAN_CONCURRENCY;
  const pauseMs = opts?.pauseMs ?? SCAN_PAUSE_MS;
  const shouldStop = opts?.shouldStop ?? (() => false);
  const suffix = `_${CURRENT_MASK_VERSION}.json`;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return { scanned: 0, marked: 0 };
  }
  const cardIds: string[] = [];
  for (const name of names) {
    if (!name.endsWith(suffix)) continue;
    const cardId = name.slice(0, -suffix.length);
    if (!safeCardId(cardId)) continue;
    cardIds.push(cardId);
  }

  let marked = 0;
  for (let i = 0; i < cardIds.length; i += batchSize) {
    if (shouldStop()) break;
    const batch = cardIds.slice(i, i + batchSize);
    await mapPool(batch, concurrency, async (cardId) => {
      if (!isMaskBandOversized(cardId, dir)) return;
      await persistOversizedBand(cardId);
      marked += 1;
    });
    if (pauseMs > 0 && i + batchSize < cardIds.length && !shouldStop()) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
  return { scanned: cardIds.length, marked };
}

/** Production boot, next to the warm sidecar backfill. One walk per process. */
export function startOversizedBandScan(): void {
  if (scanStarted) return;
  scanStarted = true;
  scanStop = false;
  addShutdownHook(() => {
    scanStop = true;
  });
  void markOversizedBakedCards({ shouldStop: () => scanStop })
    .then((counts) => {
      console.log(`[Startup] oversized band scan scanned=${counts.scanned} marked=${counts.marked}`);
    })
    .catch((err) => {
      console.error("[Startup] FATAL: oversized band scan crashed:", err instanceof Error ? err.message : err);
    });
}
