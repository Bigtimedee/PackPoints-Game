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

  it("unstretches a changed 705x1200 held scan, trims a dark frame, and covers a stamp", async () => {
    const stretched = await sharp({ create: { width: 705, height: 1200, channels: 3, background: { r: 180, g: 40, b: 40 } } }).jpeg().toBuffer();
    const sheets = await applyMaskSourceOverride("fc440551-583f-447c-b69d-d427475c0cb3", stretched);
    const sheetsMeta = await sharp(sheets!).metadata();
    expect([sheetsMeta.width, sheetsMeta.height]).toEqual([705, 987]);
    expect(sheetsMeta.width! / sheetsMeta.height!).toBeGreaterThan(0.68);
    expect(sheetsMeta.width! / sheetsMeta.height!).toBeLessThan(0.76);

    const framed = await sharp({ create: { width: 800, height: 1100, channels: 3, background: { r: 200, g: 180, b: 140 } } })
      .composite([{ input: await sharp({ create: { width: 800, height: 1100, channels: 3, background: { r: 8, g: 8, b: 8 } } }).png().toBuffer(), left: 0, top: 0 }])
      .jpeg().toBuffer();
    const card = await sharp({ create: { width: 760, height: 1060, channels: 3, background: { r: 210, g: 190, b: 150 } } }).png().toBuffer();
    const withFrame = await sharp(framed).composite([{ input: card, left: 20, top: 20 }]).jpeg().toBuffer();
    const hershiser = await applyMaskSourceOverride("09f331ef-1fcb-45da-be6f-9e41a0090f30", withFrame);
    const hershiserMeta = await sharp(hershiser!).metadata();
    expect(hershiserMeta.width!).toBeLessThan(800);
    expect(hershiserMeta.height!).toBeLessThan(1100);
    expect(hershiserMeta.width! / hershiserMeta.height!).toBeGreaterThan(0.66);

    const banner = await sharp({ create: { width: 800, height: 1100, channels: 3, background: { r: 20, g: 80, b: 160 } } }).jpeg().toBuffer();
    const ink = await sharp({ create: { width: 220, height: 70, channels: 3, background: { r: 250, g: 250, b: 250 } } }).png().toBuffer();
    const stamped = await sharp(banner).composite([{ input: ink, left: 16, top: 16 }]).jpeg().toBuffer();
    const covered = await applyMaskSourceOverride("70676922-f57e-4e99-a0d5-f400422c9b0e", stamped);
    const { data, info } = await sharp(covered!).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [data[(y * info.width + x) * info.channels], data[(y * info.width + x) * info.channels + 2]];
    expect(at(40, 40)[0]).toBeLessThan(80);
    expect(at(40, 40)[1]).toBeGreaterThan(100);
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
