import path from "path";
import { logBootPhase } from "./bootPhase";
import {
  hashSchemaFile,
  readSchemaPushMarker,
  runBootSchema,
  SCHEMA_PUSH_MARKER,
} from "./bootSchema";
import { verifyLiveSchema, type SchemaVerifyResult } from "./schemaProbe";

/**
 * Background push lock budget. A no-op drizzle-kit 0.31 push only SELECTs
 * catalogs (AccessShareLock) and runs no DDL when sqlStatements is empty, so
 * it does not lock user tables or deadlock with live traffic. If the probe is
 * narrower than drizzle (defaults, FKs, nullability) and a statement is
 * emitted, ALTER TABLE takes ACCESS EXCLUSIVE and queues later SELECTs behind
 * it. lock_timeout makes that statement fail instead of stalling traffic.
 * Foreground pushes omit it so a real migration can wait.
 */
export const BACKGROUND_PUSH_LOCK_TIMEOUT = "3s";

export type SchemaBootMode = "fast_schema_ok" | "fast_schema_fallback";

export async function runSchemaGate(opts: {
  currentHash: string;
  storedHash: string | null;
  verify: () => Promise<SchemaVerifyResult>;
  push: (mode: "background" | "foreground") => Promise<{ pushed: boolean }>;
}): Promise<{ mode: SchemaBootMode; background: Promise<void> | null }> {
  if (opts.storedHash === opts.currentHash && opts.storedHash != null) {
    let verified: SchemaVerifyResult;
    try {
      verified = await opts.verify();
    } catch (err) {
      console.error("[Startup] schema probe failed:", err instanceof Error ? err.message : err);
      verified = { ok: false, reason: "probe_error" };
    }
    if (verified.ok) {
      logBootPhase("fast_schema_ok");
      const background = opts.push("background").then((result): void => {
        if (!result.pushed) {
          console.error("[Startup] FATAL: background drizzle-kit push did not apply. Not exiting. Restarting this container would not restore the previous deploy.");
        }
      }).catch((err) => {
        console.error("[Startup] FATAL: background drizzle-kit push crashed:", err instanceof Error ? err.message : err);
        console.error("[Startup] FATAL: Not exiting. Restarting this container would not restore the previous deploy.");
      });
      return { mode: "fast_schema_ok", background };
    }
    logBootPhase("fast_schema_fallback", { reason: verified.reason || "probe_failed" });
  } else {
    logBootPhase("fast_schema_fallback", { reason: "hash_mismatch" });
  }
  await opts.push("foreground");
  return { mode: "fast_schema_fallback", background: null };
}

/**
 * Hash match + probe: return while `drizzle-kit push --force` runs in the
 * background so the caller can open routes. Otherwise await the push first.
 * The push still runs on every production boot.
 */
export async function runProductionSchemaBoot(opts?: {
  schemaPath?: string;
  markerPath?: string;
  verify?: () => Promise<SchemaVerifyResult>;
  push?: (mode: "background" | "foreground") => Promise<{ pushed: boolean }>;
}): Promise<{ mode: SchemaBootMode; background: Promise<void> | null }> {
  const schemaPath = opts?.schemaPath ?? path.join(process.cwd(), "shared/schema.ts");
  const markerPath = opts?.markerPath ?? SCHEMA_PUSH_MARKER;
  const currentHash = await hashSchemaFile(schemaPath);
  const storedHash = await readSchemaPushMarker(markerPath);
  const verify = opts?.verify ?? (() => verifyLiveSchema());
  const push = opts?.push ?? (async (mode: "background" | "foreground") => {
    if (mode === "background") {
      return runBootSchema({
        schemaPath,
        markerPath,
        exitOnPushFailure: false,
        lockTimeout: BACKGROUND_PUSH_LOCK_TIMEOUT,
      });
    }
    return runBootSchema({ schemaPath, markerPath });
  });
  return runSchemaGate({ currentHash, storedHash, verify, push });
}
