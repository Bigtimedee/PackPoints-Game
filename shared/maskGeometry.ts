import { DEFAULT_MASK_REGIONS, type MaskRegion } from "./schema";

/**
 * Bump whenever baked JPEG geometry, OCR rules, or fill change.
 * Cache keys and `?v=` URLs follow this.
 * v4.5 extends the name band from the detected plate on this scan. A fixed
 * fraction tuned on a ~750x1030 file ends through the glyphs on a tight crop.
 * v4.4 JPEGs and `{cardId}_v4.4.ok` sidecars are stale and are not served.
 * Cards rotated upright before the mask use a filename suffix
 * (`_r90`, `_r180`, `_r270`) in addition to the version.
 */
export const CURRENT_MASK_VERSION = "v4.5";

/**
 * Profile fractions (Fleer top 18%, and the other named bands) were tuned on
 * this scan. It still includes the outer margin. A tighter crop drops that
 * margin and keeps the plate, so the same fraction of the shorter file ends
 * inside the letters.
 */
export const PROFILE_REFERENCE_WIDTH = 750;
export const PROFILE_REFERENCE_HEIGHT = 1030;

export interface NamePlateBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Narrower than the reference scan. The plate is a larger share of the frame. */
export function tightCropBoost(imageWidth: number, imageHeight: number): number {
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);
  const aspect = width / height;
  const reference = PROFILE_REFERENCE_WIDTH / PROFILE_REFERENCE_HEIGHT;
  if (aspect >= reference - 0.001) return 1;
  return reference / aspect;
}

/**
 * Full-width name band for this file.
 * The bottom (or top) edge is the detected plate, plus padding, and at least
 * the profile fraction grown for a tight crop. It never stops above the plate.
 */
export function fitNamePlateBand(input: {
  anchor: "top" | "bottom";
  imageWidth: number;
  imageHeight: number;
  /** Profile band as a fraction of the reference scan (0.18 = top 18%). */
  profileFraction: number;
  plate: NamePlateBox;
}): MaskRegion {
  const width = Math.max(1, input.imageWidth);
  const height = Math.max(1, input.imageHeight);
  const fraction = Math.min(0.72, Math.max(0, input.profileFraction));
  const boost = tightCropBoost(width, height);
  const floorPx = fraction * height * boost;
  const pad = Math.max(8, input.plate.h * 0.45, height * 0.025);
  if (input.anchor === "bottom") {
    const topPx = Math.max(0, Math.min(input.plate.y - pad, height - floorPx));
    return clampRegion({
      xPct: 0,
      yPct: (topPx / height) * 100,
      wPct: 100,
      hPct: ((height - topPx) / height) * 100,
      type: "blur",
      radiusPct: 0,
    });
  }
  const plateBottom = input.plate.y + input.plate.h;
  const bottomPx = Math.min(height, Math.max(plateBottom + pad, floorPx));
  return clampRegion({
    xPct: 0,
    yPct: 0,
    wPct: 100,
    hPct: (bottomPx / height) * 100,
    type: "blur",
    radiusPct: 0,
  });
}

/** True when the band's rectangle contains the plate, in source pixels. */
export function regionCoversPlate(
  region: MaskRegion,
  plate: NamePlateBox,
  imageWidth: number,
  imageHeight: number,
): boolean {
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);
  const left = (region.xPct / 100) * width;
  const right = ((region.xPct + region.wPct) / 100) * width;
  const top = (region.yPct / 100) * height;
  const bottom = ((region.yPct + region.hPct) / 100) * height;
  return left <= plate.x + 0.5
    && right >= plate.x + plate.w - 0.5
    && top <= plate.y + 0.5
    && bottom >= plate.y + plate.h - 0.5;
}

export function maskedCardImageUrl(cardId: string): string {
  return `/api/cards/${encodeURIComponent(cardId)}/masked-image?v=${CURRENT_MASK_VERSION}`;
}

export function cloneRegion(region: MaskRegion): MaskRegion {
  return { ...region };
}

export function regionsEqual(a: MaskRegion[] | null | undefined, b: MaskRegion[] | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((region, i) => {
    const other = b[i];
    return (
      region.xPct === other.xPct &&
      region.yPct === other.yPct &&
      region.wPct === other.wPct &&
      region.hPct === other.hPct &&
      region.type === other.type
    );
  });
}

