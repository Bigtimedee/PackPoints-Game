/**
 * Intelligent name-band localization: layout profiles + OCR boxes.
 * Fixtures are synthetic plus one captured Clemens PSA JPEG (no live DB, no Tesseract).
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
import { getMaskProfile, MASK_LAYOUT_SET_IDS } from "../masking/maskProfiles";
import { resolveNameMaskPlan, matchPlayerNameBoxes } from "../masking/nameLocalization";
import { applyPercentRegions, maskCardImage } from "../masking/maskCardImage";
import { assertOpaqueIdentityCover } from "../masking/maskCoverage";
import { readFileSync } from "fs";
import path from "path";
import {
  detectPsaSlabLayout,
  ocrLooksLikeSlab,
  tokenLooksLikeGrader,
  PSA_SLAB_TOP_LABEL,
} from "../masking/slabLayout";

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

/** Luminance span inside a percent box. Identity text that survives a translucent fill shows up as a wide span. */
async function luminanceSpan(
  buf: Buffer,
  x0Pct: number,
  y0Pct: number,
  x1Pct: number,
  y1Pct: number,
): Promise<number> {
  const meta = await sharp(buf).metadata();
  const width = meta.width || W;
  const height = meta.height || H;
  const left = Math.max(0, Math.min(width - 1, Math.round((x0Pct / 100) * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round((y0Pct / 100) * height)));
  const right = Math.max(left + 1, Math.min(width, Math.round((x1Pct / 100) * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.round((y1Pct / 100) * height)));
  const { data, info } = await sharp(buf)
    .extract({ left, top, width: right - left, height: bottom - top })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  return max - min;
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

const SLAB_W = 400;
const SLAB_H = 600;
const PSA_RED = { r: 196, g: 30, b: 58 };

async function psaSlabCard(): Promise<Buffer> {
  const headerH = Math.round(SLAB_H * 0.055);
  const labelH = Math.round(SLAB_H * 0.12);
  const plaqueH = Math.round(SLAB_H * 0.22);
  const photoH = SLAB_H - headerH - labelH - plaqueH;
  const header = await sharp({
    create: { width: SLAB_W, height: headerH, channels: 3, background: PSA_RED },
  }).png().toBuffer();
  const label = await sharp({
    create: { width: SLAB_W, height: labelH, channels: 3, background: WHITE },
  }).png().toBuffer();
  const photo = await sharp({
    create: { width: SLAB_W, height: photoH, channels: 3, background: GREEN },
  }).png().toBuffer();
  const plaque = await sharp({
    create: { width: SLAB_W, height: plaqueH, channels: 3, background: WHITE },
  }).png().toBuffer();
  return sharp({
    create: { width: SLAB_W, height: SLAB_H, channels: 3, background: WHITE },
  })
    .composite([
      { input: header, top: 0, left: 0 },
      { input: label, top: headerH, left: 0 },
      { input: photo, top: headerH + labelH, left: 0 },
      { input: plaque, top: headerH + labelH + photoH, left: 0 },
    ])
    .png()
    .toBuffer();
}

/** Holder-framed PSA scan: centered red header + white cert plate, not full-bleed. */
async function clemensClassPsaSlabCard(): Promise<Buffer> {
  const holder = { r: 18, g: 20, b: 28 };
  const innerW = Math.round(SLAB_W * 0.72);
  const innerX = Math.round((SLAB_W - innerW) / 2);
  const headerH = Math.round(SLAB_H * 0.05);
  const labelH = Math.round(SLAB_H * 0.13);
  const innerTop = Math.round(SLAB_H * 0.035);
  const plaqueH = Math.round(SLAB_H * 0.2);
  const photoH = SLAB_H - innerTop - headerH - labelH - plaqueH - Math.round(SLAB_H * 0.04);
  const header = await sharp({
    create: { width: innerW, height: headerH, channels: 3, background: PSA_RED },
  }).png().toBuffer();
  const label = await sharp({
    create: { width: innerW, height: labelH, channels: 3, background: WHITE },
  }).png().toBuffer();
  const photo = await sharp({
    create: { width: innerW, height: photoH, channels: 3, background: GREEN },
  }).png().toBuffer();
  const plaque = await sharp({
    create: { width: innerW, height: plaqueH, channels: 3, background: { r: 196, g: 40, b: 70 } },
  }).png().toBuffer();
  return sharp({
    create: { width: SLAB_W, height: SLAB_H, channels: 3, background: holder },
  })
    .composite([
      { input: header, top: innerTop, left: innerX },
      { input: label, top: innerTop + headerH, left: innerX },
      { input: photo, top: innerTop + headerH + labelH, left: innerX },
      { input: plaque, top: innerTop + headerH + labelH + photoH, left: innerX },
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
    expect(CURRENT_MASK_VERSION).toBe("v4.5");
    expect(maskedCardImageUrl("abc")).toBe("/api/cards/abc/masked-image?v=v4.5");
  });

  it("PSA-slab OCR (grader token in the top label) covers the cert name and the bottom plaque", () => {
    const plan = resolveNameMaskPlan({
      playerName: "Roger Clemens",
      setHint: "1987 Topps",
      words: [
        { text: "PSA", x: 20, y: 8, w: 40, h: 14 },
        { text: "CLEMENS", x: 80, y: 22, w: 90, h: 16 },
      ],
      imageWidth: W,
      imageHeight: H,
    });
    expect(plan.profileId).toBe("psa-slab");
    expect(anyRegionCoversPoint(plan.regions, 50, 8)).toBe(true);
    expect(anyRegionCoversPoint(plan.regions, 50, 90)).toBe(true);
    expect(PSA_SLAB_TOP_LABEL.hPct).toBe(22);
  });

  it("PSA grader OCR does not fire on a raw Fleer top-name card", () => {
    expect(ocrLooksLikeSlab([], H)).toBe(false);
    const plan = resolveNameMaskPlan({
      playerName: "A.C. Green",
      setHint: "1989 Fleer basketball",
      words: [],
      imageWidth: W,
      imageHeight: H,
    });
    expect(plan.profileId).toBe("fleer-bball-top");
    expect(anyRegionCoversPoint(plan.regions, 20, 8)).toBe(true);
    expect(anyRegionCoversPoint(plan.regions, 50, 72)).toBe(false);
  });

  it("PSA-slab OCR accepts GEM/MINT/PSA* cert tokens, not only exact PSA", () => {
    expect(tokenLooksLikeGrader("P5A")).toBe(true);
    expect(tokenLooksLikeGrader("MINT")).toBe(true);
    expect(tokenLooksLikeGrader("GEM")).toBe(true);
    expect(tokenLooksLikeGrader("PSA9")).toBe(true);
    expect(ocrLooksLikeSlab([{ text: "MINT", y: 18 }, { text: "CLEMENS", y: 28 }], H)).toBe(true);
    const plan = resolveNameMaskPlan({
      playerName: "Roger Clemens",
      setHint: "1987 Topps",
      words: [
        { text: "MINT", x: 160, y: 12, w: 40, h: 12 },
        { text: "CLEMENS", x: 80, y: 22, w: 90, h: 16 },
      ],
      imageWidth: W,
      imageHeight: H,
    });
    expect(plan.profileId).toBe("psa-slab");
    expect(anyRegionCoversPoint(plan.regions, 50, 8)).toBe(true);
    expect(anyRegionCoversPoint(plan.regions, 50, 90)).toBe(true);
  });
});

describe("baked mask fixtures", () => {
  it("Fleer-like top-name card masks the name plate and leaves the photo", async () => {
    const raw = await fleerLikeTopNameCard();
    const beforeName = await sample(raw, 18, 8);
    expect(beforeName.r).toBeGreaterThan(200);

    const result = await maskCardImage(raw, "Spud Webb", "1989 Fleer Basketball", { skipOcr: true });
    expect(result.source).toBe("profile");
    expect(result.coverageOk).toBe(true);
    expect(result.regions[0].yPct).toBe(0);

    const afterName = await sample(result.maskedBuffer, 18, 8);
    const afterPhoto = await sample(result.maskedBuffer, 50, 72);
    expect(isDark(afterName.r, afterName.g, afterName.b)).toBe(true);
    expect(isGreen(afterPhoto.r, afterPhoto.g, afterPhoto.b)).toBe(true);
  });

  it("bottom-plaque card masks the name band and leaves the top photo", async () => {
    const raw = await bottomPlaqueCard();
    const result = await maskCardImage(raw, "Mike Trout", "1987 Topps baseball", { skipOcr: true });
    expect(result.source).toBe("profile");
    expect(result.coverageOk).toBe(true);
    expect(result.regions[0].yPct).toBeGreaterThanOrEqual(50);

    const afterName = await sample(result.maskedBuffer, 50, 90);
    const afterPhoto = await sample(result.maskedBuffer, 50, 18);
    expect(isDark(afterName.r, afterName.g, afterName.b)).toBe(true);
    expect(isGreen(afterPhoto.r, afterPhoto.g, afterPhoto.b)).toBe(true);
  });

  it("PSA-slab fixture masks the top cert name and the inner bottom plaque", async () => {
    const raw = await psaSlabCard();
    expect(await detectPsaSlabLayout(raw)).toBe(true);
    expect(await detectPsaSlabLayout(await fleerLikeTopNameCard())).toBe(false);
    expect(await detectPsaSlabLayout(await bottomPlaqueCard())).toBe(false);

    const result = await maskCardImage(raw, "Roger Clemens", "1987 Topps", { skipOcr: true });
    expect(result.source).toBe("profile");
    expect(result.coverageOk).toBe(true);
    expect(anyRegionCoversPoint(result.regions, 50, 8)).toBe(true);
    expect(anyRegionCoversPoint(result.regions, 50, 90)).toBe(true);
    expect(anyRegionCoversPoint(result.regions, 50, 40)).toBe(false);

    const afterLabel = await sample(result.maskedBuffer, 50, 10);
    const afterPhoto = await sample(result.maskedBuffer, 50, 40);
    const afterPlaque = await sample(result.maskedBuffer, 50, 90);
    expect(isDark(afterLabel.r, afterLabel.g, afterLabel.b)).toBe(true);
    expect(isGreen(afterPhoto.r, afterPhoto.g, afterPhoto.b)).toBe(true);
    expect(isDark(afterPlaque.r, afterPlaque.g, afterPlaque.b)).toBe(true);
  });

  it("Clemens-class holder-framed slab covers the top cert name and the inner plaque", async () => {
    const raw = await clemensClassPsaSlabCard();
    expect(await detectPsaSlabLayout(raw)).toBe(true);
    expect(await detectPsaSlabLayout(await fleerLikeTopNameCard())).toBe(false);
    expect(await detectPsaSlabLayout(await bottomPlaqueCard())).toBe(false);

    const result = await maskCardImage(raw, "Roger Clemens", "1987 Topps", { skipOcr: true });
    expect(result.source).toBe("profile");
    expect(result.coverageOk).toBe(true);
    expect(anyRegionCoversPoint(result.regions, 50, 8)).toBe(true);
    expect(anyRegionCoversPoint(result.regions, 50, 90)).toBe(true);
    expect(anyRegionCoversPoint(result.regions, 50, 40)).toBe(false);

    const afterLabel = await sample(result.maskedBuffer, 50, 10);
    const afterPhoto = await sample(result.maskedBuffer, 50, 40);
    const afterPlaque = await sample(result.maskedBuffer, 50, 90);
    expect(isDark(afterLabel.r, afterLabel.g, afterLabel.b)).toBe(true);
    expect(isGreen(afterPhoto.r, afterPhoto.g, afterPhoto.b)).toBe(true);
    expect(isDark(afterPlaque.r, afterPlaque.g, afterPlaque.b)).toBe(true);
  });

  it("live Clemens PSA JPEG covers the top cert band (not plaque-only)", async () => {
    const raw = readFileSync(path.resolve("server/tests/fixtures/clemens-psa-slab.jpg"));
    expect(await detectPsaSlabLayout(raw)).toBe(true);

    const result = await maskCardImage(raw, "Roger Clemens", "1987 Topps", { skipOcr: true });
    expect(result.coverageOk).toBe(true);
    expect(anyRegionCoversPoint(result.regions, 50, 8)).toBe(true);
    expect(anyRegionCoversPoint(result.regions, 50, 90)).toBe(true);
    expect(anyRegionCoversPoint(result.regions, 50, 40)).toBe(false);

    const afterLabel = await sample(result.maskedBuffer, 50, 10);
    const afterPhoto = await sample(result.maskedBuffer, 50, 40);
    const afterPlaque = await sample(result.maskedBuffer, 50, 88);
    expect(isDark(afterLabel.r, afterLabel.g, afterLabel.b)).toBe(true);
    expect(afterPhoto.r).toBeGreaterThan(80);
    expect(isDark(afterPlaque.r, afterPlaque.g, afterPlaque.b)).toBe(true);
    // Interior of the cert band, inset from the JPEG edge so ringing is not the signal.
    const rawCertSpan = await luminanceSpan(raw, 20, 6, 80, 16);
    const maskedCertSpan = await luminanceSpan(result.maskedBuffer, 20, 6, 80, 16);
    expect(rawCertSpan).toBeGreaterThan(40);
    expect(maskedCertSpan).toBeLessThan(8);
  });

  it("opaque fill hides high-contrast name bars without covering the photo", async () => {
    const bars: { input: Buffer; top: number; left: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const bar = await sharp({
        create: { width: 16, height: 36, channels: 3, background: { r: 0, g: 0, b: 0 } },
      }).png().toBuffer();
      bars.push({ input: bar, top: 10, left: 20 + i * 24 });
    }
    const raw = await sharp({
      create: { width: W, height: H, channels: 3, background: WHITE },
    }).composite(bars).png().toBuffer();

    expect(await luminanceSpan(raw, 8, 3, 92, 14)).toBeGreaterThan(200);

    const result = await maskCardImage(raw, "A.C. Green", "1989 Fleer Basketball", { skipOcr: true });
    expect(result.source).toBe("profile");
    expect(result.regions.every((region) => region.yPct + region.hPct <= 25)).toBe(true);
    expect(await luminanceSpan(result.maskedBuffer, 8, 3, 92, 14)).toBeLessThan(8);
    const photo = await sample(result.maskedBuffer, 50, 55);
    expect(photo.r).toBeGreaterThan(200);
    expect(photo.g).toBeGreaterThan(200);
    expect(photo.b).toBeGreaterThan(200);
  });

  it("1987 Topps Football masks the top name plate and leaves the photo", async () => {
    const raw = await fleerLikeTopNameCard();
    const result = await maskCardImage(raw, "Hanford Dixon", "1987 Topps Football", {
      skipOcr: true,
      gameSetId: MASK_LAYOUT_SET_IDS.toppsFootball1987,
    });
    expect(result.source).toBe("profile");
    expect(result.layoutClass).toBe("TOP_PLATE");
    expect(result.regions[0].yPct).toBe(0);
    expect(result.regions[0].hPct).toBe(24);
    expect(result.coverageOk).toBe(true);

    const afterName = await sample(result.maskedBuffer, 18, 8);
    const afterPhoto = await sample(result.maskedBuffer, 50, 72);
    expect(isDark(afterName.r, afterName.g, afterName.b)).toBe(true);
    expect(isGreen(afterPhoto.r, afterPhoto.g, afterPhoto.b)).toBe(true);
    expect(await luminanceSpan(result.maskedBuffer, 8, 2, 92, 16)).toBeLessThan(8);
  });

  it("refuses a bottom-only bake when the printed name is still in the top zone", async () => {
    const raw = await fleerLikeTopNameCard();
    const bottom = getMaskProfile("1987 Topps").regions;
    const painted = await applyPercentRegions(raw, bottom);
    const coverage = await assertOpaqueIdentityCover({
      buffer: painted,
      regions: bottom,
      layoutClass: "BOTTOM_PLAQUE",
      nameBoxes: [{ x: 20, y: 8, w: 90, h: 16 }],
      imageWidth: W,
      imageHeight: H,
    });
    expect(coverage.ok).toBe(false);
    expect(coverage.reason).toBe("printed_name_outside_mask");
  });

  it("refuses a top-plate class painted with only the baseball bottom plaque", async () => {
    const raw = await fleerLikeTopNameCard();
    const bottom = getMaskProfile("1987 Topps").regions;
    const painted = await applyPercentRegions(raw, bottom);
    const coverage = await assertOpaqueIdentityCover({
      buffer: painted,
      regions: bottom,
      layoutClass: "TOP_PLATE",
      imageWidth: W,
      imageHeight: H,
    });
    expect(coverage.ok).toBe(false);
    expect(coverage.reason).toBe("name_band_missing");
  });

  it("refuses a top-plate class when the top band was not painted", async () => {
    const raw = await fleerLikeTopNameCard();
    const top = getMaskProfile("1987 Topps Football").regions;
    const coverage = await assertOpaqueIdentityCover({
      buffer: raw,
      regions: top,
      layoutClass: "TOP_PLATE",
      imageWidth: W,
      imageHeight: H,
    });
    expect(coverage.ok).toBe(false);
    expect(coverage.reason).toBe("name_region_not_opaque");
  });
});
