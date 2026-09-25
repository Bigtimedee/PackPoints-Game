import sharp from "sharp";
import type { MaskRegion } from "@shared/schema";
import { anyRegionCoversPoint } from "@shared/maskGeometry";
import type { LayoutClass } from "./maskProfiles";

export interface NameTokenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Opaque bake fill `#0a0e16`. */
const MASK_FILL = { r: 10, g: 14, b: 22 };
const MASK_FILL_LUM = 0.2126 * MASK_FILL.r + 0.7152 * MASK_FILL.g + 0.0722 * MASK_FILL.b;

const SOLID_SPAN_MAX = 12;
const SOLID_MEAN_MAX = 32;
const PHOTO_MEAN_DELTA_MIN = 25;

export interface CoverageAssert {
  ok: boolean;
  reason: string | null;
}

/**
 * Prove the printed-name band is an opaque cover and the photo is still visible.
 * A matched name token sitting in the top or bottom identity zone outside every region fails closed.
 */
export async function assertOpaqueIdentityCover(input: {
  buffer: Buffer;
  regions: MaskRegion[];
  layoutClass: LayoutClass;
  nameBoxes?: NameTokenBox[];
  imageWidth: number;
  imageHeight: number;
}): Promise<CoverageAssert> {
  if (input.layoutClass === "UNKNOWN" || input.regions.length === 0) {
    return { ok: false, reason: "unclassified_name_region" };
  }

  const usesFullBand = input.regions.some((region) => region.wPct >= 90 && region.hPct >= 12);
  if (usesFullBand) {
    const band = canonicalNameBand(input.layoutClass);
    const covered = input.regions.some((region) => regionCovers(region, band));
    if (!covered) return { ok: false, reason: "name_band_missing" };
    const bandSample = await sampleRegion(input.buffer, band);
    if (!bandSample || bandSample.span > SOLID_SPAN_MAX || bandSample.mean > SOLID_MEAN_MAX) {
      return { ok: false, reason: "name_region_not_opaque" };
    }
  }

  for (const region of input.regions) {
    const sample = await sampleRegion(input.buffer, region);
    if (!sample) return { ok: false, reason: "name_region_empty" };
    if (sample.span > SOLID_SPAN_MAX || sample.mean > SOLID_MEAN_MAX) {
      return { ok: false, reason: "name_region_not_opaque" };
    }
  }

  const photo = photoProbeForCover(input.layoutClass, input.regions);
  const photoSample = await sampleRegion(input.buffer, photo);
  if (
    photoSample &&
    Math.abs(photoSample.mean - MASK_FILL_LUM) < PHOTO_MEAN_DELTA_MIN &&
    photoSample.span <= SOLID_SPAN_MAX
  ) {
    return { ok: false, reason: "photo_not_guessable" };
  }

  if (printedNameOutsideMask(input)) {
    return { ok: false, reason: "printed_name_outside_mask" };
  }

  return { ok: true, reason: null };
}

/** Interior of the class name band. Must sit inside every registered full-width plate. */
function canonicalNameBand(layoutClass: LayoutClass): MaskRegion {
  if (layoutClass === "BOTTOM_PLAQUE") {
    return { xPct: 0, yPct: 84, wPct: 100, hPct: 16, type: "blur" };
  }
  return { xPct: 0, yPct: 0, wPct: 100, hPct: 16, type: "blur" };
}

function regionCovers(outer: MaskRegion, inner: MaskRegion): boolean {
  return (
    outer.xPct <= inner.xPct + 1 &&
    outer.yPct <= inner.yPct + 1 &&
    outer.xPct + outer.wPct >= inner.xPct + inner.wPct - 1 &&
    outer.yPct + outer.hPct >= inner.yPct + inner.hPct - 1
  );
}

function photoProbe(layoutClass: LayoutClass): MaskRegion {
  if (layoutClass === "TOP_PLATE") {
    return { xPct: 15, yPct: 42, wPct: 70, hPct: 22, type: "blur" };
  }
  if (layoutClass === "PSA_SLAB") {
    return { xPct: 20, yPct: 32, wPct: 60, hPct: 14, type: "blur" };
  }
  return { xPct: 15, yPct: 12, wPct: 70, hPct: 22, type: "blur" };
}

