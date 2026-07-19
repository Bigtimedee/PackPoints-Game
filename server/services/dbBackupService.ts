/**
 * DB Backup Service — user-data retention guarantee.
 *
 * Boot-time dumps (start.sh) only fire on deploys; this service adds a daily
 * scheduled pg_dump so quiet periods still bank restore points. Dumps land in
 * the persistent volume next to the boot dumps and are pruned per family.
 *
 * See INCIDENT_2026-07-18_CARD_SETS.md and CLAUDE.md owner directive 5.
 */
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";

export const BACKUP_DIR = "/app/data/masked-cards/.db-backups";
const DAILY_PREFIX = "daily-";
const DAILY_KEEP = 30;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
// Skip the startup dump when any dump (boot or daily) is fresher than this —
// the boot dump from the same deploy already covers us.
const FRESHNESS_MS = 20 * 60 * 60 * 1000;

function runPgDump(outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return reject(new Error("DATABASE_URL not set"));
    execFile(
      "pg_dump",
      ["--format=custom", "--compress=6", `--file=${outFile}`, dbUrl],
      { timeout: 10 * 60 * 1000 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

export async function listBackups(): Promise<{ name: string; bytes: number; mtime: string }[]> {
  try {
    const names = await fs.readdir(BACKUP_DIR);
    const out: { name: string; bytes: number; mtime: string }[] = [];
    for (const name of names) {
      if (!name.endsWith(".dump")) continue;
      const st = await fs.stat(path.join(BACKUP_DIR, name));
      out.push({ name, bytes: st.size, mtime: st.mtime.toISOString() });
    }
    return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

async function newestBackupAgeMs(): Promise<number> {
  const backups = await listBackups();
  if (backups.length === 0) return Infinity;
  return Date.now() - new Date(backups[0].mtime).getTime();
}

async function pruneDaily(): Promise<void> {
  const daily = (await listBackups()).filter((b) => b.name.startsWith(DAILY_PREFIX));
  for (const b of daily.slice(DAILY_KEEP)) {
    await fs.unlink(path.join(BACKUP_DIR, b.name)).catch(() => {});
  }
}

export async function takeDailyBackup(reason: string): Promise<string | null> {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
    const file = path.join(BACKUP_DIR, `${DAILY_PREFIX}${stamp}.dump`);
    await runPgDump(file);
    const st = await fs.stat(file);
    console.log(`[DbBackup] ${reason} backup written: ${file} (${(st.size / 1024).toFixed(0)}K)`);
    await pruneDaily();
    return file;
  } catch (err) {
    console.error(`[DbBackup] ${reason} backup FAILED:`, err);
    return null;
  }
}

export function startDbBackupService(): void {
  // Startup catch-up: only if no recent dump exists (boot dump usually does).
  void (async () => {
    if ((await newestBackupAgeMs()) > FRESHNESS_MS) {
      await takeDailyBackup("startup catch-up");
    }
  })();

  const timer = setInterval(() => void takeDailyBackup("scheduled daily"), INTERVAL_MS);
  timer.unref();
  console.log("[DbBackup] Daily backup service started (24h interval, keep last 30)");
}
