/**
 * Intelligent name-band localization: layout profiles + OCR boxes.
 * Fixtures are synthetic (no live DB rows, no Tesseract).
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { DEFAULT_MASK_REGIONS } from "@shared/schema";
import {
  anyRegionCoversPoint,
  overlayMaskRegions,
  CURRENT_MASK_VERSION,
  maskedCardImageUrl,
} from "@shared/maskGeometry";
import { getMaskProfile } from "../masking/maskProfiles";
import { resolveNameMaskPlan, matchPlayerNameBoxes } from "../masking/nameLocalization";
import { maskCardImage } from "../masking/maskCardImage";

const W = 200;
const H = 280;
const GREEN = { r: 20, g: 180, b: 40 };
const WHITE = { r: 255, g: 255, b: 255 };

function isDark(r: number, g: number, b: number): boolean {
  return r < 50 && g < 50 && b < 60;
}

function isGreen(r: number, g: number, b: number): boolean {
  return g > 120 && r < 80 && b < 80;
}

async function sample(buf: Buffer, xPct: number, yPct: number): Promise<{ r: number; g: number; b: number }> {
  const meta = await sharp(buf).metadata();
  const width = meta.width || W;
  const height = meta.height || H;
  const x = Math.max(0, Math.min(width - 1, Math.round((xPct / 100) * (width - 1))));
  const y = Math.max(0, Math.min(height - 1, Math.round((yPct / 100) * (height - 1))));
  const { data } = await sharp(buf)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
}

async function fleerLikeTopNameCard(): Promise<Buffer> {
  const nameH = Math.round(H * 0.14);
  const namePlate = await sharp({
    create: { width: Math.round(W * 0.62), height: nameH, channels: 3, background: WHITE },
  }).png().toBuffer();
  const photoH = H - nameH - 12;
  const photo = await sharp({
    create: { width: W, height: photoH, channels: 3, background: GREEN },
  }).png().toBuffer();
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 200, g: 32, b: 32 } },
  })
    .composite([
      { input: namePlate, top: 4, left: 6 },
      { input: photo, top: nameH + 10, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function bottomPlaqueCard(): Promise<Buffer> {
  const plaqueH = Math.round(H * 0.28);
  const plaque = await sharp({
    create: { width: W, height: plaqueH, channels: 3, background: WHITE },
  }).png().toBuffer();
  const photoH = H - plaqueH;
  const photo = await sharp({
    create: { width: W, height: photoH, channels: 3, background: GREEN },
  }).png().toBuffer();
  return sharp({
    create: { width: W, height: H, channels: 3, background: GREEN },
  })
    .composite([
      { input: photo, top: 0, left: 0 },
      { input: plaque, top: photoH, left: 0 },
    ])
    .png()
    .toBuffer();
}

describe("name localization plan", () => {
  it("masks the 1989 Fleer top name plate even when OCR finds nothing", () => {
    const plan = resolveNameMaskPlan({
      playerName: "Spud Webb",
      setHint: "1989 Fleer basketball",
      words: [],
      imageWidth: W,
      imageHeight: H,
    });
    expect(plan.source).toBe("profile");
    expect(plan.profileId).toBe("fleer-bball-top");
    expect(anyRegionCoversPoint(plan.regions, 20, 8)).toBe(true);
    expect(anyRegionCoversPoint(plan.regions, 50, 72)).toBe(false);
    expect(plan.regions.every((region) => region.yPct + region.hPct <= 25)).toBe(true);
  });

  it("keeps a bottom-name Topps plaque and does not require a fixed 46% overlay when OCR hits", () => {
    const plan = resolveNameMaskPlan({
      playerName: "Mike Trout",
      setHint: "2011 Topps",
      words: [{ text: "TROUT", x: 20, y: Math.round(H * 0.82), w: 120, h: 28 }],
      imageWidth: W,
      imageHeight: H,
    });
    expect(plan.source).toBe("ocr");
    expect(anyRegionCoversPoint(plan.regions, 40, 88)).toBe(true);
    expect(anyRegionCoversPoint(plan.regions, 50, 12)).toBe(false);
    expect(plan.regions.some((region) => region.yPct === 54 && region.hPct === 46)).toBe(false);
  });

  it("matches jersey last-name OCR tokens", () => {
    const { tokens, boxes } = matchPlayerNameBoxes("Nicolas Batum", [
      { text: "BATUM", x: 40, y: 90, w: 80, h: 18 },
    ]);
    expect(tokens).toContain("batum");
    expect(boxes).toHaveLength(1);
  });

  it("client overlay follows the layout region instead of a hardcoded bottom %", () => {
    const fleer = overlayMaskRegions(getMaskProfile("1989 Fleer Basketball").regions);
    expect(fleer[0].yPct).toBe(0);
    expect(fleer[0].hPct).toBe(18);
    const fallback = overlayMaskRegions(undefined);
    expect(fallback).toEqual(DEFAULT_MASK_REGIONS);
  });

  it("cache-busts masked JPEGs with the current mask version", () => {
    expect(CURRENT_MASK_VERSION).toBe("v4.0");
    expect(maskedCardImageUrl("abc")).toBe("/api/cards/abc/masked-image?v=v4.0");
  });
});

describe("baked mask fixtures", () => {
  it("Fleer-like top-name card masks the name plate and leaves the photo", async () => {
    const raw = await fleerLikeTopNameCard();
    const beforeName = await sample(raw, 18, 8);
    expect(beforeName.r).toBeGreaterThan(200);

    const result = await maskCardImage(raw, "Spud Webb", "1989 Fleer Basketball", { skipOcr: true });
    expect(result.source).toBe("profile");
    expect(result.regions[0].yPct).toBe(0);

    const afterName = await sample(result.maskedBuffer, 18, 8);
    const afterPhoto = await sample(result.maskedBuffer, 50, 72);
    expect(isDark(afterName.r, afterName.g, afterName.b)).toBe(true);
    expect(isGreen(afterPhoto.r, afterPhoto.g, afterPhoto.b)).toBe(true);
  });

  it("bottom-plaque card masks the name band and leaves the top photo", async () => {
    const raw = await bottomPlaqueCard();
    const result = await maskCardImage(raw, "Mike Trout", "1987 Topps", { skipOcr: true });
    expect(result.source).toBe("profile");
    expect(result.regions[0].yPct).toBeGreaterThanOrEqual(50);

    const afterName = await sample(result.maskedBuffer, 50, 90);
    const afterPhoto = await sample(result.maskedBuffer, 50, 18);
    expect(isDark(afterName.r, afterName.g, afterName.b)).toBe(true);
    expect(isGreen(afterPhoto.r, afterPhoto.g, afterPhoto.b)).toBe(true);
  });
});
