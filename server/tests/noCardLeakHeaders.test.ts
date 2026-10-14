import { describe, it, expect, afterAll } from "vitest";
import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import { noCardLeakHeaders, FORBIDDEN_PUBLIC_HEADER } from "../middleware/noCardLeakHeaders";

const FORBIDDEN = ["x-card-id", "x-mask-plan", "x-card-options", "x-card-name", "x-player-name", "x-answer"];

function serve() {
  const app = express();
  app.use(noCardLeakHeaders);
  const leaky = (_req: express.Request, res: express.Response) => {
    res.setHeader("X-Card-Id", "abc");
    res.setHeader("X-Mask-Plan", "{}");
    res.setHeader("X-Card-Options", "[\"A\"]");
    res.setHeader("X-Player-Name", "A");
    res.setHeader("X-Mask-Version", "v4.6");
    res.type("image/jpeg").end("x");
  };
  for (const p of ["/api/sets/:s/covers/:n", "/api/play/m/:a/:b/:c/:d", "/api/play/r/:a/:b/:c/:d/:e", "/api/cards/:id/image", "/api/qa/cover-image/:id"]) app.get(p, leaky);
  const server = http.createServer(app);
  return new Promise<{ base: string; close: () => void }>((resolve) => server.listen(0, () => {
    const port = (server.address() as any).port;
    resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() });
  }));
}

describe("public image responses never expose card id, mask plan or names", async () => {
  const srv = await serve();
  afterAll(() => srv.close());
  for (const url of ["/api/sets/s/covers/0", "/api/play/m/solo/x/0/t", "/api/play/r/solo/x/0/1/t", "/api/cards/c/image"]) {
    it(`strips forbidden headers on ${url}`, async () => {
      const res = await fetch(srv.base + url);
      for (const h of FORBIDDEN) expect(res.headers.get(h)).toBeNull();
      expect(res.headers.get("x-mask-version")).toBe("v4.6");
    });
  }
  it("token-gated QA routes are unaffected", async () => {
    const res = await fetch(srv.base + "/api/qa/cover-image/c");
    expect(res.headers.get("x-card-id")).toBe("abc");
  });
  it("pattern covers every forbidden name", () => {
    for (const h of FORBIDDEN) expect(FORBIDDEN_PUBLIC_HEADER.test(h)).toBe(true);
    expect(FORBIDDEN_PUBLIC_HEADER.test("x-mask-version")).toBe(false);
  });
  it("public cover code no longer sets them and the middleware is mounted", () => {
    const covers = fs.readFileSync(path.join(__dirname, "../services/setCovers.ts"), "utf8");
    expect(covers).not.toMatch(/setHeader\("X-(Card-Id|Mask-Plan|Card-Options)"/);
    const index = fs.readFileSync(path.join(__dirname, "../index.ts"), "utf8");
    expect(index).toContain("app.use(noCardLeakHeaders);");
  });
});
