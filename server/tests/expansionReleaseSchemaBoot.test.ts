/**
 * Cold and production-like boots must create expansion_release_manifests
 * before any release consumer runs. An empty manifest releases nothing.
 */
import { spawn } from "child_process";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  compareSchema,
  expectedSchemaFromDrizzle,
  liveSchemaFromProbe,
  SCHEMA_PROBE_SQL,
  verifyLiveSchema,
} from "../startup/schemaProbe";

const DB_NAME = "packpoints_release_boot";
const ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const BOOT_URL = `postgresql://postgres:postgres@127.0.0.1:5432/${DB_NAME}`;

function pushSchema(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["drizzle-kit", "push", "--force"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: BOOT_URL },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (chunk) => { err += String(chunk); });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`drizzle-kit push exited ${code}: ${err.slice(-500)}`));
    });
  });
}

async function admin(sql: string): Promise<void> {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function withBoot<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: BOOT_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function probe(client: Client) {
  return verifyLiveSchema(async (statement) => {
    const result = await client.query(statement);
    return result.rows[0]?.probe;
  });
}

describe("expansion release schema boot", () => {
  afterAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  });

  it("creates the release tables on an empty database before a consumer can read them", async () => {
    await admin(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin(`CREATE DATABASE ${DB_NAME}`);
    const before = await withBoot(async (client) => {
      const verified = await probe(client);
      const present = await client.query<{ name: string | null }>(
        `SELECT to_regclass('public.expansion_release_manifests')::text AS name`,
      );
      return { verified, present: present.rows[0]?.name ?? null };
    });
    expect(before.verified.ok).toBe(false);
    expect(before.verified.reason).toContain("missing_table:");
    expect(before.present).toBeNull();
    await pushSchema();
    const after = await withBoot((client) => probe(client));
    expect(after.ok).toBe(true);
    expect(after.reason).not.toContain("expansion_release_manifests");
    const released = await withBoot(async (client) => {
      const tables = await client.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname IN ('expansion_release_manifests', 'expansion_release_members', 'uq_expansion_release_active', 'uq_expansion_release_version')`,
      );
      const rows = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM expansion_release_manifests WHERE revoked_at IS NULL");
      return { names: tables.rows.map((row) => row.relname).sort(), active: rows.rows[0]?.n ?? -1 };
    });
    expect(released.names).toEqual([
      "expansion_release_manifests",
      "expansion_release_members",
      "uq_expansion_release_active",
      "uq_expansion_release_version",
    ]);
    expect(released.active).toBe(0);
  }, 180000);

  it("adds the release tables to a database that already has the older schema", async () => {
    const missing = await withBoot(async (client) => {
      await client.query("DROP TABLE IF EXISTS expansion_release_members");
      await client.query("DROP TABLE IF EXISTS expansion_release_manifests");
      return probe(client);
    });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toContain("missing_table:expansion_release_manifests");
    await pushSchema();
    const restored = await withBoot(async (client) => {
      const verified = await probe(client);
      const rows = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM expansion_release_manifests");
      return { verified, n: rows.rows[0]?.n ?? -1 };
    });
    expect(restored.verified.ok).toBe(true);
    expect(restored.n).toBe(0);
    const expected = expectedSchemaFromDrizzle();
    expect(expected.tables.some((table) => table.name === "expansion_release_manifests")).toBe(true);
    expect(compareSchema(expected, liveSchemaFromProbe({ columns: [], indexes: [] })).ok).toBe(false);
    expect(SCHEMA_PROBE_SQL).toContain("information_schema.columns");
  }, 180000);
});