export function isMaskSetUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function buildSetMaskHint(parts: {
  year?: number | null;
  brand?: string | null;
  sport?: string | null;
  setName?: string | null;
  category?: string | null;
}): string {
  return [parts.year, parts.brand, parts.sport, parts.setName, parts.category]
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" ");
}

/** Client overlay always has at least one region (security invariant). */
export function overlayMaskRegions(regions: MaskRegion[] | null | undefined): MaskRegion[] {
  if (regions && regions.length > 0) return regions.map(cloneRegion);
  return DEFAULT_MASK_REGIONS.map(cloneRegion);
}

/**
 * Plaque class from the regions that were actually painted.
 * Top band only: TOP_PLATE. Bottom band only: BOTTOM_PLAQUE. Both: PSA_SLAB.
 */
export function inferLayoutClass(regions: MaskRegion[]): "TOP_PLATE" | "BOTTOM_PLAQUE" | "PSA_SLAB" {
  const full = regions.filter((region) => region.wPct >= 90);
  const bands = full.length > 0 ? full : regions;
  const top = bands.some((region) => region.yPct <= 2);
  const bottom = bands.some((region) => region.yPct >= 40);
  if (top && bottom) return "PSA_SLAB";
  if (top) return "TOP_PLATE";
  return "BOTTOM_PLAQUE";
}

export function largestMaskRegion(regions: MaskRegion[]): MaskRegion | null {
  if (regions.length === 0) return null;
  return regions.reduce((best, region) => {
    const area = region.wPct * region.hPct;
    const bestArea = best.wPct * best.hPct;
    return area > bestArea ? region : best;
  });
}

export function unionMaskRegions(regions: MaskRegion[]): MaskRegion[] {
  const out: MaskRegion[] = [];
  for (const region of regions) {
    const next = clampRegion(region);
    if (next.wPct <= 0 || next.hPct <= 0) continue;
    const hit = out.findIndex((existing) => regionsOverlap(existing, next, 2));
    if (hit === -1) {
      out.push(next);
      continue;
    }
    out[hit] = mergeTwoRegions(out[hit], next);
  }
  return out;
}

export function clampRegion(region: MaskRegion): MaskRegion {
  const xPct = Math.max(0, Math.min(100, region.xPct));
  const yPct = Math.max(0, Math.min(100, region.yPct));
  const wPct = Math.max(0, Math.min(100 - xPct, region.wPct));
  const hPct = Math.max(0, Math.min(100 - yPct, region.hPct));
  return { ...region, xPct, yPct, wPct, hPct };
}

function regionsOverlap(a: MaskRegion, b: MaskRegion, padPct: number): boolean {
  return !(
    a.xPct + a.wPct + padPct < b.xPct ||
    b.xPct + b.wPct + padPct < a.xPct ||
    a.yPct + a.hPct + padPct < b.yPct ||
    b.yPct + b.hPct + padPct < a.yPct
  );
}

function mergeTwoRegions(a: MaskRegion, b: MaskRegion): MaskRegion {
  const xPct = Math.min(a.xPct, b.xPct);
  const yPct = Math.min(a.yPct, b.yPct);
  const right = Math.max(a.xPct + a.wPct, b.xPct + b.wPct);
  const bottom = Math.max(a.yPct + a.hPct, b.yPct + b.hPct);
  return {
    xPct,
    yPct,
    wPct: right - xPct,
    hPct: bottom - yPct,
    type: a.type === "solid" || b.type === "solid" ? "solid" : a.type,
    radiusPct: a.radiusPct || b.radiusPct,
  };
}

export function pixelBoxToRegion(
  box: { x: number; y: number; w: number; h: number },
  imageWidth: number,
  imageHeight: number,
): MaskRegion {
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);
  return clampRegion({
    xPct: (box.x / width) * 100,
    yPct: (box.y / height) * 100,
    wPct: (box.w / width) * 100,
    hPct: (box.h / height) * 100,
    type: "blur",
  });
}

export function regionCoversPoint(region: MaskRegion, xPct: number, yPct: number): boolean {
  return (
    xPct >= region.xPct &&
    xPct <= region.xPct + region.wPct &&
    yPct >= region.yPct &&
    yPct <= region.yPct + region.hPct
  );
}

export function anyRegionCoversPoint(regions: MaskRegion[], xPct: number, yPct: number): boolean {
  return regions.some((region) => regionCoversPoint(region, xPct, yPct));
}
