/**
 * Document and version responses must not be reusable from a browser cache,
 * a conditional 304, or the Railway edge. Hashed /assets/* stay immutable.
 */
import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSET_CACHE_CONTROL, NO_STORE_CACHE_CONTROL } from "../lib/noStoreResponse";
import { mountSpaStatic } from "../static";
import { registerVersionRoute } from "../lib/versionRoute";

describe("deploy cache headers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packpts-static-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><meta name="packpts-build-id" content="abc123" /><title>PackPTS</title>`,
  );
  fs.writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log(1)\n");

  const app = express();
  registerVersionRoute(app);
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
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function read(pathname: string, init?: RequestInit) {
    const res = await fetch(`${base}${pathname}`, init);
    const text = await res.text();
    return { res, text };
  }

  it("sends no-store on /api/version and still returns a body for conditional requests", async () => {
    const first = await read("/api/version");
    expect(first.res.status).toBe(200);
    expect(first.res.headers.get("cache-control")).toBe(NO_STORE_CACHE_CONTROL);
    expect(first.res.headers.get("etag")).toBeNull();
    expect(first.res.headers.get("last-modified")).toBeNull();
    expect(first.res.headers.get("cdn-cache-control")).toBe("no-store");
    expect(first.res.headers.get("surrogate-control")).toBe("no-store");
    const body = JSON.parse(first.text) as { buildId?: string };
    expect(body.buildId).toBeTruthy();

    const second = await read("/api/version", {
      headers: {
        "If-None-Match": 'W/"8b-stale"',
        "If-Modified-Since": "Tue, 15 Nov 1994 12:45:26 GMT",
      },
    });
    expect(second.res.status).toBe(200);
    expect(second.res.headers.get("cache-control")).toContain("no-store");
    expect(second.res.headers.get("etag")).toBeNull();
    expect(JSON.parse(second.text).buildId).toBe(body.buildId);
  });

  it("sends no-store HTML for / and an SPA route, with no 304", async () => {
    for (const pathname of ["/", "/game/solo"]) {
      const first = await read(pathname);
      expect(first.res.status).toBe(200);
      expect(first.res.headers.get("content-type")).toContain("text/html");
      expect(first.res.headers.get("cache-control")).toBe(NO_STORE_CACHE_CONTROL);
      expect(first.res.headers.get("etag")).toBeNull();
      expect(first.res.headers.get("last-modified")).toBeNull();
      expect(first.res.headers.get("cdn-cache-control")).toBe("no-store");
      expect(first.text).toContain('name="packpts-build-id"');

      const second = await read(pathname, {
        headers: {
          "If-None-Match": 'W/"1a21-old"',
          "If-Modified-Since": "Fri, 25 Sep 2026 18:15:24 GMT",
        },
      });
      expect(second.res.status).toBe(200);
      expect(second.text).toContain("abc123");
      expect(second.res.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("keeps hashed /assets/* immutable", async () => {
    const asset = await read("/assets/index-abc123.js");
    expect(asset.res.status).toBe(200);
    expect(asset.res.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
    expect(asset.text).toContain("console.log");
  });
});
