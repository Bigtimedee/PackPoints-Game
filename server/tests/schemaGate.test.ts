import express from "express";
import http from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerVersionRoute } from "../lib/versionRoute";
import { markSchemaReady, resetSchemaGateForTests, schemaGateMiddleware } from "../startup/schemaGate";

describe("schema gate", () => {
  const app = express();
  registerVersionRoute(app);
  app.use(schemaGateMiddleware);
  app.get("/api/game/start", (_req, res) => {
    res.json({ ok: true });
  });
  const server = http.createServer(app);
  let base = "";

  beforeAll(async () => {
    resetSchemaGateForTests();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    resetSchemaGateForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("serves /api/version and 503s DB routes until the schema step finishes", async () => {
    const version = await fetch(`${base}/api/version`);
    expect(version.status).toBe(200);
    const blocked = await fetch(`${base}/api/game/start`);
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("retry-after")).toBe("2");
    markSchemaReady();
    const open = await fetch(`${base}/api/game/start`);
    expect(open.status).toBe(200);
  });
});
