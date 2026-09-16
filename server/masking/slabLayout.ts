/**
 * PSA / grader-slab layout: certificate labels sit above the inner card and
 * print the player name (e.g. ROGER CLEMENS on a Topps Tiffany slab). Set
 * profiles (1987 Topps bottom plaque, 1989 Fleer top plate) do not cover that
 * label. Detect the slab, then union a top cert band with the set plaque.
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

const GRADER_TOKENS = new Set(["psa", "bgs", "sgc", "cgc", "beckett"]);

export function ocrLooksLikeSlab(words: SlabOcrWord[], imageHeight: number): boolean {
  if (!words.length || imageHeight <= 0) return false;
  return words.some((word) => {
    const token = (word.text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!GRADER_TOKENS.has(token)) return false;
    return word.y / imageHeight <= 0.32;
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

function isPsaRed({ r, g, b }: Rgb): boolean {
  return r >= 130 && r > g + 35 && r > b + 35 && g < 120 && b < 120;
}

function isLightLabel({ r, g, b }: Rgb): boolean {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const chroma = Math.max(Math.abs(r - g), Math.abs(r - b), Math.abs(g - b));
  return lum >= 165 && chroma < 45;
}

function rowMeans(raw: Buffer, width: number, height: number): Rgb[] {
  const rows: Rgb[] = [];
  for (let y = 0; y < height; y++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      r += raw[i];
      g += raw[i + 1];
      b += raw[i + 2];
    }
    rows.push({ r: r / width, g: g / width, b: b / width });
  }
  return rows;
}

function rowsLookLikePsaHeader(rows: Rgb[]): boolean {
  let i = 0;
  while (i < Math.min(4, rows.length) && !isPsaRed(rows[i])) i++;
  if (i >= rows.length) return false;
  let redCount = 0;
  while (i < rows.length && isPsaRed(rows[i])) {
    redCount++;
    i++;
  }
  if (redCount < 2) return false;
  let skippedBlend = 0;
  while (
    i < rows.length
    && skippedBlend < 2
    && !isLightLabel(rows[i])
    && !isPsaRed(rows[i])
  ) {
    i++;
    skippedBlend++;
  }
  let lightCount = 0;
  while (i < rows.length && isLightLabel(rows[i])) {
    lightCount++;
    i++;
  }
  return lightCount >= 3;
}

/** Red PSA header over a near-white cert plate. Does not fire on raw Fleer/Topps scans. */
export async function detectPsaSlabLayout(imageBuffer: Buffer): Promise<boolean> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width < 40 || height < 80) return false;

  const inset = Math.round(width * 0.08);
  const sampleW = Math.max(16, width - inset * 2);
  const sampleH = Math.max(12, Math.round(height * 0.22));
  const raw = await sharp(imageBuffer)
    .extract({ left: inset, top: 0, width: sampleW, height: sampleH })
    .resize(50, 22, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();

  return rowsLookLikePsaHeader(rowMeans(raw, 50, 22));
}
