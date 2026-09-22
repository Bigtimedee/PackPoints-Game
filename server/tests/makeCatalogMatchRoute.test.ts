import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function handlerSlice(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  const next = src.indexOf("\n  app.", start + signature.length);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("catalog-match routes do not write playable cards or sets", () => {
  const routes = read("server/routes.ts");
  const service = read("server/services/catalogMatch.ts");

  it("identify and match handlers never insert", () => {
    const identify = handlerSlice(routes, 'app.post("/api/make/identify"');
    const match = handlerSlice(routes, 'app.get("/api/make/match"');
    for (const slice of [identify, match]) {
      expect(slice).not.toMatch(/\.insert\(/);
      expect(slice).not.toContain("playableCards");
      expect(slice).not.toContain("cardPhotos");
      expect(slice).not.toContain("gameSets");
    }
    expect(identify).toContain("identifyAndMatchReadOnly");
    expect(match).toContain("matchCatalogCardById");
    expect(service).not.toMatch(/\.insert\(/);
    expect(service).toContain("eq(gameSets.isUserCreated, false)");
    expect(service).toContain("eq(gameSets.isActive, true)");
    expect(service).not.toMatch(/isUserCreated:\s*true/);
  });

  it("POST /api/sets/create is closed for everyone, including staff", () => {
    const create = handlerSlice(routes, 'app.post("/api/sets/create"');
    expect(create).toContain("USER_SET_PUBLISH_CLOSED");
    expect(create).not.toMatch(/\.insert\(/);
    expect(create).not.toContain("requireAdmin");
    expect(create).not.toContain("isUserCreated: true");
    expect(create).not.toContain("playableCards");
  });

  it("legacy identify-card does not store user media", () => {
    const legacy = handlerSlice(routes, 'app.post("/api/sets/identify-card"');
    expect(legacy).not.toMatch(/\.insert\(/);
    expect(legacy).not.toContain("cardPhotos");
    expect(legacy).not.toContain("playableCards");
  });
});
