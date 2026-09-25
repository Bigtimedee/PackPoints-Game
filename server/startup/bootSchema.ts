import { createHash } from "crypto";
import { spawn, type ChildProcess } from "child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { logBootPhase } from "./bootPhase";
import { addShutdownHook } from "./shutdownHooks";

/** Same restore-point rule as the old start.sh guard. Dump failure skips the push. */
export const BOOT_BACKUP_KEEP = 14;

/** On the masked-card volume, so it survives the next container. */
export const SCHEMA_PUSH_MARKER = "/app/data/masked-cards/.schema-push-hash";

export async function hashSchemaFile(schemaPath: string): Promise<string> {
  const body = await readFile(schemaPath);
  return createHash("sha256").update(body).digest("hex");
}

export async function readSchemaPushMarker(markerPath: string): Promise<string | null> {
  try {
    const text = (await readFile(markerPath, "utf8")).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** A dump is required only when this schema file is not the last successful push. */
export function schemaDumpRequired(currentHash: string, storedHash: string | null): boolean {
  return storedHash !== currentHash;
}

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
 * `drizzle-kit push --force` against shared/schema.ts on every boot.
 * `pg_dump` runs first only when that file's hash differs from the volume marker.
 * The push drops tables that are not in that file, so it runs before any
 * DB-dependent route is unmarked. A required dump that fails skips the push.
 */
export async function runBootSchema(opts?: {
  backupDir?: string;
  databaseUrl?: string;
  cwd?: string;
  now?: Date;
  spawn?: BootSpawn;
  schemaPath?: string;
  markerPath?: string;
}): Promise<{ pushed: boolean; dumpFile: string | null; dumped: boolean }> {
  const databaseUrl = opts?.databaseUrl ?? process.env.DATABASE_URL ?? "";
  const backupDir = opts?.backupDir ?? "/app/data/masked-cards/.db-backups";
  const spawnImpl = opts?.spawn ?? defaultSpawn;
  const now = opts?.now ?? new Date();
  const schemaPath = opts?.schemaPath ?? path.join(opts?.cwd ?? process.cwd(), "shared/schema.ts");
  const markerPath = opts?.markerPath ?? SCHEMA_PUSH_MARKER;
  if (!databaseUrl) {
    console.error("[Startup] WARNING: DATABASE_URL missing — SKIPPING schema push.");
    return { pushed: false, dumpFile: null, dumped: false };
  }

  await mkdir(backupDir, { recursive: true });
  const currentHash = await hashSchemaFile(schemaPath);
  const storedHash = await readSchemaPushMarker(markerPath);
  let dumpFile: string | null = null;
  let dumped = false;
  if (schemaDumpRequired(currentHash, storedHash)) {
    dumpFile = path.join(backupDir, `pre-push-${stamp(now)}.dump`);
    dumped = true;
    logBootPhase("pg_dump_start");
    const dumpStarted = Date.now();
    console.log("[Startup] Taking pre-migration pg_dump...");
    const dumpCode = await run(spawnImpl, "pg_dump", [
      "--format=custom",
      "--compress=6",
      `--file=${dumpFile}`,
      databaseUrl,
    ]);
    logBootPhase("pg_dump_end", { ms: Date.now() - dumpStarted, code: dumpCode });
    if (dumpCode !== 0) {
      console.error("[Startup] WARNING: pg_dump FAILED — SKIPPING schema push. App boots on existing schema.");
      await rm(dumpFile, { force: true });
      return { pushed: false, dumpFile: null, dumped: true };
    }
    await pruneBootDumps(backupDir);
  } else {
    logBootPhase("pg_dump_skipped", { reason: "schema_hash_unchanged" });
    console.log("[Startup] Schema hash matches the last successful push — skipping pg_dump.");
  }

  logBootPhase("drizzle_push_start");
  const pushStarted = Date.now();
  console.log("[Startup] Running database migrations (drizzle-kit push --force)...");
  const pushCode = await run(spawnImpl, "npx", ["drizzle-kit", "push", "--force"]);
  logBootPhase("drizzle_push_end", { ms: Date.now() - pushStarted, code: pushCode });
  if (pushCode !== 0) {
    console.error(`[Startup] WARNING: drizzle-kit push exited ${pushCode}. DB routes stay on the schema the push left.`);
    return { pushed: false, dumpFile, dumped };
  }
  await mkdir(path.dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${currentHash}\n`);
  console.log("[Startup] Migrations complete.");
  return { pushed: true, dumpFile, dumped };
}

let hookInstalled = false;
export function installBootSchemaShutdownHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  addShutdownHook(() => cancelBootSchema());
}
