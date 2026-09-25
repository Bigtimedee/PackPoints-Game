import { spawn, type ChildProcess } from "child_process";
import { mkdir, readdir, rm, stat } from "fs/promises";
import path from "path";
import { addShutdownHook } from "./shutdownHooks";

/** Same restore-point rule as the old start.sh guard. Dump failure skips the push. */
export const BOOT_BACKUP_KEEP = 14;

export interface BootSpawn {
  (command: string, args: string[]): ChildProcess;
}

let activeChild: ChildProcess | null = null;

export function cancelBootSchema(): void {
  if (activeChild && !activeChild.killed) {
    activeChild.kill("SIGTERM");
  }
}

function defaultSpawn(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { stdio: "inherit" });
  activeChild = child;
  child.on("close", () => {
    if (activeChild === child) activeChild = null;
  });
  return child;
}

function run(spawnImpl: BootSpawn, command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (code: number) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    let child: ChildProcess;
    try {
      child = spawnImpl(command, args);
    } catch (err) {
      console.error(`[Startup] ${command} failed to start:`, err instanceof Error ? err.message : err);
      done(1);
      return;
    }
    child.on("error", (err) => {
      console.error(`[Startup] ${command} failed to start:`, err.message);
      done(1);
    });
    child.on("close", (code) => done(code ?? 1));
  });
}

function stamp(now: Date): string {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return iso;
}

export async function pruneBootDumps(backupDir: string, keep = BOOT_BACKUP_KEEP): Promise<void> {
  const names = (await readdir(backupDir)).filter((name) => name.startsWith("pre-push-") && name.endsWith(".dump"));
  const ranked = await Promise.all(names.map(async (name) => {
    const full = path.join(backupDir, name);
    const info = await stat(full);
    return { full, mtime: info.mtimeMs };
  }));
  ranked.sort((a, b) => b.mtime - a.mtime);
  for (const old of ranked.slice(keep)) {
    await rm(old.full, { force: true });
  }
}

/**
 * `pg_dump` then `drizzle-kit push --force` against shared/schema.ts.
 * The push drops tables that are not in that file, so it runs before any
 * DB-dependent route is unmarked. A failed dump skips the push.
 */
export async function runBootSchema(opts?: {
  backupDir?: string;
  databaseUrl?: string;
  cwd?: string;
  now?: Date;
  spawn?: BootSpawn;
}): Promise<{ pushed: boolean; dumpFile: string | null }> {
  const databaseUrl = opts?.databaseUrl ?? process.env.DATABASE_URL ?? "";
  const backupDir = opts?.backupDir ?? "/app/data/masked-cards/.db-backups";
  const spawnImpl = opts?.spawn ?? defaultSpawn;
  const now = opts?.now ?? new Date();
  if (!databaseUrl) {
    console.error("[Startup] WARNING: DATABASE_URL missing — SKIPPING schema push.");
    return { pushed: false, dumpFile: null };
  }

  await mkdir(backupDir, { recursive: true });
  const dumpFile = path.join(backupDir, `pre-push-${stamp(now)}.dump`);
  console.log("[Startup] Taking pre-migration pg_dump...");
  const dumpCode = await run(spawnImpl, "pg_dump", [
    "--format=custom",
    "--compress=6",
    `--file=${dumpFile}`,
    databaseUrl,
  ]);
  if (dumpCode !== 0) {
    console.error("[Startup] WARNING: pg_dump FAILED — SKIPPING schema push. App boots on existing schema.");
    await rm(dumpFile, { force: true });
    return { pushed: false, dumpFile: null };
  }

  await pruneBootDumps(backupDir);
  console.log("[Startup] Running database migrations (drizzle-kit push --force)...");
  const pushCode = await run(spawnImpl, "npx", ["drizzle-kit", "push", "--force"]);
  if (pushCode !== 0) {
    console.error(`[Startup] WARNING: drizzle-kit push exited ${pushCode}. DB routes stay on the schema the push left.`);
    return { pushed: false, dumpFile };
  }
  console.log("[Startup] Migrations complete.");
  return { pushed: true, dumpFile };
}

let hookInstalled = false;
export function installBootSchemaShutdownHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  addShutdownHook(() => cancelBootSchema());
}
