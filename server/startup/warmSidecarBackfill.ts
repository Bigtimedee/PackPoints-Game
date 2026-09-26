import { existsSync } from "fs";
import { readdir, writeFile } from "fs/promises";
import path from "path";
import { warmMaskedFileAllowed, warmMaskedFilename } from "../masking/maskingService";
import { invalidateMaskReadySidecar } from "../masking/maskReadySidecar";
import { isMaskBandExcluded, MASK_BAND_MISPLACED, MASK_BAND_OVERSIZED } from "../masking/maskBandLimit";
import { isLandscapeJpegFile, normalizeQuarterTurn, readOrientNote, type OrientNote } from "../masking/orientNote";
import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";
import { cardIdFromWarmJpeg, warmOkMarkerFilename } from "./warmMaskGate";
import { addShutdownHook } from "./shutdownHooks";
import { runNameVisibilityBackfill } from "../masking/nameVisibilityBackfill";
import { logEligibleSetCounts } from "../services/playableSetEligibility";

export const SIDECAR_BACKFILL_BATCH = 50;
const PAUSE_MS = 200;

export interface WarmSidecarCardRow {
  cardId: string;
  inPlayable: boolean;
  inBaseball: boolean;
  isPlayable: boolean | null;
  setActive: boolean | null;
  blockedReason: string | null;
  imageRotation: number | null;
  imageCacheStatus: string | null;
  imageQuarantineReason: string | null;
}

export interface WarmSidecarCounts {
  scanned: number;
  written: number;
  skipped: number;
  removed: number;
}

const ELIGIBILITY_SQL = `
SELECT ids.id AS card_id,
  pc.id IS NOT NULL AS in_playable,
  b.id IS NOT NULL AS in_baseball,
  pc.is_playable,
  pc.blocked_reason,
  pc.image_rotation,
  gs.is_active AS set_is_active,
  c.status AS image_cache_status,
  q.reason AS image_quarantine_reason
FROM unnest($1::text[]) AS ids(id)
LEFT JOIN playable_cards pc ON pc.id = ids.id
LEFT JOIN baseball_cards b ON b.id = ids.id
LEFT JOIN game_sets gs ON gs.id = pc.game_set_id
LEFT JOIN card_image_cache c ON c.card_id = ids.id
LEFT JOIN card_image_quarantine q ON q.card_id = ids.id
`;

function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

export function warmSidecarRowAllowed(
  row: WarmSidecarCardRow,
  file: { filename: string; note: OrientNote | null; landscape: boolean },
): boolean {
  if (!row.inPlayable && !row.inBaseball) return false;
  if (row.inPlayable && row.isPlayable === false) return false;
  if (row.setActive === false) return false;
  if (row.blockedReason === "mask_name_uncovered" || row.blockedReason === "name_visible_outside_mask" || row.blockedReason === MASK_BAND_OVERSIZED || row.blockedReason === MASK_BAND_MISPLACED) return false;
  if (row.imageQuarantineReason) return false;
  if (row.imageCacheStatus === "bad") return false;
  const imageRotation = row.inPlayable ? normalizeQuarterTurn(row.imageRotation) : 0;
  return warmMaskedFileAllowed({
    cardId: row.cardId,
    filename: file.filename,
    imageRotation,
    note: file.note,
    landscape: file.landscape,
  });
}

export async function queryWarmSidecarRows(cardIds: string[]): Promise<Map<string, WarmSidecarCardRow>> {
  const map = new Map<string, WarmSidecarCardRow>();
  if (cardIds.length === 0) return map;
  const { pool } = await import("../db");
  const result = await pool.query(ELIGIBILITY_SQL, [cardIds]);
  for (const raw of result.rows as Array<Record<string, unknown>>) {
    const cardId = String(raw.card_id ?? "");
    if (!cardId) continue;
    map.set(cardId, {
      cardId,
      inPlayable: asBool(raw.in_playable),
      inBaseball: asBool(raw.in_baseball),
      isPlayable: raw.is_playable == null ? null : asBool(raw.is_playable),
      setActive: raw.set_is_active == null ? null : asBool(raw.set_is_active),
      blockedReason: raw.blocked_reason == null ? null : String(raw.blocked_reason),
      imageRotation: raw.image_rotation == null ? null : Number(raw.image_rotation),
      imageCacheStatus: raw.image_cache_status == null ? null : String(raw.image_cache_status),
      imageQuarantineReason: raw.image_quarantine_reason == null ? null : String(raw.image_quarantine_reason),
    });
  }
  return map;
}

function chosenWarmJpeg(dir: string, cardId: string, names: Set<string>): string | null {
  const note = readOrientNote(cardId, dir);
  const order = note == null ? [90, 180, 270, 0] as const : [note.rotation];
  for (const rotation of order) {
    const filename = warmMaskedFilename(cardId, rotation);
    if (names.has(filename)) return filename;
  }
  return null;
}

function warmCardFiles(dir: string, names: string[]): Array<{ cardId: string; filename: string | null; hasSidecar: boolean }> {
  const set = new Set(names);
  const ids = new Set<string>();
  for (const name of names) {
    const cardId = cardIdFromWarmJpeg(name);
    if (cardId) ids.add(cardId);
  }
  const out: Array<{ cardId: string; filename: string | null; hasSidecar: boolean }> = [];
  for (const cardId of ids) {
    out.push({
      cardId,
      filename: chosenWarmJpeg(dir, cardId, set),
      hasSidecar: set.has(warmOkMarkerFilename(cardId)),
    });
  }
  return out;
}

