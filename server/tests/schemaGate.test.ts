import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import express from "express";
import http from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { maskToken } from "../services/playImageToken";
import { registerVersionRoute } from "../lib/versionRoute";
import { markSchemaReady, resetSchemaGateForTests, schemaGateMiddleware, schemaGateServesWarmMask } from "../startup/schemaGate";
import { setWarmMaskDirForTests } from "../startup/warmMaskGate";

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

  it("serves a warm masked JPEG during the schema window and keeps reveal closed", async () => {
    resetSchemaGateForTests();
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-warm-"));
    const cardId = "card-warm-1";
    await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.ok`), "ok\n");
    setWarmMaskDirForTests(dir);
    const token = maskToken("solo", "session-1", 0, cardId);
    const warm = await fetch(`${base}/api/play/m/solo/session-1/0/${token}`);
    expect(warm.status).toBe(200);
    expect(warm.headers.get("x-mask-cache")).toBe("hit");
    expect(warm.headers.get("content-type")).toContain("image/jpeg");
    const unmarkedDir = await mkdtemp(path.join(tmpdir(), "packpts-warm-unmarked-"));
    await writeFile(path.join(unmarkedDir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    setWarmMaskDirForTests(unmarkedDir);
    const unmarked = await fetch(`${base}/api/play/m/solo/session-1/0/${token}`);
    expect(unmarked.status).toBe(503);
    expect(unmarked.headers.get("content-type") || "").not.toContain("text/html");
    setWarmMaskDirForTests(dir);
    const miss = await fetch(`${base}/api/play/m/solo/session-1/0/not-the-token`);
    expect(miss.status).toBe(503);
    expect(miss.headers.get("retry-after")).toBe("2");
    const reveal = await fetch(`${base}/api/play/r/solo/session-1/0/1/token`);
    expect(reveal.status).toBe(503);
    const raw = await fetch(`${base}/api/images/card/${cardId}`);
    expect(raw.status).toBe(503);
    expect(schemaGateServesWarmMask("GET", `/api/play/m/solo/session-1/0/${token}`)).toBe(true);
    expect(schemaGateServesWarmMask("GET", `/api/play/r/solo/session-1/0/1/token`)).toBe(false);
    setWarmMaskDirForTests(null);
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
