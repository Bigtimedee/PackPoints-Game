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

  it("unstretches a held 1986 scan, trims a dark frame, and crops a stamp off the margin", async () => {
    const stretched = await sharp({ create: { width: 800, height: 1400, channels: 3, background: { r: 180, g: 40, b: 40 } } }).jpeg().toBuffer();
    const gibson = await applyMaskSourceOverride("1cf53402-61f8-4fac-9aae-4fb7b9cf112e", stretched);
    const gibsonMeta = await sharp(gibson!).metadata();
    expect(gibsonMeta.width).toBe(800);
    expect(gibsonMeta.height).toBe(Math.round(800 * 3.5 / 2.5));
    expect(gibsonMeta.width! / gibsonMeta.height!).toBeGreaterThan(0.68);
    expect(gibsonMeta.width! / gibsonMeta.height!).toBeLessThan(0.76);

    const barelyTall = await sharp({ create: { width: 670, height: 1000, channels: 3, background: { r: 180, g: 40, b: 40 } } }).jpeg().toBuffer();
    const barely = await applyMaskSourceOverride("1cf53402-61f8-4fac-9aae-4fb7b9cf112e", barelyTall);
    const barelyMeta = await sharp(barely!).metadata();
    expect(barelyMeta.width).toBe(670);
    expect(barelyMeta.height).toBe(Math.round(670 * 3.5 / 2.5));
    const autograph = await applyMaskSourceOverride("93a3e9e6-3b14-41f0-a31f-9b3c3d192b85", barelyTall);
    const autographMeta = await sharp(autograph!).metadata();
    expect(autographMeta.width).toBe(670);
    expect(autographMeta.height).toBe(1000);

    const framed = await sharp({ create: { width: 800, height: 1100, channels: 3, background: { r: 8, g: 8, b: 8 } } }).jpeg().toBuffer();
    const card = await sharp({ create: { width: 760, height: 1060, channels: 3, background: { r: 210, g: 190, b: 150 } } }).png().toBuffer();
    const withFrame = await sharp(framed).composite([{ input: card, left: 20, top: 20 }]).jpeg().toBuffer();
    const murray = await applyMaskSourceOverride("8d0fc5e2-41ea-4428-a662-e9a059350599", withFrame);
    const murrayMeta = await sharp(murray!).metadata();
    expect(murrayMeta.width!).toBeLessThan(800);
    expect(murrayMeta.height!).toBeLessThan(1100);
    expect(murrayMeta.width! / murrayMeta.height!).toBeGreaterThan(0.66);

    const base = await sharp({ create: { width: 800, height: 1100, channels: 3, background: { r: 245, g: 245, b: 245 } } }).png().toBuffer();
    const noise = Buffer.alloc(740 * 1000 * 3);
    for (let i = 0; i < noise.length; i += 3) {
      const band = ((i / 3) % 17) * 8;
      noise[i] = 20 + (band % 40);
      noise[i + 1] = 80 + (band % 50);
      noise[i + 2] = 160;
    }
    const noisy = await sharp(noise, { raw: { width: 740, height: 1000, channels: 3 } }).png().toBuffer();
    const ink = await sharp({ create: { width: 90, height: 18, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
    const stamped = await sharp(base)
      .composite([{ input: noisy, left: 30, top: 50 }, { input: ink, left: 20, top: 8 }])
      .jpeg()
      .toBuffer();
    const cropped = await applyMaskSourceOverride("70676922-f57e-4e99-a0d5-f400422c9b0e", stamped);
    const croppedMeta = await sharp(cropped!).metadata();
    expect(croppedMeta.height!).toBeLessThan(1100);
    const { data, info } = await sharp(cropped!).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    expect(at(10, 4)).toBeLessThan(80);
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
