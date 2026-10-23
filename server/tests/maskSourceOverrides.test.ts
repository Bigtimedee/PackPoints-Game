import { describe, expect, it, afterEach } from "vitest";
import { createHash } from "crypto";
import sharp from "sharp";
import { TOPPS_1988_REGIONS } from "../masking/topps1988Geometry";
import { getMaskProfile } from "../masking/maskProfiles";
import { applyMaskSourceOverride, heldCropMeta, maskSourceOverrideDigest, maskSourceOverrides, regionsAfterHeldCrop, setMaskSourceOverridesForTests } from "../masking/maskSourceOverrides";
import type { MaskRegion } from "@shared/schema";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function bandedJpeg(
  w: number,
  h: number,
  topBand: number,
  bottomBand: number,
  edge: number[],
  mid: number[],
  sideBand = 0,
): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onEdge = y < topBand || y >= h - bottomBand || x < sideBand || x >= w - sideBand;
      const color = onEdge ? edge : mid;
      const i = (y * w + x) * 3;
      raw[i] = color[0];
      raw[i + 1] = color[1];
      raw[i + 2] = color[2];
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

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

  it("crops a held 1986 scan to the card ratio, trims a dark frame, and crops a stamp off the margin", async () => {
    const stretched = await bandedJpeg(800, 1400, 80, 80, [220, 20, 20], [20, 180, 40]);
    const gibson = await applyMaskSourceOverride("1cf53402-61f8-4fac-9aae-4fb7b9cf112e", stretched);
    const gibsonMeta = await sharp(gibson!).metadata();
    expect(gibsonMeta.width).toBe(800);
    expect(gibsonMeta.height).toBe(Math.round(800 * 3.5 / 2.5));
    expect(gibsonMeta.width! / gibsonMeta.height!).toBeGreaterThan(0.68);
    expect(gibsonMeta.width! / gibsonMeta.height!).toBeLessThan(0.76);
    const top = await sharp(gibson!).extract({ left: 20, top: 4, width: 8, height: 8 }).raw().toBuffer();
    expect(top[0]).toBeLessThan(80);
    expect(top[1]).toBeGreaterThan(140);

    const wide = await bandedJpeg(1000, 1000, 0, 0, [220, 20, 20], [20, 180, 40], 80);
    const wideOut = await applyMaskSourceOverride("1cf53402-61f8-4fac-9aae-4fb7b9cf112e", wide);
    const wideMeta = await sharp(wideOut!).metadata();
    expect(wideMeta.height).toBe(1000);
    expect(wideMeta.width).toBe(Math.round(1000 * 2.5 / 3.5));
    const left = await sharp(wideOut!).extract({ left: 4, top: 20, width: 8, height: 8 }).raw().toBuffer();
    expect(left[0]).toBeLessThan(80);
    expect(left[1]).toBeGreaterThan(140);

    const narrow = await sharp({ create: { width: 300, height: 700, channels: 3, background: { r: 20, g: 180, b: 40 } } }).jpeg().toBuffer();
    const scaled = await applyMaskSourceOverride("1cf53402-61f8-4fac-9aae-4fb7b9cf112e", narrow);
    const scaledMeta = await sharp(scaled!).metadata();
    expect(scaledMeta.width).toBe(360);
    expect(Math.abs(scaledMeta.width! / scaledMeta.height! - 2.5 / 3.5)).toBeLessThan(0.01);

    const barelyTall = await sharp({ create: { width: 670, height: 1000, channels: 3, background: { r: 180, g: 40, b: 40 } } }).jpeg().toBuffer();
    const barely = await applyMaskSourceOverride("1cf53402-61f8-4fac-9aae-4fb7b9cf112e", barelyTall);
    const barelyMeta = await sharp(barely!).metadata();
    expect(barelyMeta.width).toBe(670);
    expect(barelyMeta.height).toBe(Math.round(670 * 3.5 / 2.5));
    const autograph = await applyMaskSourceOverride("93a3e9e6-3b14-41f0-a31f-9b3c3d192b85", stretched);
    const autographMeta = await sharp(autograph!).metadata();
    expect(autographMeta.width).toBe(800);
    expect(autographMeta.height).toBe(1400);

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
    expect(Math.abs(croppedMeta.width! / croppedMeta.height! - 2.5 / 3.5)).toBeLessThan(0.01);
  });

  it("returns a stamp crop to 2.5 by 3.5 and keeps the mask on the name plate", async () => {
    const w = 900;
    const h = 1300;
    const raw = Buffer.alloc(w * h * 3, 250);
    const paint = (x0: number, y0: number, x1: number, y1: number, color: number[]) => {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 3;
          raw[i] = color[0];
          raw[i + 1] = color[1];
          raw[i + 2] = color[2];
        }
      }
    };
    for (let y = 40; y < 1260; y++) {
      for (let x = 30; x < 800; x++) {
        const i = (y * w + x) * 3;
        const n = ((x * 3 + y * 5) % 23) * 4;
        raw[i] = 30 + n;
        raw[i + 1] = 140;
        raw[i + 2] = 50;
      }
    }
    paint(506, 1144, 531, 1240, [20, 40, 220]);
    for (let y = 80; y < 1220; y++) {
      const on = y % 6 < 3;
      for (let x = 808; x < 880; x++) {
        const i = (y * w + x) * 3;
        raw[i] = on ? 210 : 15;
        raw[i + 1] = on ? 20 : 15;
        raw[i + 2] = on ? 180 : 15;
      }
    }
    const jpeg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    const out = await applyMaskSourceOverride("70676922-f57e-4e99-a0d5-f400422c9b0e", jpeg);
    const meta = await sharp(out!).metadata();
    const ow = meta.width!;
    const oh = meta.height!;
    expect(Math.abs(ow / oh - 2.5 / 3.5)).toBeLessThan(0.005);
    const { data, info } = await sharp(out!).raw().toBuffer({ resolveWithObject: true });
    const pix = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const corner = pix(4, 4);
    expect(corner[0]).toBeLessThan(230);
    let stampLeft = 0;
    for (let y = 8; y < oh - 8; y += 3) {
      const [r, g, b] = pix(ow - 3, y);
      if (r > 230 && g > 230 && b > 230) stampLeft += 1;
      if (r > 150 && b > 120 && g < 80) stampLeft += 1;
    }
    expect(stampLeft).toBe(0);
    const crop = heldCropMeta(out!);
    expect(crop).not.toBeNull();
    const regions = regionsAfterHeldCrop(TOPPS_1988_REGIONS, out!);
    const inside = (x: number, y: number) => regions.some((region) => {
      const xp = (x / ow) * 100;
      const yp = (y / oh) * 100;
      return xp >= region.xPct && xp <= region.xPct + region.wPct && yp >= region.yPct && yp < region.yPct + region.hPct;
    });
    const map = (sx: number, sy: number) => [
      Math.round((sx - crop!.left) * (ow / crop!.width)),
      Math.round((sy - crop!.top) * (oh / crop!.height)),
    ] as const;
    const [bx, by] = map(518, 1190);
    const name = pix(bx, by);
    expect(name[2]).toBeGreaterThan(name[0] + 80);
    expect(inside(bx, by)).toBe(true);
    const [px, py] = map(120, 700);
    const photo = pix(px, py);
    expect(photo[1]).toBeGreaterThan(photo[2] + 40);
    expect(inside(px, py)).toBe(false);
  });

  it("keeps the 1986 name band on the bottom plate after a top-only ratio crop", async () => {
    const w = 800;
    const h = 1400;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      const color = y >= Math.round(h * 0.86) ? [20, 40, 220] : [20, 170, 40];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        raw[i] = color[0];
        raw[i + 1] = color[1];
        raw[i + 2] = color[2];
      }
    }
    const jpeg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    const out = await applyMaskSourceOverride("1cf53402-61f8-4fac-9aae-4fb7b9cf112e", jpeg);
    const meta = await sharp(out!).metadata();
    const ow = meta.width!;
    const oh = meta.height!;
    expect(ow).toBe(800);
    expect(oh).toBe(Math.round(800 * 3.5 / 2.5));
    expect(Math.abs(ow / oh - 2.5 / 3.5)).toBeLessThan(0.005);
    const { data, info } = await sharp(out!).raw().toBuffer({ resolveWithObject: true });
    const pix = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const bottom = pix(40, oh - 8);
    expect(bottom[2]).toBeGreaterThan(bottom[0] + 80);
    expect(bottom[2]).toBeGreaterThan(bottom[1] + 80);
    const above = pix(40, Math.floor(oh * 0.7));
    expect(above[1]).toBeGreaterThan(above[2] + 40);
    const band = getMaskProfile("1986 Topps Baseball", "2b77043a-6583-4d79-b59d-d2ab20291a17").regions;
    const regions = regionsAfterHeldCrop(band, out!);
    const inside = (x: number, y: number, list: MaskRegion[]) => list.some((region) => {
      const xp = (x / ow) * 100;
      const yp = (y / oh) * 100;
      return xp >= region.xPct && xp <= region.xPct + region.wPct && yp >= region.yPct && yp < region.yPct + region.hPct;
    });
    expect(inside(40, oh - 8, regions)).toBe(true);
    expect(inside(40, Math.floor(oh * 0.7), regions)).toBe(false);
    const crop = heldCropMeta(out!);
    expect(crop?.top).toBeGreaterThan(0);
    expect(crop?.height).toBe(oh);
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
