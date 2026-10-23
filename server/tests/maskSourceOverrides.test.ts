import { describe, expect, it, afterEach } from "vitest";
import { createHash } from "crypto";
import sharp from "sharp";
import { TOPPS_1988_REGIONS } from "../masking/topps1988Geometry";
import { getMaskProfile } from "../masking/maskProfiles";
import { applyMaskSourceOverride, heldCropMeta, maskSourceOverrideDigest, maskSourceOverrides, regionsAfterHeldCrop, setMaskSourceOverridesForTests } from "../masking/maskSourceOverrides";
import type { MaskRegion } from "@shared/schema";

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

  it("crops a scanner mat off the printed card and leaves excluded cards unchanged", async () => {
    const cardW = 800;
    const cardH = 1120;
    const dark = 18;
    const white = 36;
    const fullW = cardW + (dark + white) * 2;
    const fullH = cardH + (dark + white) * 2;
    const raw = Buffer.alloc(fullW * fullH * 3, 12);
    const nameTop = Math.round(cardH * 0.86);
    for (let y = 0; y < fullH; y++) {
      for (let x = 0; x < fullW; x++) {
        const cx = x - dark - white;
        const cy = y - dark - white;
        const onCard = cx >= 0 && cy >= 0 && cx < cardW && cy < cardH;
        const onWhite = x >= dark && y >= dark && x < fullW - dark && y < fullH - dark;
        let color = [12, 12, 12];
        if (onWhite) color = [246, 246, 246];
        if (onCard) color = cy >= nameTop ? [20, 40, 220] : [20, 170, 40];
        const i = (y * fullW + x) * 3;
        raw[i] = color[0];
        raw[i + 1] = color[1];
        raw[i + 2] = color[2];
      }
    }
    const jpeg = await sharp(raw, { raw: { width: fullW, height: fullH, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    const murrayId = "8d0fc5e2-41ea-4428-a662-e9a059350599";
    const pin = (buf: Buffer) => {
      const current = maskSourceOverrides();
      setMaskSourceOverridesForTests({
        ...current,
        [murrayId]: { ...current[murrayId], inputSha256: sha(buf) },
      });
    };
    pin(jpeg);
    const cropped = await applyMaskSourceOverride(murrayId, jpeg);
    expect(await applyMaskSourceOverride(murrayId, Buffer.concat([jpeg, Buffer.from([1])]))).toBeNull();
    const croppedMeta = await sharp(cropped!).metadata();
    expect(croppedMeta.width).toBeGreaterThan(cardW - 8);
    expect(croppedMeta.width).toBeLessThan(cardW + 8);
    expect(Math.abs(croppedMeta.width! / croppedMeta.height! - 2.5 / 3.5)).toBeLessThan(0.02);
    const { data, info } = await sharp(cropped!).raw().toBuffer({ resolveWithObject: true });
    const pix = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const edge = pix(2, Math.floor(info.height / 2));
    expect(edge[0]).toBeLessThan(80);
    expect(edge[1]).toBeGreaterThan(120);
    const bottom = pix(40, info.height - 6);
    expect(bottom[2]).toBeGreaterThan(bottom[0] + 80);
    const above = pix(40, Math.floor(info.height * 0.7));
    expect(above[1]).toBeGreaterThan(above[2] + 40);
    expect(heldCropMeta(cropped!)).toBeNull();
    const band = getMaskProfile("1986 Topps Baseball", "2b77043a-6583-4d79-b59d-d2ab20291a17").regions;
    const regions = regionsAfterHeldCrop(band, cropped!);
    expect(regions[0].hPct).toBe(14);
    expect(regions[0].yPct).toBe(86);
    const inside = (x: number, y: number, list: MaskRegion[]) => list.some((region) => {
      const xp = (x / info.width) * 100;
      const yp = (y / info.height) * 100;
      return xp >= region.xPct && xp <= region.xPct + region.wPct && yp >= region.yPct && yp < region.yPct + region.hPct;
    });
    expect(inside(40, info.height - 6, regions)).toBe(true);
    expect(inside(40, Math.floor(info.height * 0.7), regions)).toBe(false);

    const narrow = await sharp({ create: { width: 300, height: 700, channels: 3, background: { r: 20, g: 180, b: 40 } } }).jpeg().toBuffer();
    pin(narrow);
    const scaled = await applyMaskSourceOverride(murrayId, narrow);
    const scaledMeta = await sharp(scaled!).metadata();
    expect(scaledMeta.width).toBe(360);
    expect(Math.abs(scaledMeta.width! / scaledMeta.height! - 300 / 700)).toBeLessThan(0.02);

    const solid = await sharp({ create: { width: 670, height: 1000, channels: 3, background: { r: 180, g: 40, b: 40 } } }).jpeg().toBuffer();
    pin(solid);
    const solidOut = await applyMaskSourceOverride(murrayId, solid);
    expect(solidOut).toBe(solid);

    const gibson = await applyMaskSourceOverride("1cf53402-61f8-4fac-9aae-4fb7b9cf112e", jpeg);
    expect(gibson).toBe(jpeg);

    const autograph = await applyMaskSourceOverride("93a3e9e6-3b14-41f0-a31f-9b3c3d192b85", jpeg);
    expect(autograph).toBe(jpeg);

    const framed = await sharp({ create: { width: 800, height: 1100, channels: 3, background: { r: 8, g: 8, b: 8 } } }).jpeg().toBuffer();
    const card = await sharp({ create: { width: 720, height: 1000, channels: 3, background: { r: 30, g: 140, b: 50 } } }).png().toBuffer();
    const mat = await sharp({ create: { width: 784, height: 1072, channels: 3, background: { r: 248, g: 248, b: 248 } } }).png().toBuffer();
    const withFrame = await sharp(framed).composite([{ input: mat, left: 8, top: 14 }, { input: card, left: 40, top: 50 }]).jpeg().toBuffer();
    pin(withFrame);
    const murray = await applyMaskSourceOverride("8d0fc5e2-41ea-4428-a662-e9a059350599", withFrame);
    const murrayMeta = await sharp(murray!).metadata();
    expect(murrayMeta.width!).toBeLessThan(760);
    expect(murrayMeta.height!).toBeLessThan(1060);
    const murrayEdge = await sharp(murray!).extract({ left: 2, top: 2, width: 6, height: 6 }).raw().toBuffer();
    expect(murrayEdge[0]).toBeLessThan(80);
    expect(murrayEdge[1]).toBeGreaterThan(100);
    expect(heldCropMeta(murray!)).toBeNull();
    const diagonal = regionsAfterHeldCrop(TOPPS_1988_REGIONS, murray!);
    expect(diagonal.map((region) => region.wPct)).toEqual(TOPPS_1988_REGIONS.map((region) => region.wPct));

    const stamp = await applyMaskSourceOverride("70676922-f57e-4e99-a0d5-f400422c9b0e", jpeg);
    expect(stamp).toBe(jpeg);
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
