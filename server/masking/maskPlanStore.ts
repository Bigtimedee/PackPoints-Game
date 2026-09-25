import { existsSync, readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { toPublicMaskPlan } from "@shared/maskPlan";
import type { MaskRegion, PublicMaskPlan } from "@shared/schema";

export const MASKED_CARDS_DIR = path.join(process.cwd(), "data", "masked-cards");

export function warmMaskPlanFilename(cardId: string): string {
  return `${cardId}_${CURRENT_MASK_VERSION}.json`;
}

export interface StoredMaskPlan {
  layoutClass: string;
  regions: MaskRegion[];
  maskVersion: string;
}

/** Disk read for the current bake plan. No database. Missing file is a cold bake. */
export function readWarmMaskPlan(cardId: string): PublicMaskPlan | null {
  if (!cardId) return null;
  const filePath = path.join(MASKED_CARDS_DIR, warmMaskPlanFilename(cardId));
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return toPublicMaskPlan(raw);
  } catch {
    return null;
  }
}

export async function writeWarmMaskPlan(cardId: string, plan: StoredMaskPlan): Promise<void> {
  await fs.mkdir(MASKED_CARDS_DIR, { recursive: true });
  const filePath = path.join(MASKED_CARDS_DIR, warmMaskPlanFilename(cardId));
  const body = JSON.stringify({
    layoutClass: plan.layoutClass,
    regions: plan.regions.map((region) => ({
      xPct: region.xPct,
      yPct: region.yPct,
      wPct: region.wPct,
      hPct: region.hPct,
      type: region.type,
      ...(region.radiusPct != null ? { radiusPct: region.radiusPct } : {}),
    })),
    maskVersion: plan.maskVersion,
  });
  await fs.writeFile(filePath, body);
}
