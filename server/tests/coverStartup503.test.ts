import { describe, it, expect, afterAll } from "vitest";
import express from "express";
import http from "http";

describe("cover startup window", async () => {
  process.env.SET_COVER_CACHE = "1";
  const { handlePublicSetCover, setCoverWarmReadyForTests } = await import("../services/setCovers");
  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => { void handlePublicSetCover(req, res); });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  afterAll(() => { server.close(); delete process.env.SET_COVER_CACHE; });
  const url = `${base}/api/sets/00000000-0000-4000-8000-000000000000/covers/99`;

  it("a not-ready cover is 503 with Retry-After before the first warm pass, never 404", async () => {
    setCoverWarmReadyForTests(false);
    const res = await fetch(url);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
  });

  it("is 404 once the warm pass has run", async () => {
    setCoverWarmReadyForTests(true);
    const res = await fetch(url);
    expect(res.status).toBe(404);
  });
});
