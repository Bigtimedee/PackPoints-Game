import { describe, it, expect, afterAll } from "vitest";

describe("set list covers at boot", async () => {
  process.env.SET_COVER_CACHE = "1";
  const { readyMaskedCovers, setCoverWarmReadyForTests } = await import("../services/setCovers");
  afterAll(() => { delete process.env.SET_COVER_CACHE; });

  it("waits for the first mask-readiness pass instead of listing empty covers", async () => {
    setCoverWarmReadyForTests(false);
    let done = false;
    const p = readyMaskedCovers([]).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(done).toBe(false);
    setCoverWarmReadyForTests(true);
    await p;
    expect(done).toBe(true);
  });
});
