import { createHash } from "crypto";
import { spawn, type ChildProcess } from "child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { logBootPhase } from "./bootPhase";
import { addShutdownHook } from "./shutdownHooks";

/** Same restore-point rule as the old start.sh guard. Dump failure skips the push. */
export const BOOT_BACKUP_KEEP = 14;

/** A hung dump is killed and the push is skipped, same as a failed dump. */
export const PG_DUMP_TIMEOUT_MS = 90_000;

/** A hung foreground push or storage setup exits so a closed schema gate cannot sit forever. */
export const DRIZZLE_PUSH_TIMEOUT_MS = 120_000;
export const STORAGE_INIT_TIMEOUT_MS = 60_000;

export class StartupTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "StartupTimeoutError";
  }
}

export function withStartupTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new StartupTimeoutError(label, ms)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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
  (command: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcess;
}

/** Session options for the push child only. node-postgres honors `options` on the URL. */
export function withSessionLockTimeout(databaseUrl: string, lockTimeout: string): string {
  const flag = `-c lock_timeout=${lockTimeout}`;
  const encoded = encodeURIComponent(flag);
  const hashAt = databaseUrl.indexOf("#");
  const base = hashAt === -1 ? databaseUrl : databaseUrl.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : databaseUrl.slice(hashAt);
  const existing = base.match(/([?&]options=)([^&]*)/);
  if (existing) {
    return `${base.replace(existing[0], `${existing[1]}${existing[2]}%20${encoded}`)}${fragment}`;
  }
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}options=${encoded}${fragment}`;
}

let activeChild: ChildProcess | null = null;

export function cancelBootSchema(): void {
  if (activeChild && !activeChild.killed) {
    activeChild.kill("SIGTERM");
  }
}

function defaultSpawn(command: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { stdio: "inherit", env: env ?? process.env });
  activeChild = child;
  child.on("close", () => {
    if (activeChild === child) activeChild = null;
  });
  return child;
}

function run(
  spawnImpl: BootSpawn,
  command: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess | undefined;
    const done = (code: number, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, timedOut });
    };
    const timer = setTimeout(() => {
      try {
        child?.kill("SIGKILL");
      } catch {
        // already gone
      }
      done(1, true);
    }, timeoutMs);
    try {
      child = spawnImpl(command, args, env);
    } catch (err) {
      console.error(`[Startup] ${command} failed to start:`, err instanceof Error ? err.message : err);
      done(1, false);
      return;
    }
    child.on("error", (err) => {
      console.error(`[Startup] ${command} failed to start:`, err.message);
      done(1, false);
    });
    child.on("close", (code) => done(code ?? 1, false));
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
 * A required dump that fails skips the push. A foreground timeout exits.
 * A background push (fast schema path) logs and stays up; its connection sets
 * lock_timeout so a surprise DDL statement cannot sit on AccessExclusive.
 */
export async function runBootSchema(opts?: {
  backupDir?: string;
  databaseUrl?: string;
  cwd?: string;
  now?: Date;
  spawn?: BootSpawn;
  schemaPath?: string;
  markerPath?: string;
  dumpTimeoutMs?: number;
  pushTimeoutMs?: number;
  exit?: (code: number) => void;
  /** Default true. Background pushes pass false: this process is already the live deploy. */
  exitOnPushFailure?: boolean;
  /** When set, the push child gets DATABASE_URL with this lock_timeout. */
  lockTimeout?: string;
}): Promise<{ pushed: boolean; dumpFile: string | null; dumped: boolean; timedOut?: boolean; code?: number }> {
  const databaseUrl = opts?.databaseUrl ?? process.env.DATABASE_URL ?? "";
  const backupDir = opts?.backupDir ?? "/app/data/masked-cards/.db-backups";
  const spawnImpl = opts?.spawn ?? defaultSpawn;
  const now = opts?.now ?? new Date();
  const dumpTimeoutMs = opts?.dumpTimeoutMs ?? PG_DUMP_TIMEOUT_MS;
  const pushTimeoutMs = opts?.pushTimeoutMs ?? DRIZZLE_PUSH_TIMEOUT_MS;
  const exit = opts?.exit ?? ((code: number) => process.exit(code));
  const exitOnPushFailure = opts?.exitOnPushFailure !== false;
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
    const dump = await run(spawnImpl, "pg_dump", [
      "--format=custom",
      "--compress=6",
      `--file=${dumpFile}`,
      databaseUrl,
    ], dumpTimeoutMs);
    logBootPhase("pg_dump_end", { ms: Date.now() - dumpStarted, code: dump.code, timedOut: dump.timedOut });
    if (dump.timedOut) {
      console.error(`[Startup] WARNING: pg_dump timed out after ${dumpTimeoutMs / 1000}s — killed it and SKIPPING schema push. App boots on existing schema.`);
    }
    if (dump.code !== 0) {
      if (!dump.timedOut) {
        console.error("[Startup] WARNING: pg_dump FAILED — SKIPPING schema push. App boots on existing schema.");
      }
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
  const pushEnv = opts?.lockTimeout
    ? { ...process.env, DATABASE_URL: withSessionLockTimeout(databaseUrl, opts.lockTimeout) }
    : undefined;
  const push = await run(spawnImpl, "npx", ["drizzle-kit", "push", "--force"], pushTimeoutMs, pushEnv);
  logBootPhase("drizzle_push_end", { ms: Date.now() - pushStarted, code: push.code, timedOut: push.timedOut });
  if (push.timedOut) {
    if (!exitOnPushFailure) {
      console.error(`[Startup] FATAL: background drizzle-kit push timed out after ${pushTimeoutMs / 1000}s. Not exiting. The fast probe already matched schema.ts, this container is already the live deploy, and exit(1) would only restart it.`);
      return { pushed: false, dumpFile, dumped, timedOut: true, code: 1 };
    }
    console.error(`[Startup] FATAL: drizzle-kit push timed out after ${pushTimeoutMs / 1000}s. Exiting so Railway keeps the previous deploy.`);
    exit(1);
    return { pushed: false, dumpFile, dumped, timedOut: true, code: 1 };
  }
  if (push.code !== 0) {
    if (!exitOnPushFailure) {
      console.error(`[Startup] FATAL: background drizzle-kit push exited ${push.code}. Not exiting. DB routes stay on the schema the probe already accepted.`);
    } else {
      console.error(`[Startup] WARNING: drizzle-kit push exited ${push.code}. DB routes stay on the schema the push left.`);
    }
    return { pushed: false, dumpFile, dumped, timedOut: false, code: push.code };
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
