import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { DRAIN_TIMEOUT_MS } from "../startup/gracefulShutdown";
import { schemaGateBlocks } from "../startup/schemaGate";

const startSh = readFileSync(new URL("../../start.sh", import.meta.url), "utf8");
const railway = JSON.parse(readFileSync(new URL("../../railway.json", import.meta.url), "utf8")) as {
  deploy: Record<string, unknown>;
};
const entry = readFileSync(new URL("../entry.ts", import.meta.url), "utf8");
const boot = readFileSync(new URL("../startup/bootSchema.ts", import.meta.url), "utf8");
const indexSrc = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

describe("deploy gap", () => {
  it("skips a recursive chown when the mount root is already packpts", () => {
    expect(startSh).not.toContain("chown -R");
    expect(startSh).toContain("stat -c '%u'");
    expect(startSh).toContain("id -u packpts");
    expect(startSh).toContain("chown packpts:packpts");
    expect(startSh).toContain("exec env NODE_OPTIONS");
    expect(startSh).not.toMatch(/^[^#\n]*\bdrizzle-kit\b/m);
    expect(startSh).not.toMatch(/^[^#\n]*\bpg_dump\b/m);
  });

  it("listens before the schema push and keeps the push ahead of DB routes", () => {
    expect(entry).toContain("listening on");
    expect(entry.indexOf("httpServer.listen")).toBeLessThan(entry.indexOf('import("./index")'));
    expect(boot).toContain('["drizzle-kit", "push", "--force"]');
    expect(boot).toContain("pg_dump");
    expect(schemaGateBlocks("/api/game/start")).toBe(true);
    expect(schemaGateBlocks("/api/version")).toBe(false);
    expect(schemaGateBlocks("/game/solo")).toBe(false);
  });

  it("logs each boot phase with a timestamp", () => {
    expect(startSh).toContain("phase=container_alive ts=");
    expect(startSh).toContain("phase=exec_node ts=");
    expect(entry).toContain("mountSchemaWindowSpa");
    expect(entry).not.toContain("serveStatic");
    expect(entry).not.toContain("staticMounted");
    const routesAt = indexSrc.indexOf("await registerRoutes");
    const staticAt = indexSrc.indexOf("serveStatic(app)");
    expect(routesAt).toBeGreaterThan(-1);
    expect(staticAt).toBeGreaterThan(routesAt);
    expect(indexSrc).toContain("STORAGE_INIT_TIMEOUT_MS");
    expect(boot).toContain("PG_DUMP_TIMEOUT_MS");
    expect(boot).toContain("DRIZZLE_PUSH_TIMEOUT_MS");
    expect(entry).toContain('logBootPhase("listen"');
    expect(boot).toContain('logBootPhase("pg_dump_start")');
    expect(boot).toContain('logBootPhase("pg_dump_end"');
    expect(boot).toContain('logBootPhase("drizzle_push_start")');
    expect(boot).toContain('logBootPhase("drizzle_push_end"');
    expect(indexSrc).toContain('logBootPhase("routes_ready")');
  });

  it("sets a health check and drain without overlap while the volume exists", () => {
    expect(railway.deploy.healthcheckPath).toBe("/api/version");
    expect(railway.deploy.healthcheckTimeout).toBe(120);
    expect(railway.deploy.drainingSeconds).toBe(30);
    expect(railway.deploy.overlapSeconds).toBeUndefined();
    expect(DRAIN_TIMEOUT_MS).toBeLessThanOrEqual(25_000);
  });
});
