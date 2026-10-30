/**
 * Volume janitor for the Railway share/mask volume (/app/data/masked-cards, 5 GB).
 *
 * 2026-10-30 P0: the volume hit 100% and every mask bake and score card write
 * failed with ENOSPC. Disk here is a cache for regenerable files; this module
 * bounds it.
 *
 * Evictable (regenerable), in order:
 *   1. Masked JPEG bakes from an older mask version (`<id>_vX[_rN].jpg`, X != current).
 *   2. Share PNGs under generated/share/<YYYY-MM-DD>/ older than SHARE_KEEP_DAYS
 *      (score cards re-render on demand at the same URL).
 *   3. Current-version masked JPEG bakes, oldest mtime first, never a protected
 *      card (pinned covers, recent/upcoming Daily 5 cards). The `.ok` marker is
 *      kept so dealing is unchanged; a miss re-bakes on demand in sendMaskedCard.
 * Never touched: .db-backups, mask plans, sidecars/markers, state files,
 * lifecycle sources, generated/share/play-sets, anything else.
 */
import { promises as fsp } from "fs";
import path from "path";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";

export const VOLUME_ROOT = "/app/data/masked-cards";
export const HIGH_WATER_PCT = 80;
export const TARGET_PCT = 70;
export const PAUSE_PCT = 92;
export const SHARE_KEEP_DAYS = 2;
const PERIOD_MS = 15 * 60 * 1000;
const EMERGENCY_MIN_GAP_MS = 60 * 1000;

export interface VolumeUsage { totalBytes: number; usedBytes: number; freeBytes: number; usedPct: number }

export async function statVolume(root = VOLUME_ROOT): Promise<VolumeUsage> {
  const s = await fsp.statfs(root);
  const totalBytes = s.blocks * s.bsize;
  const freeBytes = s.bavail * s.bsize;
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return { totalBytes, usedBytes, freeBytes, usedPct: totalBytes ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0 };
}

const BAKE_RE = /^(.+)_(v[\d.]+)(?:_r(?:90|180|270))?\.jpg$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EvictTier = "stale_mask_version" | "old_share_png" | "current_mask_lru";
export interface Candidate { file: string; bytes: number; mtimeMs: number; tier: EvictTier }

/** Classify a top-level file in the volume root. Exported for tests and the QA report. */
export function classifyRootFile(name: string): "mask_bake_current" | "mask_bake_stale" | "other" {
  const m = BAKE_RE.exec(name);
  if (!m) return "other";
  return m[2] === CURRENT_MASK_VERSION ? "mask_bake_current" : "mask_bake_stale";
}

export async function listCandidates(opts: {
  root?: string;
  protectedCardIds?: ReadonlySet<string>;
  now?: number;
}): Promise<Candidate[]> {
  const root = opts.root ?? VOLUME_ROOT;
  const now = opts.now ?? Date.now();
  const prot = opts.protectedCardIds ?? new Set<string>();
  const stale: Candidate[] = [];
  const current: Candidate[] = [];
  const share: Candidate[] = [];

  let entries: import("fs").Dirent[] = [];
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const m = BAKE_RE.exec(e.name);
    if (!m) continue;
    const full = path.join(root, e.name);
    let st;
    try { st = await fsp.stat(full); } catch { continue; }
    if (m[2] !== CURRENT_MASK_VERSION) {
      stale.push({ file: full, bytes: st.size, mtimeMs: st.mtimeMs, tier: "stale_mask_version" });
    } else if (!prot.has(m[1])) {
      current.push({ file: full, bytes: st.size, mtimeMs: st.mtimeMs, tier: "current_mask_lru" });
    }
  }

  const shareRoot = path.join(root, "generated", "share");
  const cutoff = new Date(now - SHARE_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  let days: import("fs").Dirent[] = [];
  try { days = await fsp.readdir(shareRoot, { withFileTypes: true }); } catch { days = []; }
  for (const d of days) {
    if (!d.isDirectory() || !DAY_RE.test(d.name) || d.name >= cutoff) continue;
    const dir = path.join(shareRoot, d.name);
    let files: string[] = [];
    try { files = await fsp.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".png")) continue;
      try {
        const st = await fsp.stat(path.join(dir, f));
        if (st.isFile()) share.push({ file: path.join(dir, f), bytes: st.size, mtimeMs: st.mtimeMs, tier: "old_share_png" });
      } catch { /* gone */ }
    }
  }

  stale.sort((a, b) => a.mtimeMs - b.mtimeMs);
  share.sort((a, b) => a.mtimeMs - b.mtimeMs);
  current.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return [...stale, ...share, ...current];
}

export interface EvictResult {
  before: VolumeUsage;
  after: VolumeUsage;
  freedBytes: number;
  deleted: Record<EvictTier, number>;
}

/**
 * Free space until used <= targetPct. Stale bakes and old share PNGs always go
 * when we are over the target; current bakes go only as far as needed.
 */
export async function evictToTarget(opts: {
  root?: string;
  targetPct?: number;
  protectedCardIds?: ReadonlySet<string>;
  now?: number;
  usage?: () => Promise<VolumeUsage>;
  unlink?: (file: string) => Promise<void>;
}): Promise<EvictResult> {
  const usage = opts.usage ?? (() => statVolume(opts.root));
  const unlink = opts.unlink ?? ((f: string) => fsp.unlink(f));
  const target = opts.targetPct ?? TARGET_PCT;
  const before = await usage();
  const deleted: Record<EvictTier, number> = { stale_mask_version: 0, old_share_png: 0, current_mask_lru: 0 };
  let freed = 0;
  const need = before.usedBytes - (target / 100) * before.totalBytes;
  if (need > 0) {
    const candidates = await listCandidates(opts);
    for (const c of candidates) {
      if (freed >= need) break;
      try {
        await unlink(c.file);
        freed += c.bytes;
        deleted[c.tier] += 1;
      } catch { /* raced or already gone */ }
    }
  }
  const after = await usage();
  return { before, after, freedBytes: freed, deleted };
}

