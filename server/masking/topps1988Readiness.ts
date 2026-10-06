/** A future bake promise cannot make this set playable. */
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { sql, type SQL } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { maskReadySidecarDir } from "./maskReadySidecar";
import { TOPPS_1988_SET_ID, TOPPS_1988_REVIEWED_SOURCES, isTopps1988Plan } from "./topps1988Geometry";
export function preparedTopps1988MaskFile(cardId: string, dir = maskReadySidecarDir()): string | null {
  if (!TOPPS_1988_REVIEWED_SOURCES.some((s) => s.cardId === cardId)) return null;
  const stem = path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}`);
  if (!existsSync(`${stem}.ok`) || existsSync(`${stem}.fail`) || !existsSync(`${stem}.jpg`)) return null;
  try {
    if (!statSync(`${stem}.jpg`).isFile() || statSync(`${stem}.jpg`).size === 0) return null;
    const plan = JSON.parse(readFileSync(`${stem}.json`, "utf8"));
    return plan.maskVersion === CURRENT_MASK_VERSION && isTopps1988Plan(plan) ? `${stem}.jpg` : null;
  } catch { return null; }
}
export function topps1988MaskReadySql(alias: "pc" | "playable_cards"): SQL {
  const a = (field: string) => sql.raw(`${alias}.${field}`);
  const ready = TOPPS_1988_REVIEWED_SOURCES.filter((s) => preparedTopps1988MaskFile(s.cardId));
  const witnessed = ready.length ? sql.join(ready.map((s) => sql`(${a("id")} = ${s.cardId} AND ${a("player")} = ${s.player} AND ${a("image_url")} = ${s.imageUrl} AND COALESCE(${a("image_rotation")},0) = 0)`), sql` OR `) : sql`false`;
  return sql`(${a("game_set_id")} IS DISTINCT FROM ${TOPPS_1988_SET_ID} OR (${witnessed}))`;
}
