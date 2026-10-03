/** Donruss must never be offered or dealt on the promise of a future bake. */
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { sql, type SQL } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { MASK_LAYOUT_SET_IDS } from "./maskProfiles";
import { maskReadySidecarDir } from "./maskReadySidecar";

export function readyDonrussCardIds(dir = maskReadySidecarDir()): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const suffix = `_${CURRENT_MASK_VERSION}.ok`;
  return names.filter((name) => name.endsWith(suffix)).map((name) => name.slice(0, -suffix.length)).filter((id) => {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) return false;
    if (existsSync(path.join(dir, `${id}_${CURRENT_MASK_VERSION}.fail`))) return false;
    const jpeg = ["", "_r90", "_r180", "_r270"].some((rotation) =>
      existsSync(path.join(dir, `${id}_${CURRENT_MASK_VERSION}${rotation}.jpg`)));
    if (!jpeg) return false;
    try {
      const plan = JSON.parse(readFileSync(path.join(dir, `${id}_${CURRENT_MASK_VERSION}.json`), "utf8"));
      const [band] = plan.regions ?? [];
      return plan.maskVersion === CURRENT_MASK_VERSION && plan.layoutClass === "BOTTOM_PLAQUE"
        && plan.regions.length === 1 && band.xPct === 0 && band.yPct === 84
        && band.wPct === 100 && band.hPct === 16 && band.type === "blur";
    } catch { return false; }
  });
}

export function donrussMaskReadySql(alias: "pc" | "playable_cards"): SQL {
  const ids = readyDonrussCardIds();
  const ready = ids.length ? sql`${sql.raw(`${alias}.id`)} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})` : sql`false`;
  return sql`(${sql.raw(`${alias}.game_set_id`)} IS DISTINCT FROM ${MASK_LAYOUT_SET_IDS.donrussBaseball1987} OR ${ready})`;
}