/** Bytes per top-level entry, root files bucketed by kind. For the QA route. */
export async function volumeBreakdown(root = VOLUME_ROOT): Promise<Record<string, { bytes: number; files: number }>> {
  const out: Record<string, { bytes: number; files: number }> = {};
  const add = (k: string, b: number) => { const r = (out[k] ??= { bytes: 0, files: 0 }); r.bytes += b; r.files += 1; };
  async function walk(dir: string, key: string): Promise<void> {
    let ents: import("fs").Dirent[] = [];
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, key);
      else if (e.isFile()) { try { add(key, (await fsp.stat(full)).size); } catch { /* gone */ } }
    }
  }
  let ents: import("fs").Dirent[] = [];
  try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) { await walk(full, `${e.name}/`); continue; }
    if (!e.isFile()) continue;
    let key = classifyRootFile(e.name) as string;
    if (key === "other") {
      const ext = path.extname(e.name) || e.name;
      key = `root:${ext.replace(/^\./, "")}`;
    }
    try { add(key, (await fsp.stat(full)).size); } catch { /* gone */ }
  }
  return out;
}

// ---- runtime wiring -------------------------------------------------------

let writesPaused = false;
let running: Promise<EvictResult | null> | null = null;
let lastEmergencyAt = 0;
let lastResult: (EvictResult & { at: string; reason: string }) | null = null;
let enospcCount = 0;
let lastEnospcAt: string | null = null;

/** Warmup and other background bakers check this before writing. */
export function volumeWritesPaused(): boolean { return writesPaused; }
export function janitorStatus() { return { writesPaused, enospcCount, lastEnospcAt, lastRun: lastResult }; }
export function resetJanitorForTests(): void { writesPaused = false; running = null; lastEmergencyAt = 0; lastResult = null; enospcCount = 0; lastEnospcAt = null; }

export function isEnospc(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException | undefined;
  return !!e && (e.code === "ENOSPC" || e.code === "EDQUOT" || /ENOSPC|no space left/i.test(String(e.message ?? "")));
}

async function defaultProtectedIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const { PINNED_SET_COVERS } = await import("../config/pinnedCovers");
    for (const list of Object.values(PINNED_SET_COVERS)) {
      for (const id of [...list.picks, ...list.alternates]) if (id) ids.add(String(id).trim());
    }
  } catch { /* config missing */ }
  try {
    const { pool } = await import("../db");
    const r = await pool.query(
      `SELECT c.card_id FROM daily_challenge_cards c
       JOIN daily_challenges d ON d.id = c.daily_challenge_id
       WHERE d.ends_at > NOW() - INTERVAL '3 days'`,
    );
    for (const row of r.rows as Array<{ card_id: string }>) ids.add(row.card_id);
  } catch { /* db not ready: pinned only */ }
  return ids;
}

let protectedLoader: () => Promise<Set<string>> = defaultProtectedIds;
export function setProtectedLoaderForTests(fn: (() => Promise<Set<string>>) | null): void {
  protectedLoader = fn ?? defaultProtectedIds;
}

/** Single-flight janitor run. Returns null when the volume is not mounted. */
export async function runJanitor(reason: string, opts: { force?: boolean; root?: string; usage?: () => Promise<VolumeUsage> } = {}): Promise<EvictResult | null> {
  if (running) return running;
  running = (async () => {
    try {
      const usage = opts.usage ?? (() => statVolume(opts.root));
      const now = await usage().catch(() => null);
      if (!now) return null;
      if (!opts.force && now.usedPct < HIGH_WATER_PCT) {
        writesPaused = false;
        return null;
      }
      const result = await evictToTarget({
        root: opts.root,
        usage,
        protectedCardIds: await protectedLoader(),
      });
      writesPaused = result.after.usedPct >= PAUSE_PCT;
      lastResult = { ...result, at: new Date().toISOString(), reason };
      console.log(`[VolumeJanitor] ${reason}: ${result.before.usedPct}% -> ${result.after.usedPct}% freed=${result.freedBytes} deleted=${JSON.stringify(result.deleted)} paused=${writesPaused}`);
      return result;
    } catch (err) {
      console.error("[VolumeJanitor] run failed:", (err as Error)?.message);
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Write with one retry after ENOSPC. The retry runs only after an eviction
 * pass (rate-limited so a burst of failures shares one pass).
 */
export async function writeWithEnospcRetry<T>(write: () => Promise<T>, opts: { root?: string; usage?: () => Promise<VolumeUsage> } = {}): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (!isEnospc(err)) throw err;
    enospcCount += 1;
    lastEnospcAt = new Date().toISOString();
    const nowMs = Date.now();
    if (running || nowMs - lastEmergencyAt >= EMERGENCY_MIN_GAP_MS) {
      lastEmergencyAt = nowMs;
      await runJanitor("enospc", { force: true, ...opts });
    } else {
      writesPaused = true;
    }
    return await write();
  }
}

let timer: NodeJS.Timeout | null = null;
export function startVolumeJanitor(root = VOLUME_ROOT): void {
  if (timer) return;
  void fsp.access(root).then(() => {
    void runJanitor("startup", { root });
    timer = setInterval(() => { void runJanitor("periodic", { root }); }, PERIOD_MS);
    timer.unref?.();
  }).catch(() => { /* no volume (local/CI) */ });
}
