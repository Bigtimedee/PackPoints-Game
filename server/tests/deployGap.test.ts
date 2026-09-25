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

  it("sets a health check and drain without overlap while the volume exists", () => {
    expect(railway.deploy.healthcheckPath).toBe("/api/version");
    expect(railway.deploy.healthcheckTimeout).toBe(120);
    expect(railway.deploy.drainingSeconds).toBe(30);
    expect(railway.deploy.overlapSeconds).toBeUndefined();
    expect(DRAIN_TIMEOUT_MS).toBeLessThanOrEqual(25_000);
  });
});
