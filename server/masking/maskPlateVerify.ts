/**
 * After the bake, look at the name plate (plus a small margin) on the masked
 * JPEG. Name-like ink that is not the opaque fill fails the card.
 */
import sharp from "sharp";
import type { NamePlateBox } from "@shared/maskGeometry";
import type { LayoutClass } from "./maskProfiles";

const MASK_FILL = { r: 10, g: 14, b: 22 };

export interface PlateVerifyResult {
  ok: boolean;
  reason: string | null;
}

function nearFill(r: number, g: number, b: number): boolean {
  // Navy fill is (10, 14, 22). Black name ink sits near (20, 20, 20), only
  // 10 counts away on red. A wider match drops the letters and the row looks blank.
  return Math.abs(r - MASK_FILL.r) <= 8
    && Math.abs(g - MASK_FILL.g) <= 8
    && Math.abs(b - MASK_FILL.b) <= 8;
}

/**
 * A row of type on a flat plate: dark ink and a light ground, or the reverse,
 * and almost every pixel is one of those two. A photo row spreads across
 * many tones and does not count.
 */
export function rowLooksLikeNameText(samples: Array<{ r: number; g: number; b: number }>): boolean {
  if (samples.length < 8) return false;
  let fill = 0;
  const lum: number[] = [];
  for (const px of samples) {
    if (nearFill(px.r, px.g, px.b)) {
      fill++;
      continue;
    }
    lum.push(0.2126 * px.r + 0.7152 * px.g + 0.0722 * px.b);
  }
  if (lum.length < 8) return false;
  if (fill / samples.length > 0.85) return false;
  lum.sort((a, b) => a - b);
  const p10 = lum[Math.floor(lum.length * 0.1)];
  const p90 = lum[Math.floor(lum.length * 0.9)];
  if (p90 - p10 < 90) return false;
  let peaks = 0;
  for (const value of lum) {
    if (value <= p10 + 25 || value >= p90 - 25) peaks++;
  }
  return peaks / lum.length >= 0.72;
}

function zoneFromPlate(
  plate: NamePlateBox,
  imageWidth: number,
  imageHeight: number,
): { left: number; top: number; width: number; height: number } | null {
  const margin = Math.max(4, Math.round(imageHeight * 0.012));
  const left = 0;
  const top = Math.max(0, Math.floor(plate.y - margin));
  const bottom = Math.min(imageHeight, Math.ceil(plate.y + plate.h + margin));
  const width = Math.max(1, imageWidth);
  const height = bottom - top;
  if (height < 4 || width < 8) return null;
  return { left, top, width, height };
}

/**
 * Fail when the plate zone on the baked JPEG still has name-like rows.
 * No plate box means there is nothing new to check (the opaque-band assert
 * already ran).
 */
export async function verifyMaskedNamePlate(input: {
  buffer: Buffer;
  plate: NamePlateBox | null;
  layoutClass: LayoutClass;
  imageWidth: number;
  imageHeight: number;
}): Promise<PlateVerifyResult> {
  if (input.layoutClass === "PSA_SLAB" || input.layoutClass === "UNKNOWN") {
    return { ok: true, reason: null };
  }
  if (!input.plate) return { ok: true, reason: null };
  const zone = zoneFromPlate(input.plate, input.imageWidth, input.imageHeight);
  if (!zone) return { ok: true, reason: null };

  const { data, info } = await sharp(input.buffer)
    .removeAlpha()
    .extract(zone)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let textRows = 0;
  const step = Math.max(1, Math.floor(info.width / 48));
  for (let y = 0; y < info.height; y++) {
    const samples: Array<{ r: number; g: number; b: number }> = [];
    for (let x = 0; x < info.width; x += step) {
      const i = (y * info.width + x) * info.channels;
      samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    if (rowLooksLikeNameText(samples)) textRows++;
  }
  if (textRows >= 2) return { ok: false, reason: "name_text_visible" };
  return { ok: true, reason: null };
}
