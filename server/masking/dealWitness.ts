/**
 * A deal, a shelf count, Daily 5, a cover pick, and a 1v1 draw share this
 * witness. Established cards have either a successful current-version bake
 * (`{cardId}_v4.6.ok` plus the masked JPEG) or a mask-plan file whose
 * layoutClass is the band placement (`TOP_PLATE`, `BOTTOM_PLAQUE`, `PSA_SLAB`).
 * Clearing a fail sidecar does not create either one.
 *
 * An active expansion release member is witnessed by that manifest.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";
import { sql, type SQL } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { MASKED_CARDS_DIR } from "./maskPlanStore";
import { maskReadySidecarDir } from "./maskReadySidecar";

const LAYOUTS = new Set(["TOP_PLATE", "BOTTOM_PLAQUE", "PSA_SLAB"]);
const OK_SUFFIX = `_${CURRENT_MASK_VERSION}.ok`;
const JSON_SUFFIX = `_${CURRENT_MASK_VERSION}.json`;
const FAIL_SUFFIX = `_${CURRENT_MASK_VERSION}.fail`;
const JPEG_ROTATIONS = ["", "_r90", "_r180", "_r270"] as const;

type CardAlias = "pc" | "playable_cards";

export interface DealWitnessIndex {
  active: boolean;
  ids: string[];
}

let cache: { dir: string; mtimeMs: number; index: DealWitnessIndex } | null = null;

export function resetDealWitnessCacheForTests(): void {
  cache = null;
}

/** Test helper. Writes the current-version success marker and a masked JPEG. */
export function writeDealWitnessBakeForTests(cardId: string, dir = maskReadySidecarDir()): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${cardId}${OK_SUFFIX}`), "ok\n");
  writeFileSync(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from(`masked-${cardId}`));
  cache = null;
}

function safeCardId(cardId: string): boolean {
  return Boolean(cardId)
    && cardId.length <= 100
    && !cardId.includes("/")
    && !cardId.includes("\\")
    && !cardId.includes("..")
    && !cardId.includes("\0");
}

/** Same layoutClass values as coverBandPlacement. Null when the plan file is absent or unreadable. */
export function recordedBandPlacement(cardId: string, dir: string): string | null {
  if (!safeCardId(cardId)) return null;
  const filePath = path.join(dir, `${cardId}${JSON_SUFFIX}`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as { layoutClass?: unknown };
    const layout = raw.layoutClass;
    return typeof layout === "string" && LAYOUTS.has(layout) ? layout : null;
  } catch {
    return null;
  }
}

/** `{cardId}_v4.6.ok` plus a current-version masked JPEG. The JPEG may be rotated. */
export function successfulBake(cardId: string, dir: string): boolean {
  if (!safeCardId(cardId)) return false;
  if (!existsSync(path.join(dir, `${cardId}${OK_SUFFIX}`))) return false;
  return JPEG_ROTATIONS.some((rotation) => existsSync(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}${rotation}.jpg`)));
}

function scanDealWitness(dir: string): DealWitnessIndex {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return { active: false, ids: [] };
  }
  let active = false;
  const ids = new Set<string>();
  for (const name of names) {
    let cardId = "";
    if (name.endsWith(OK_SUFFIX)) cardId = name.slice(0, -OK_SUFFIX.length);
    else if (name.endsWith(JSON_SUFFIX)) cardId = name.slice(0, -JSON_SUFFIX.length);
    else if (name.endsWith(FAIL_SUFFIX)) cardId = name.slice(0, -FAIL_SUFFIX.length);
    else continue;
    active = true;
    if (!safeCardId(cardId)) continue;
    if (successfulBake(cardId, dir) || recordedBandPlacement(cardId, dir)) ids.add(cardId);
  }
  return { active, ids: [...ids] };
}

export function dealWitnessIndex(dir = maskReadySidecarDir()): DealWitnessIndex {
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(dir).mtimeMs;
  } catch {
    mtimeMs = -1;
  }
  if (cache && cache.dir === dir && cache.mtimeMs === mtimeMs) return cache.index;
  const index = scanDealWitness(dir);
  cache = { dir, mtimeMs, index };
  return index;
}

/**
 * Fixture tests that leave the mask directory at its default have no volume.
 * Production, and any test that points the sidecar directory at a temp folder,
 * require a bake or a recorded band placement.
 */
function dealWitnessRequired(): boolean {
  if (process.env.NODE_ENV === "test" && maskReadySidecarDir() === MASKED_CARDS_DIR) return false;
  return true;
}

/** True when this card may be counted and dealt. */
export function dealWitnessSql(alias: CardAlias): SQL {
  if (!dealWitnessRequired()) return sql`true`;
  const index = dealWitnessIndex();
  const id = sql.raw(`${alias}.id`);
  const witnessed = index.ids.length
    ? sql`${id} = ANY(${sql.param(index.ids)}::varchar[])`
    : sql`false`;
  return sql`(
    ${witnessed}
    OR ${id} IN (
      SELECT dm.playable_card_id
      FROM expansion_release_members rm
      INNER JOIN expansion_release_manifests mf ON mf.id = rm.manifest_id AND mf.revoked_at IS NULL
      INNER JOIN discovery_cohort_members dm ON dm.member_key = rm.member_key
      WHERE dm.playable_card_id IS NOT NULL
    )
  )`;
}
