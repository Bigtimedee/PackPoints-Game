import { existsSync } from "fs";
import { readdir, writeFile } from "fs/promises";
import path from "path";
import { warmMaskedFileAllowed, warmMaskedFilename } from "../masking/maskingService";
import { isLandscapeJpegFile, normalizeQuarterTurn, readOrientNote, type OrientNote } from "../masking/orientNote";
import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";
import { cardIdFromWarmJpeg, warmOkMarkerFilename } from "./warmMaskGate";
import { addShutdownHook } from "./shutdownHooks";

export const SIDECAR_BACKFILL_BATCH = 50;
const PAUSE_MS = 200;

export interface WarmSidecarCardRow {
  cardId: string;
  inPlayable: boolean;
  inBaseball: boolean;
  blockedReason: string | null;
  imageRotation: number | null;
  imageCacheStatus: string | null;
  imageQuarantineReason: string | null;
}

export interface WarmSidecarCounts {
  scanned: number;
  written: number;
  skipped: number;
}

const ELIGIBILITY_SQL = `
SELECT ids.id AS card_id,
  pc.id IS NOT NULL AS in_playable,
  b.id IS NOT NULL AS in_baseball,
  pc.blocked_reason,
  pc.image_rotation,
  c.status AS image_cache_status,
  q.reason AS image_quarantine_reason
FROM unnest($1::text[]) AS ids(id)
LEFT JOIN playable_cards pc ON pc.id = ids.id
LEFT JOIN baseball_cards b ON b.id = ids.id
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
  if (row.blockedReason === "mask_name_uncovered") return false;
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

function unmarkedCards(dir: string, names: string[]): Array<{ cardId: string; filename: string | null }> {
  const set = new Set(names);
  const ids = new Set<string>();
  for (const name of names) {
    const cardId = cardIdFromWarmJpeg(name);
    if (cardId) ids.add(cardId);
  }
  const out: Array<{ cardId: string; filename: string | null }> = [];
  for (const cardId of ids) {
    if (set.has(warmOkMarkerFilename(cardId))) continue;
    out.push({ cardId, filename: chosenWarmJpeg(dir, cardId, set) });
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
  const counts: WarmSidecarCounts = { scanned: 0, written: 0, skipped: 0 };
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    console.log(`[Startup] warm sidecar backfill scanned=0 written=0 skipped=0`);
    return counts;
  }
  const pending = unmarkedCards(dir, names);
  const needsDb = pending.filter((item) => item.filename != null) as Array<{ cardId: string; filename: string }>;
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
      const row = rows.get(item.cardId);
      const note = readOrientNote(item.cardId, dir);
      const landscape = isLandscapeJpegFile(path.join(dir, item.filename));
      if (!row || !warmSidecarRowAllowed(row, { filename: item.filename, note, landscape })) {
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
  console.log(`[Startup] warm sidecar backfill scanned=${counts.scanned} written=${counts.written} skipped=${counts.skipped}`);
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
  void runWarmSidecarBackfill().catch((err) => {
    console.error("[Startup] FATAL: warm sidecar backfill crashed:", err instanceof Error ? err.message : err);
  });
}
