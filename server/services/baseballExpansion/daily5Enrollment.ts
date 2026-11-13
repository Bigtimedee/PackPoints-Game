/**
 * Daily 5 enrollment for a missing expansion set.
 *
 * Eligible only when all of these are known and true:
 * the id is in the expansion registry with role missing, it is not excluded
 * (1991 Upper Deck), an active unrevoked release manifest exists, and the
 * set is not held. Anything unknown stays blocked.
 *
 * Live registry ids are not this gate. CLEARED_SET_IDS still releases them.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { expansionReleaseManifests } from "@shared/schema";
import { db } from "../../db";
import { ensureHeldSets, isHeldSet } from "../../config/heldSets";
import {
  expansionTargetById,
  expansionTargetBySlug,
  isDaily5ExpansionExcluded,
} from "./registry";

/** Same fact as expansionSetIsCleared: one unrevoked manifest row. */
export async function expansionReleaseManifestActive(id: string): Promise<boolean> {
  const [row] = await db.select({ id: expansionReleaseManifests.id }).from(expansionReleaseManifests).where(and(
    eq(expansionReleaseManifests.setId, id),
    isNull(expansionReleaseManifests.revokedAt),
  )).limit(1);
  return Boolean(row);
}

export interface Daily5ExpansionFacts {
  registry: "missing" | "live" | "absent";
  excluded: boolean;
  release: "active" | "inactive" | "unknown";
  held: "yes" | "no" | "unknown";
}

/**
 * null when this id is not blocked by the expansion gate.
 * `held` only when a confirmed active manifest is still held.
 * Every other failure, including an unknown fact, is expansion_not_enrolled.
 */
export function daily5ExpansionSkipReasonFromFacts(facts: Daily5ExpansionFacts): "held" | "expansion_not_enrolled" | null {
  if (facts.registry !== "missing") return null;
  if (facts.excluded) return "expansion_not_enrolled";
  if (facts.release === "unknown" || facts.held === "unknown") return "expansion_not_enrolled";
  if (facts.release !== "active") return "expansion_not_enrolled";
  if (facts.held === "yes") return "held";
  return null;
}

export async function loadDaily5ExpansionFacts(id: string): Promise<Daily5ExpansionFacts> {
  const target = expansionTargetById(id);
  const registry = !target ? "absent" : target.role === "live" ? "live" : "missing";
  const excluded = isDaily5ExpansionExcluded(id);
  if (registry !== "missing" || excluded) {
    return { registry, excluded, release: "inactive", held: "unknown" };
  }
  let release: Daily5ExpansionFacts["release"] = "unknown";
  let held: Daily5ExpansionFacts["held"] = "unknown";
  try {
    release = (await expansionReleaseManifestActive(id)) ? "active" : "inactive";
  } catch {
    release = "unknown";
  }
  try {
    await ensureHeldSets();
    held = isHeldSet(id) ? "yes" : "no";
  } catch {
    held = "unknown";
  }
  return { registry, excluded, release, held };
}

export async function daily5ExpansionSkipReason(id: string): Promise<"held" | "expansion_not_enrolled" | null> {
  try {
    return daily5ExpansionSkipReasonFromFacts(await loadDaily5ExpansionFacts(id));
  } catch {
    return isDaily5ExpansionExcluded(id) || expansionTargetById(id)?.role === "missing"
      ? "expansion_not_enrolled"
      : null;
  }
}

/**
 * Active released expansion ids in manifest order (created_at, then id).
 * A later release appends. A query or hold-refresh failure returns [] so
 * the calendar is not rewritten from an unknown list.
 */
export async function releasedExpansionRotationIds(): Promise<string[]> {
  let rows: { setId: string }[];
  try {
    rows = await db
      .select({ setId: expansionReleaseManifests.setId })
      .from(expansionReleaseManifests)
      .where(isNull(expansionReleaseManifests.revokedAt))
      .orderBy(asc(expansionReleaseManifests.createdAt), asc(expansionReleaseManifests.setId));
    await ensureHeldSets();
  } catch {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.setId.trim().toLowerCase();
    if (seen.has(id)) continue;
    if (expansionTargetById(id)?.role !== "missing") continue;
    const reason = daily5ExpansionSkipReasonFromFacts({
      registry: "missing",
      excluded: isDaily5ExpansionExcluded(id),
      release: "active",
      held: isHeldSet(id) ? "yes" : "no",
    });
    if (reason != null) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Registry slug for a released, unheld expansion set. Held, unreleased, and excluded slugs return null. */
export async function releasedExpansionIdForSlug(slug: string | null | undefined): Promise<string | null> {
  const target = expansionTargetBySlug(slug);
  if (!target || target.role !== "missing") return null;
  try {
    const reason = daily5ExpansionSkipReasonFromFacts(await loadDaily5ExpansionFacts(target.id));
    if (reason) return null;
    return target.id;
  } catch {
    return null;
  }
}
