import { DEFAULT_MASK_REGIONS, type MaskRegion } from "./schema";

/**
 * Bump whenever baked JPEG geometry, OCR rules, or fill change.
 * Cache keys and `?v=` URLs follow this.
 * Stay on v4.4 while painted pixels match v4.4. The plaque plan is a sidecar
 * and nullable columns written on the next natural bake. A version bump would
 * rebake warm JPEGs through the coverage gate.
 */
export const CURRENT_MASK_VERSION = "v4.4";

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