let backfillStop = false;
let backfillStarted = false;

export function cancelWarmSidecarBackfill(): void {
  backfillStop = true;
}

export function resetWarmSidecarBackfillForTests(): void {
  backfillStop = false;
  backfillStarted = false;
}

export async function maybeWriteWarmOkSidecar(
  cardId: string,
  filename: string,
  opts?: {
    dir?: string;
    loadEligibility?: (cardIds: string[]) => Promise<Map<string, WarmSidecarCardRow>>;
  },
): Promise<boolean> {
  if (!cardId || !filename) return false;
  const dir = opts?.dir ?? MASKED_CARDS_DIR;
  if (isMaskBandExcluded(cardId, dir)) return false;
  const marker = path.join(dir, warmOkMarkerFilename(cardId));
  if (existsSync(marker)) return false;
  try {
    const load = opts?.loadEligibility ?? queryWarmSidecarRows;
    const rows = await load([cardId]);
    const row = rows.get(cardId);
    if (!row) return false;
    const note = readOrientNote(cardId, dir);
    const landscape = isLandscapeJpegFile(path.join(dir, filename));
    if (!warmSidecarRowAllowed(row, { filename, note, landscape })) return false;
    if (existsSync(marker)) return false;
    await writeFile(marker, "ok\n");
    return true;
  } catch (err) {
    console.error("[Startup] warm sidecar write failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function runWarmSidecarBackfill(opts?: {
  dir?: string;
  batchSize?: number;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  loadEligibility?: (cardIds: string[]) => Promise<Map<string, WarmSidecarCardRow>>;
  shouldStop?: () => boolean;
}): Promise<WarmSidecarCounts> {
  const dir = opts?.dir ?? MASKED_CARDS_DIR;
  const batchSize = opts?.batchSize ?? SIDECAR_BACKFILL_BATCH;
  const pauseMs = opts?.pauseMs ?? PAUSE_MS;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const load = opts?.loadEligibility ?? queryWarmSidecarRows;
  const shouldStop = opts?.shouldStop ?? (() => backfillStop);
  const counts: WarmSidecarCounts = { scanned: 0, written: 0, skipped: 0, removed: 0 };
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    console.log(`[Startup] warm sidecar backfill scanned=0 written=0 skipped=0 removed=0`);
    return counts;
  }
  const pending = warmCardFiles(dir, names);
  const needsDb = pending.filter((item) => item.filename != null) as Array<{ cardId: string; filename: string; hasSidecar: boolean }>;
  for (const item of pending) {
    if (item.filename == null) {
      counts.scanned += 1;
      counts.skipped += 1;
    }
  }
  for (let i = 0; i < needsDb.length; i += batchSize) {
    if (shouldStop()) break;
    const batch = needsDb.slice(i, i + batchSize);
    let rows: Map<string, WarmSidecarCardRow>;
    try {
      rows = await load(batch.map((item) => item.cardId));
    } catch (err) {
      console.error("[Startup] FATAL: warm sidecar backfill stopped:", err instanceof Error ? err.message : err);
      break;
    }
    for (const item of batch) {
      counts.scanned += 1;
      if (isMaskBandExcluded(item.cardId, dir)) {
        if (item.hasSidecar) counts.removed += 1;
        else counts.skipped += 1;
        continue;
      }
      const row = rows.get(item.cardId);
      const note = readOrientNote(item.cardId, dir);
      const landscape = isLandscapeJpegFile(path.join(dir, item.filename));
      const allowed = Boolean(row && warmSidecarRowAllowed(row, { filename: item.filename, note, landscape }));
      if (item.hasSidecar && !allowed) {
        invalidateMaskReadySidecar(item.cardId, dir);
        counts.removed += 1;
        continue;
      }
      if (!allowed || item.hasSidecar) {
        counts.skipped += 1;
        continue;
      }
      const marker = path.join(dir, warmOkMarkerFilename(item.cardId));
      if (existsSync(marker)) {
        counts.skipped += 1;
        continue;
      }
      await writeFile(marker, "ok\n");
      counts.written += 1;
    }
    if (i + batchSize < needsDb.length && !shouldStop()) await sleep(pauseMs);
  }
  console.log(`[Startup] warm sidecar backfill scanned=${counts.scanned} written=${counts.written} skipped=${counts.skipped} removed=${counts.removed}`);
  return counts;
}

/** After routes are ready. Low priority, one batch of files per tick. */
export function startWarmSidecarBackfill(): void {
  if (backfillStarted) return;
  backfillStarted = true;
  backfillStop = false;
  addShutdownHook(() => {
    backfillStop = true;
  });
  void (async () => {
    try {
      await runWarmSidecarBackfill();
      await runNameVisibilityBackfill();
      const { swapFailedCardsOnTodayChallenge } = await import("../services/daily5FailedCardSwap");
      await swapFailedCardsOnTodayChallenge();
    } catch (err) {
      console.error("[Startup] FATAL: warm sidecar backfill crashed:", err instanceof Error ? err.message : err);
    } finally {
      await logEligibleSetCounts().catch((err) => {
        console.error("[MaskCheck] eligible count log failed", err instanceof Error ? err.message : err);
      });
    }
  })();
}
