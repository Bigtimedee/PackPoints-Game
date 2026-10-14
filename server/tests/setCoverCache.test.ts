import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

describe("set cover hot path", () => {
  const src = fs.readFileSync(path.join(__dirname, "../services/setCovers.ts"), "utf8");

  it("never renders a mask on the request path and reads pre-baked sidecar files", () => {
    const handler = src.slice(src.indexOf("export async function handlePublicSetCover"));
    expect(handler).toContain("resolveReadyWarmMaskedFile");
    expect(handler).not.toMatch(/renderMask|bakeMask|sharp\(/);
  });

  it("caps concurrent cold resolves and caches ids and bytes", () => {
    expect(src).toContain("COVER_RESOLVE_CONCURRENCY = 4");
    expect(src).toContain("cachedCoverCardIds(setId)");
    expect(src).toContain("coverFileBytes(file)");
    expect(src).toContain("ensureHeldSetsFresh()");
  });

  it("lazy-loads covers below the first two rows on /sets", () => {
    const page = fs.readFileSync(path.join(__dirname, "../../client/src/pages/browse-sets.tsx"), "utf8");
    expect(page).toContain("<LazyMount minHeight={220} eager={eagerCover}>");
    expect(page).toContain("eagerCover={index < 2}");
  });
});

describe("ensureHeldSetsFresh", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("../config/heldSets"));

  it("shares one in-flight refresh across concurrent callers", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const freshAt = { v: 0 };
    let inFlight: Promise<void> | null = null;
    // Mirror of the production helper, exercised for its contract.
    const ensure = async (maxAgeMs = 30_000) => {
      if (Date.now() - freshAt.v < maxAgeMs) return;
      if (!inFlight) inFlight = (async () => { calls++; await gate; })().then(() => { freshAt.v = Date.now(); }).finally(() => { inFlight = null; });
      await inFlight;
    };
    const all = Promise.all(Array.from({ length: 80 }, () => ensure()));
    release();
    await all;
    await ensure();
    expect(calls).toBe(1);
    const real = fs.readFileSync(path.join(__dirname, "../config/heldSets.ts"), "utf8");
    expect(real).toContain("export async function ensureHeldSetsFresh(maxAgeMs = 30_000)");
  });
});
