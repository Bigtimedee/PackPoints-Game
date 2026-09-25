import type { MaskRegion, PublicMaskPlan } from "./schema";
import { CURRENT_MASK_VERSION } from "./maskGeometry";

const PLAY_LAYOUTS = new Set(["TOP_PLATE", "BOTTOM_PLAQUE", "PSA_SLAB"]);

/**
 * Wire shape for a bake plan. Copies geometry only.
 * Player name, card number, and team are dropped even if a caller passes them.
 */
export function toPublicMaskPlan(input: unknown): PublicMaskPlan | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const layoutClass = record.layoutClass;
  if (typeof layoutClass !== "string" || !PLAY_LAYOUTS.has(layoutClass)) return null;
  if (!Array.isArray(record.regions) || record.regions.length === 0) return null;

  const regions: MaskRegion[] = [];
  for (const region of record.regions) {
    if (!region || typeof region !== "object") return null;
    const source = region as Record<string, unknown>;
    const xPct = Number(source.xPct);
    const yPct = Number(source.yPct);
    const wPct = Number(source.wPct);
    const hPct = Number(source.hPct);
    const type = source.type;
    if (![xPct, yPct, wPct, hPct].every((value) => Number.isFinite(value))) return null;
    if (type !== "solid" && type !== "blur" && type !== "pixelate") return null;
    const next: MaskRegion = { xPct, yPct, wPct, hPct, type };
    if (typeof source.radiusPct === "number" && Number.isFinite(source.radiusPct)) {
      next.radiusPct = source.radiusPct;
    }
    regions.push(next);
  }

  const maskVersion = typeof record.maskVersion === "string" && record.maskVersion.length > 0
    ? record.maskVersion
    : CURRENT_MASK_VERSION;

  return {
    layoutClass: layoutClass as PublicMaskPlan["layoutClass"],
    regions,
    maskVersion,
  };
}
