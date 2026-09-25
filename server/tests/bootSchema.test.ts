import { spawn } from "child_process";
import { EventEmitter } from "events";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { mkdtemp, readFile, readdir, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRIZZLE_PUSH_TIMEOUT_MS, killChildGroup, PG_DUMP_TIMEOUT_MS, pruneBootDumps, runBootSchema, schemaDumpRequired, StartupTimeoutError, STORAGE_INIT_TIMEOUT_MS, withSessionLockTimeout, withStartupTimeout, type BootSpawn } from "../startup/bootSchema";

function fakeSpawn(failCommand?: string): { spawn: BootSpawn; calls: string[][] } {
  const calls: string[][] = [];
  const spawn: BootSpawn = (command, args) => {
    calls.push([command, ...args]);
    if (command === "pg_dump" && command !== failCommand) {
      const fileArg = args.find((arg) => arg.startsWith("--file="));
      if (fileArg) writeFileSync(fileArg.slice("--file=".length), "dump");
    }
    const child = new EventEmitter() as ReturnType<BootSpawn>;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      return true;
    };
    const code = command === failCommand ? 1 : 0;
    queueMicrotask(() => child.emit("close", code));
    return child;
  };
  return { spawn, calls };
}

describe("boot schema", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs drizzle-kit push --force only after pg_dump succeeds", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-boot-"));
    const ok = fakeSpawn();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const schemaPath = path.join(dir, "schema.ts");
    await writeFile(schemaPath, "export const schema = 1;\n");
    const result = await runBootSchema({
      backupDir: dir,
      databaseUrl: "postgres://local/packpts",
      now: new Date("2026-09-25T20:00:00.000Z"),
      spawn: ok.spawn,
      schemaPath,
      markerPath: path.join(dir, ".schema-push-hash"),
    });
    expect(result.pushed).toBe(true);
    expect(ok.calls[0][0]).toBe("pg_dump");
    expect(ok.calls[0]).toContain("--format=custom");
    expect(ok.calls[1]).toEqual(["npx", "drizzle-kit", "push", "--force"]);
    expect((await readdir(dir)).some((name) => name.startsWith("pre-push-"))).toBe(true);

    const failedDir = await mkdtemp(path.join(tmpdir(), "packpts-boot-fail-"));
    const failedSchema = path.join(failedDir, "schema.ts");
    await writeFile(failedSchema, "export const schema = 2;\n");
    const failed = fakeSpawn("pg_dump");
    const skipped = await runBootSchema({
      backupDir: failedDir,
      databaseUrl: "postgres://local/packpts",
      now: new Date("2026-09-25T20:01:00.000Z"),
      spawn: failed.spawn,
      schemaPath: failedSchema,
      markerPath: path.join(failedDir, ".schema-push-hash"),
    });
    expect(skipped.pushed).toBe(false);
    expect(failed.calls.map((call) => call[0])).toEqual(["pg_dump"]);
  });

  it("skips pg_dump when the schema hash matches and still runs drizzle-kit push", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-hash-"));
    const schemaPath = path.join(dir, "schema.ts");
    const markerPath = path.join(dir, ".schema-push-hash");
    await writeFile(schemaPath, "export const schema = 1;\n");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = fakeSpawn();
    const pushed = await runBootSchema({
      backupDir: dir,
      databaseUrl: "postgres://local/packpts",
      spawn: first.spawn,
      schemaPath,
      markerPath,
    });
    expect(pushed.dumped).toBe(true);
    expect(pushed.pushed).toBe(true);
    expect(schemaDumpRequired("abc", "abc")).toBe(false);
    expect(schemaDumpRequired("abc", null)).toBe(true);

    const second = fakeSpawn();
    const again = await runBootSchema({
      backupDir: dir,
      databaseUrl: "postgres://local/packpts",
      spawn: second.spawn,
      schemaPath,
      markerPath,
    });
    expect(again.dumped).toBe(false);
    expect(again.pushed).toBe(true);
    expect(second.calls.map((call) => call[0])).toEqual(["npx"]);
    expect(second.calls[0]).toEqual(["npx", "drizzle-kit", "push", "--force"]);
    expect((await readFile(markerPath, "utf8")).trim().length).toBeGreaterThan(10);

    await writeFile(schemaPath, "export const schema = 2;\n");
    const third = fakeSpawn("pg_dump");
    const changed = await runBootSchema({
      backupDir: dir,
      databaseUrl: "postgres://local/packpts",
      spawn: third.spawn,
      schemaPath,
      markerPath,
    });
    expect(changed.dumped).toBe(true);
    expect(changed.pushed).toBe(false);
    expect(third.calls.map((call) => call[0])).toEqual(["pg_dump"]);
  });

  it("keeps the 14 newest boot dumps", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-dumps-"));
    for (let i = 0; i < 16; i += 1) {
      const name = path.join(dir, `pre-push-20260925T2000${String(i).padStart(2, "0")}Z.dump`);
      await writeFile(name, "x");
      const when = new Date(2026, 8, 25, 20, 0, i);
      await utimes(name, when, when);
    }
    await pruneBootDumps(dir, 14);
    const left = (await readdir(dir)).filter((name) => name.endsWith(".dump"));
    expect(left).toHaveLength(14);
    expect(left.some((name) => name.includes("200000"))).toBe(false);
  });

  it("kills a hung pg_dump and skips the push, and exits when the push hangs", async () => {
    expect(PG_DUMP_TIMEOUT_MS).toBe(90_000);
    expect(DRIZZLE_PUSH_TIMEOUT_MS).toBe(120_000);
    expect(STORAGE_INIT_TIMEOUT_MS).toBe(60_000);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const hang = (hangCommand: string) => {
      const calls: string[][] = [];
      const killed: string[] = [];
      const spawn: BootSpawn = (command, args) => {
        calls.push([command, ...args]);
        if (command === "pg_dump" && hangCommand !== "pg_dump") {
          const fileArg = args.find((arg) => arg.startsWith("--file="));
          if (fileArg) writeFileSync(fileArg.slice("--file=".length), "dump");
        }
        const child = new EventEmitter() as ReturnType<BootSpawn>;
        child.killed = false;
        child.kill = ((signal?: NodeJS.Signals | number) => {
          child.killed = true;
          killed.push(String(signal ?? "SIGTERM"));
          return true;
        }) as ReturnType<BootSpawn>["kill"];
        if (command !== hangCommand) queueMicrotask(() => child.emit("close", 0));
        return child;
      };
      return { spawn, calls, killed };
    };

    const dumpDir = await mkdtemp(path.join(tmpdir(), "packpts-dump-hang-"));
    const dumpSchema = path.join(dumpDir, "schema.ts");
    await writeFile(dumpSchema, "export const schema = 1;\n");
    const dumpHang = hang("pg_dump");
    const exit = vi.fn();
    const dumped = await runBootSchema({
      backupDir: dumpDir,
      databaseUrl: "postgres://local/packpts",
      spawn: dumpHang.spawn,
      schemaPath: dumpSchema,
      markerPath: path.join(dumpDir, ".schema-push-hash"),
      dumpTimeoutMs: 30,
      exit,
    });
    expect(dumped.pushed).toBe(false);
    expect(dumped.dumped).toBe(true);
    expect(dumpHang.killed).toEqual(["SIGKILL"]);
    expect(dumpHang.calls.map((call) => call[0])).toEqual(["pg_dump"]);
    expect(exit).not.toHaveBeenCalled();

    const pushDir = await mkdtemp(path.join(tmpdir(), "packpts-push-hang-"));
    const pushSchema = path.join(pushDir, "schema.ts");
    const pushMarker = path.join(pushDir, ".schema-push-hash");
    await writeFile(pushSchema, "export const schema = 1;\n");
    const pushHang = hang("npx");
    const pushExit = vi.fn();
    const pushed = await runBootSchema({
      backupDir: pushDir,
      databaseUrl: "postgres://local/packpts",
      spawn: pushHang.spawn,
      schemaPath: pushSchema,
      markerPath: pushMarker,
      pushTimeoutMs: 30,
      exit: pushExit,
    });
    expect(pushed.pushed).toBe(false);
    expect(pushExit).toHaveBeenCalledWith(1);
    expect(pushHang.killed).toEqual(["SIGKILL"]);
    expect(pushHang.calls.map((call) => call[0])).toEqual(["pg_dump", "npx"]);
    await expect(readFile(pushMarker, "utf8")).rejects.toThrow();

    const quietDir = await mkdtemp(path.join(tmpdir(), "packpts-push-quiet-"));
    const quietSchema = path.join(quietDir, "schema.ts");
    const quietMarker = path.join(quietDir, ".schema-push-hash");
    await writeFile(quietSchema, "export const schema = 1;\n");
    const seenEnv: Array<string | undefined> = [];
    const quietSpawn: BootSpawn = (command, args, env) => {
      seenEnv.push(env?.DATABASE_URL);
      if (command === "pg_dump") {
        const fileArg = args.find((arg) => arg.startsWith("--file="));
        if (fileArg) writeFileSync(fileArg.slice("--file=".length), "dump");
      }
      const child = new EventEmitter() as ReturnType<BootSpawn>;
      child.killed = false;
      child.kill = () => true;
      queueMicrotask(() => child.emit("close", command === "npx" ? 1 : 0));
      return child;
    };
    const quietExit = vi.fn();
    const background = await runBootSchema({
      backupDir: quietDir,
      databaseUrl: "postgres://local/packpts",
      spawn: quietSpawn,
      schemaPath: quietSchema,
      markerPath: quietMarker,
      exit: quietExit,
      exitOnPushFailure: false,
      lockTimeout: "3s",
    });
    expect(background.pushed).toBe(false);
    expect(quietExit).not.toHaveBeenCalled();
    expect(seenEnv[1]).toBe(withSessionLockTimeout("postgres://local/packpts", "3s"));
    expect(withSessionLockTimeout("postgres://local/packpts?sslmode=require", "3s")).toContain("sslmode=require");
    expect(withSessionLockTimeout("postgres://local/packpts?sslmode=require", "3s")).toContain("lock_timeout%3D3s");
    const fatal = vi.mocked(console.error).mock.calls.map((args) => String(args[0])).join("\n");
    expect(fatal).toContain("Not exiting");
    await writeFile(quietMarker, "stale-success\n");
    const cleared = await runBootSchema({
      backupDir: quietDir,
      databaseUrl: "postgres://local/packpts",
      spawn: quietSpawn,
      schemaPath: quietSchema,
      markerPath: quietMarker,
      exit: quietExit,
      exitOnPushFailure: false,
      lockTimeout: "3s",
    });
    expect(cleared.pushed).toBe(false);
    expect(quietExit).not.toHaveBeenCalled();
    await expect(readFile(quietMarker, "utf8")).rejects.toThrow();

    const timeoutDir = await mkdtemp(path.join(tmpdir(), "packpts-push-bg-timeout-"));
    const timeoutSchema = path.join(timeoutDir, "schema.ts");
    const timeoutMarker = path.join(timeoutDir, ".schema-push-hash");
    await writeFile(timeoutSchema, "export const schema = 1;\n");
    await writeFile(timeoutMarker, "stale-success\n");
    const timeoutHang = hang("npx");
    const timeoutExit = vi.fn();
    const timedOut = await runBootSchema({
      backupDir: timeoutDir,
      databaseUrl: "postgres://local/packpts",
      spawn: timeoutHang.spawn,
      schemaPath: timeoutSchema,
      markerPath: timeoutMarker,
      pushTimeoutMs: 30,
      exit: timeoutExit,
      exitOnPushFailure: false,
    });
    expect(timedOut.pushed).toBe(false);
    expect(timedOut.timedOut).toBe(true);
    expect(timeoutExit).not.toHaveBeenCalled();
    await expect(readFile(timeoutMarker, "utf8")).rejects.toThrow();

    vi.useFakeTimers();
    const hung = withStartupTimeout(new Promise<void>(() => {}), STORAGE_INIT_TIMEOUT_MS, "storage setup");
    const timeout = expect(hung).rejects.toBeInstanceOf(StartupTimeoutError);
    await vi.advanceTimersByTimeAsync(STORAGE_INIT_TIMEOUT_MS);
    await timeout;
    vi.useRealTimers();
  });

  it("starts schema children detached so one signal kills the process group", () => {
    const src = readFileSync(path.join(dirname(fileURLToPath(import.meta.url)), "../startup/bootSchema.ts"), "utf8");
    expect(src).toContain("detached: true");
    expect(src).toContain("process.kill(-pid, signal)");
    expect(src).toContain('killChildGroup(activeChild, "SIGTERM")');
    expect(src).toContain('killChildGroup(child, "SIGKILL")');
  });

  it("SIGTERM kills the push child and the grandchild it spawned", async () => {
    const marker = path.join(tmpdir(), `packpts-group-${process.pid}-${Date.now()}`);
    const child = spawn(process.execPath, ["-e", `
      const { spawn } = require("child_process");
      const fs = require("fs");
      const grand = spawn("sleep", ["60"], { stdio: "ignore" });
      fs.writeFileSync(${JSON.stringify(marker)}, String(grand.pid));
      setInterval(() => {}, 1000);
    `], { detached: true, stdio: "ignore" });
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      let grandPid = 0;
      const started = Date.now();
      while (Date.now() - started < 2000) {
        try {
          grandPid = Number((await readFile(marker, "utf8")).trim());
          if (grandPid > 0) break;
        } catch {
          // file not written yet
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(grandPid).toBeGreaterThan(0);
      expect(alive(child.pid!)).toBe(true);
      expect(alive(grandPid)).toBe(true);
      killChildGroup(child, "SIGTERM");
      const stopped = Date.now();
      while (Date.now() - stopped < 2000 && (alive(child.pid!) || alive(grandPid))) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(alive(child.pid!)).toBe(false);
      expect(alive(grandPid)).toBe(false);
    } finally {
      try { killChildGroup(child, "SIGKILL"); } catch { /* already gone */ }
    }
  });
});
