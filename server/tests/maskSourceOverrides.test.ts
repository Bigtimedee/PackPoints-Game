import { describe, expect, it, afterEach } from "vitest";
import { createHash } from "crypto";
import sharp from "sharp";
import { applyMaskSourceOverride, maskSourceOverrideDigest, maskSourceOverrides, setMaskSourceOverridesForTests } from "../masking/maskSourceOverrides";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("mask source overrides", () => {
  afterEach(() => setMaskSourceOverridesForTests(null));

  it("passes a card with no override through unchanged", async () => {
    setMaskSourceOverridesForTests({});
    const raw = Buffer.from("x");
    expect(await applyMaskSourceOverride("none", raw)).toBe(raw);
  });

  it("crops and resizes when the upstream bytes match, and fails closed when they changed", async () => {
    const raw = await sharp({ create: { width: 100, height: 160, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
    setMaskSourceOverridesForTests({
      c1: { setId: "s", number: "1", player: "P", inputSha256: sha(raw), extract: { left: 10, top: 10, width: 80, height: 140 }, resize: { width: 80, height: 112 }, why: "t" },
    });
    const out = await applyMaskSourceOverride("c1", raw);
    const meta = await sharp(out!).metadata();
    expect([meta.width, meta.height]).toEqual([80, 112]);
    expect(await applyMaskSourceOverride("c1", Buffer.concat([raw, Buffer.from([0])]))).toBeNull();
  });

  it("checked-in manifest: only 1988/1986 Topps, sane boxes, digest per set", () => {
    const m = maskSourceOverrides();
    const sets = new Set(Object.values(m).map((o) => o.setId));
    expect([...sets].sort()).toEqual(["2b77043a-6583-4d79-b59d-d2ab20291a17", "affd57b8-2b1d-4ea3-9f51-1530d8088e5c"]);
    for (const o of Object.values(m)) {
      expect(o.inputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(o.extract || o.resize).toBeTruthy();
      const w = o.resize?.width ?? o.extract!.width, h = o.resize?.height ?? o.extract!.height;
      expect(w / h).toBeGreaterThan(0.68);
      expect(w / h).toBeLessThan(0.76);
    }
    expect(maskSourceOverrideDigest("affd57b8-2b1d-4ea3-9f51-1530d8088e5c")).toHaveLength(16);
    expect(maskSourceOverrideDigest("other")).toBe("");
  });
});
