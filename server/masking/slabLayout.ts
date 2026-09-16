/**
 * PSA / grader-slab layout: certificate labels sit above the inner card and
 * print the player name (e.g. ROGER CLEMENS on a Topps Tiffany slab). Set
 * profiles (1987 Topps bottom plaque, 1989 Fleer top plate) do not cover that
 * label. Detect the slab, then union a top cert band with the set plaque.
 *
 * v4.1 row-mean detector sampled the full width of the top 22% (8% inset).
 * Real PSA photos put a centered red header + white plate inside a dark
 * holder; full-width means dilute the red. v4.2 detects a dark-holder frame
 * (rails + centered red→white plate) or a full-bleed red→white stack, and
 * OCR accepts GEM/MINT/PSA* tokens (not only an exact "PSA").
 */
import type { MaskRegion } from "@shared/schema";
import { DEFAULT_MASK_REGIONS } from "@shared/schema";
import { unionMaskRegions } from "@shared/maskGeometry";
import type { MaskProfile } from "./maskProfiles";
import sharp from "sharp";

interface SlabOcrWord {
  text: string;
  y: number;
}

/** Full-width cert label: red PSA header + white name/year/grade plate. */
export const PSA_SLAB_TOP_LABEL: MaskRegion = {
  xPct: 0,
  yPct: 0,
  wPct: 100,
  hPct: 22,
  type: "blur",
  radiusPct: 0,
};

const GRADER_TOKENS = new Set([
  "psa",
  "bgs",
  "sgc",
  "cgc",
  "beckett",
  "gem",
  "mint",
  "gemmt",
  "nmmt",
  "graded",
]);

function normalizeGraderToken(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/1/g, "i")
    .replace(/0/g, "o")
    .replace(/5/g, "s");
}

export function tokenLooksLikeGrader(text: string): boolean {
  const token = normalizeGraderToken(text);
  if (!token) return false;
  if (GRADER_TOKENS.has(token)) return true;
  if (token.startsWith("psa") && token.length <= 6) return true;
  if (token.startsWith("bgs") && token.length <= 6) return true;
  if (token.startsWith("sgc") && token.length <= 6) return true;
  if (token.includes("mint") && token.length <= 10) return true;
  if (token.includes("gem") && token.length <= 8) return true;
  return false;
}

export function ocrLooksLikeSlab(words: SlabOcrWord[], imageHeight: number): boolean {
  if (!words.length || imageHeight <= 0) return false;
  return words.some((word) => {
    if (word.y / imageHeight > 0.32) return false;
    return tokenLooksLikeGrader(word.text);
  });
}

export function slabMaskRegions(profile: MaskProfile): MaskRegion[] {
  const plaque = profile.regions.length > 0
    ? profile.regions
    : DEFAULT_MASK_REGIONS;
  return unionMaskRegions([
    { ...PSA_SLAB_TOP_LABEL },
    ...plaque.map((region) => ({ ...region })),
  ]);
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function lum({ r, g, b }: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isPsaRed({ r, g, b }: Rgb): boolean {
  return r >= 130 && r > g + 35 && r > b + 35 && g < 120 && b < 120;
}

function isLightLabel({ r, g, b }: Rgb): boolean {
  const chroma = Math.max(Math.abs(r - g), Math.abs(r - b), Math.abs(g - b));
  return lum({ r, g, b }) >= 165 && chroma < 45;
}

function isDarkHolder({ r, g, b }: Rgb): boolean {
  return lum({ r, g, b }) < 55;
}

function pixelAt(raw: Buffer, width: number, x: number, y: number): Rgb {
  const i = (y * width + x) * 3;
  return { r: raw[i], g: raw[i + 1], b: raw[i + 2] };
}

function meanRegion(
  raw: Buffer,
  width: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = pixelAt(raw, width, x, y);
      r += px.r;
      g += px.g;
      b += px.b;
      n++;
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / n, g: g / n, b: b / n };
}

function fractionMatching(
  raw: Buffer,
  width: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  pred: (px: Rgb) => boolean,
): number {
  let hit = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      n++;
      if (pred(pixelAt(raw, width, x, y))) hit++;
    }
  }
  return n === 0 ? 0 : hit / n;
}

function rowFraction(
  raw: Buffer,
  width: number,
  y: number,
  pred: (px: Rgb) => boolean,
): number {
  return fractionMatching(raw, width, 0, width, y, y + 1, pred);
}

/**
 * Full-bleed cert (v4.1 synthetic): almost the entire row is PSA red, then
 * almost the entire row is the white plate. Raw Fleer is red around a
 * partial-width name plate (~62%), so it stays below this threshold.
 */
function fullBleedPsaHeader(raw: Buffer, width: number, height: number): boolean {
  const topH = Math.max(8, Math.round(height * 0.28));
  let i = 0;
  while (i < Math.min(6, topH) && rowFraction(raw, width, i, isPsaRed) < 0.72) i++;
  if (i >= topH) return false;
  let redCount = 0;
  while (i < topH && rowFraction(raw, width, i, isPsaRed) >= 0.72) {
    redCount++;
    i++;
  }
  if (redCount < 1) return false;
  let skippedBlend = 0;
  while (
    i < topH
    && skippedBlend < 3
    && rowFraction(raw, width, i, isLightLabel) < 0.72
    && rowFraction(raw, width, i, isPsaRed) < 0.72
  ) {
    i++;
    skippedBlend++;
  }
  let lightCount = 0;
  while (i < topH && rowFraction(raw, width, i, isLightLabel) >= 0.72) {
    lightCount++;
    i++;
  }
  return lightCount >= 2;
}

/** Dark holder rails + centered white cert plate + PSA-red header band. */
export function holderFrameLooksLikeSlab(raw: Buffer, width: number, height: number): boolean {
  if (width < 16 || height < 24) return false;
  const topH = Math.max(6, Math.round(height * 0.28));
  const edgeW = Math.max(2, Math.round(width * 0.1));
  const left = meanRegion(raw, width, 0, edgeW, 0, topH);
  const right = meanRegion(raw, width, width - edgeW, width, 0, topH);
  if (!isDarkHolder(left) || !isDarkHolder(right)) return false;

  const cx0 = Math.round(width * 0.2);
  const cx1 = Math.round(width * 0.8);
  const headerY0 = Math.round(height * 0.03);
  const headerY1 = Math.max(headerY0 + 1, Math.round(height * 0.1));
  const plateY0 = Math.round(height * 0.07);
  const plateY1 = Math.max(plateY0 + 2, Math.round(height * 0.2));
  const redFrac = fractionMatching(raw, width, cx0, cx1, headerY0, headerY1, isPsaRed);
  const plateLum = lum(meanRegion(raw, width, cx0, cx1, plateY0, plateY1));
  const plateLight = fractionMatching(raw, width, cx0, cx1, plateY0, plateY1, isLightLabel);
  return redFrac >= 0.18 && plateLum >= 150 && plateLight >= 0.35;
}

/** Red PSA header over a near-white cert plate. Does not fire on raw Fleer/Topps scans. */
export async function detectPsaSlabLayout(imageBuffer: Buffer): Promise<boolean> {
  const meta = await sharp(imageBuffer).metadata();
  const srcW = meta.width || 0;
  const srcH = meta.height || 0;
  if (srcW < 40 || srcH < 80) return false;

  const { data, info } = await sharp(imageBuffer)
    .resize(80, 120, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  if (holderFrameLooksLikeSlab(data, width, height)) return true;
  if (fullBleedPsaHeader(data, width, height)) return true;
  return false;
}