/**
 * Dual name bands (bottom 54/46 plus its top mirror) cover the usual photo probe.
 * Sample the largest gap between full-width bands instead. A card with no gap
 * keeps the class probe so a fully masked photo still fails.
 */
function photoProbeForCover(layoutClass: LayoutClass, regions: MaskRegion[]): MaskRegion {
  const probe = photoProbe(layoutClass);
  const cx = probe.xPct + probe.wPct / 2;
  const cy = probe.yPct + probe.hPct / 2;
  const covered = regions.some((region) =>
    cx >= region.xPct &&
    cx <= region.xPct + region.wPct &&
    cy >= region.yPct &&
    cy <= region.yPct + region.hPct
  );
  if (!covered) return probe;
  const gap = largestFullWidthGap(regions);
  if (!gap) return probe;
  const hPct = Math.min(gap.hPct - 1, 14);
  if (hPct < 2) return probe;
  return {
    xPct: 15,
    yPct: gap.yPct + (gap.hPct - hPct) / 2,
    wPct: 70,
    hPct,
    type: "blur",
  };
}

function largestFullWidthGap(regions: MaskRegion[]): { yPct: number; hPct: number } | null {
  const bands = regions
    .filter((region) => region.wPct >= 90 && region.hPct >= 12)
    .map((region) => ({ top: region.yPct, bottom: region.yPct + region.hPct }))
    .sort((a, b) => a.top - b.top);
  if (bands.length === 0) return null;
  const merged: Array<{ top: number; bottom: number }> = [];
  for (const band of bands) {
    const last = merged[merged.length - 1];
    if (last && band.top <= last.bottom) last.bottom = Math.max(last.bottom, band.bottom);
    else merged.push({ ...band });
  }
  let best: { yPct: number; hPct: number } | null = null;
  let cursor = 0;
  for (const band of merged) {
    const hPct = band.top - cursor;
    if (hPct > (best?.hPct ?? 0)) best = { yPct: cursor, hPct };
    cursor = Math.max(cursor, band.bottom);
  }
  const tail = 100 - cursor;
  if (tail > (best?.hPct ?? 0)) best = { yPct: cursor, hPct: tail };
  if (!best || best.hPct < 2) return null;
  return best;
}

function printedNameOutsideMask(input: {
  regions: MaskRegion[];
  nameBoxes?: NameTokenBox[];
  imageWidth: number;
  imageHeight: number;
}): boolean {
  const width = Math.max(1, input.imageWidth);
  const height = Math.max(1, input.imageHeight);
  for (const box of input.nameBoxes || []) {
    const cx = ((box.x + box.w / 2) / width) * 100;
    const cy = ((box.y + box.h / 2) / height) * 100;
    if (anyRegionCoversPoint(input.regions, cx, cy)) continue;
    if (cy <= 32 || cy >= 58) return true;
  }
  return false;
}

async function sampleRegion(
  buffer: Buffer,
  region: MaskRegion,
): Promise<{ mean: number; span: number } | null> {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const left = clamp(Math.round((region.xPct / 100) * width), 0, width - 1);
  const top = clamp(Math.round((region.yPct / 100) * height), 0, height - 1);
  const right = clamp(Math.round(((region.xPct + region.wPct) / 100) * width), left + 1, width);
  const bottom = clamp(Math.round(((region.yPct + region.hPct) / 100) * height), top + 1, height);
  const rw = right - left;
  const rh = bottom - top;
  if (rw < 2 || rh < 2) return null;

  const insetX = Math.min(Math.floor(rw * 0.08), Math.floor((rw - 1) / 2));
  const insetY = Math.min(Math.floor(rh * 0.08), Math.floor((rh - 1) / 2));
  const { data, info } = await sharp(buffer)
    .extract({
      left: left + insetX,
      top: top + insetY,
      width: Math.max(1, rw - insetX * 2),
      height: Math.max(1, rh - insetY * 2),
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let min = 255;
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
    sum += lum;
    count++;
  }
  if (count === 0) return null;
  return { mean: sum / count, span: max - min };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
