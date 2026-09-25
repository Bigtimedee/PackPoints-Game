import express from "express";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import http from "http";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assetNotFoundLine, isAssetNotFound, logServerError } from "../lib/httpErrorLog";
import { mountSpaStatic } from "../static";

describe("asset 404 log", () => {
  it("is one line and does not include a stack", () => {
    const line = assetNotFoundLine("GET", "/assets/Game-abc123.js");
    expect(line).toBe("[Static] 404 GET /assets/Game-abc123.js");
    expect(line).not.toContain("Error");
    expect(isAssetNotFound({ status: 404, code: "ENOENT" }, "/assets/Game-abc123.js")).toBe(true);
    expect(isAssetNotFound({ status: 404 }, "/api/version")).toBe(false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("ENOENT, stat '/assets/missing.js'"), { status: 404, code: "ENOENT" });
    logServerError(error, { method: "GET", originalUrl: "/assets/missing.js" });
    expect(log).toHaveBeenCalledWith("[Static] 404 GET /assets/missing.js");
    expect(err).not.toHaveBeenCalled();
    log.mockRestore();
    err.mockRestore();
  });

  const dir = mkdtempSync(path.join(tmpdir(), "packpts-assets-"));
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>PackPTS</title>");
  writeFileSync(path.join(dir, "assets", "index-C5vKUtP0.js"), "console.log(1)\n");
  const app = express();
  mountSpaStatic(app, dir);
  const server = http.createServer(app);
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns 404 for a missing hashed asset without an error stack", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await fetch(`${base}/assets/missing-chunk.js`);
    expect(res.status).toBe(404);
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line === "[Static] 404 GET /assets/missing-chunk.js")).toBe(true);
    expect(err).not.toHaveBeenCalled();
    log.mockRestore();
    err.mockRestore();
  });
});
