/**
 * Active integrated sets stay out of deals and public set pages until Design
 * has cleared that exact id. A registered mask profile is not enough.
 * no_mask_profile wins when the profile is missing, including when the id is
 * only in CLEARED_SET_IDS_EXTRA. The deleted 1990 Hoops id is not a hold key.
 * A re-import matches by identity and is held until its new id is cleared.
 */
import { and, eq } from "drizzle-orm";
import { buildSetMaskHint } from "@shared/maskGeometry";
import { gameSets } from "@shared/schema";
import { db } from "../db";
import { getMaskProfile, profileIsRegistered } from "../masking/maskProfiles";

export const NO_MASK_PROFILE_REASON = "no_mask_profile";
export const AWAITING_DESIGN_CLEARANCE_REASON = "awaiting_design_clearance";

/**
 * Live sets Design has released. A registered profile does not add an id.
 * The two OCR-default sets are included so their existing bakes stay dealable.
 */
export const CLEARED_SET_IDS = [
  "37fd025d-2ae1-4c92-b8ad-133375d0c722",
  "91cfdf3f-a620-4e73-adc8-22b8df221716",
  "aea515e2-24bc-42bd-a602-1514b89e8cd1",
  "352b33d1-c110-4e09-b641-8e3c02a94442",
  "a09b2fe7-728e-431b-9df8-bbf2652aa3b2",
  "74885a41-2043-4b7c-ab58-f9e16c05e2e3",
  "229f0379-aa56-40a8-abe3-1af217a397e8",
] as const;

export const DONRUSS_1987_HOLD_ID = "3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4";

export function clearedSetIds(): Set<string> {
  const ids = new Set<string>(CLEARED_SET_IDS.map((id) => id.toLowerCase()));
  const extra = process.env.CLEARED_SET_IDS_EXTRA ?? "";
  for (const part of extra.split(",")) {
    const id = part.trim().toLowerCase();
    if (id) ids.add(id);
  }
  // Containment wins over an old environment clearance until card QA is complete.
  ids.delete(DONRUSS_1987_HOLD_ID);
  return ids;
}

export function isClearedSetId(id: string | null | undefined): boolean {
  if (!id) return false;
  return clearedSetIds().has(id.trim().toLowerCase());
}

export interface HeldSetRecord {
  id: string;
  reason: string;
}

export interface MaskSetIdentity {
  id?: string | null;
  year?: number | null;
  brand?: string | null;
  sport?: string | null;
  setName?: string | null;
  category?: string | null;
  isActive?: boolean | null;
  isUserCreated?: boolean | null;
}

let heldRecords: HeldSetRecord[] = [];
let refreshGeneration = 0;

export function maskProfileForSet(set: MaskSetIdentity) {
  return getMaskProfile(buildSetMaskHint(set), set.id);
}

export function setHasRegisteredMaskProfile(set: MaskSetIdentity): boolean {
  return profileIsRegistered(maskProfileForSet(set), set.id);
}

/**
 * null when this active integrated set may be dealt.
 * A user-created or inactive row is not a hold. Callers that already filtered
 * those leave the flags unset.
 */
export function holdReasonForIdentity(set: MaskSetIdentity): string | null {
  if (set.isUserCreated) return null;
  if (set.isActive === false) return null;
  if (!setHasRegisteredMaskProfile(set)) return NO_MASK_PROFILE_REASON;
  if (!set.id || !isClearedSetId(set.id)) return AWAITING_DESIGN_CLEARANCE_REASON;
  return null;
}

export function currentHeldSetIds(): readonly string[] {
  return heldRecords.map((row) => row.id);
}

export function heldSetReason(id: string | null | undefined): string | null {
  if (!id) return null;
  const key = id.trim().toLowerCase();
  return heldRecords.find((row) => row.id.toLowerCase() === key)?.reason ?? null;
}

export function isHeldSet(id: string | null | undefined): boolean {
  return heldSetReason(id) != null;
}

export async function refreshHeldSets(): Promise<HeldSetRecord[]> {
  const ticket = ++refreshGeneration;
  const rows = await db
    .select({
      id: gameSets.id,
      year: gameSets.year,
      brand: gameSets.brand,
      sport: gameSets.sport,
      setName: gameSets.setName,
    })
    .from(gameSets)
    .where(and(eq(gameSets.isActive, true), eq(gameSets.isUserCreated, false)));

  const next = rows
    .map((row) => {
      const reason = holdReasonForIdentity(row);
      return reason ? { id: row.id, reason } : null;
    })
    .filter((row): row is HeldSetRecord => row != null)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (ticket !== refreshGeneration) return heldRecords;
  const prev = heldRecords.map((row) => `${row.id}:${row.reason}`).join(",");
  heldRecords = next;
  const now = heldRecords.map((row) => `${row.id}:${row.reason}`).join(",");
  if (prev !== now) {
    const { invalidatePublicMaskSetCache } = await import("../services/publicMaskGate");
    invalidatePublicMaskSetCache();
  }
  return heldRecords;
}

export async function ensureHeldSets(): Promise<void> {
  await refreshHeldSets();
}

/**
 * Marks fixture set ids as Design-cleared for this process.
 * The returned function puts CLEARED_SET_IDS_EXTRA back.
 */
export async function releaseSetsForTests(ids: string[]): Promise<() => Promise<void>> {
  const previous = process.env.CLEARED_SET_IDS_EXTRA;
  const merged = new Set<string>();
  for (const part of (previous ?? "").split(",")) {
    const id = part.trim();
    if (id) merged.add(id);
  }
  for (const id of ids) {
    const trimmed = id.trim();
    if (trimmed) merged.add(trimmed);
  }
  process.env.CLEARED_SET_IDS_EXTRA = [...merged].join(",");
  await refreshHeldSets();
  return async () => {
    if (previous === undefined) delete process.env.CLEARED_SET_IDS_EXTRA;
    else process.env.CLEARED_SET_IDS_EXTRA = previous;
    await refreshHeldSets();
  };
}

/** One boot line. Each held set is the first 8 id characters and its reason. */
export async function logHeldSets(): Promise<void> {
  const rows = await refreshHeldSets();
  const body = rows.length === 0
    ? "none"
    : rows.map((row) => `${row.id.slice(0, 8)}:${row.reason}`).join(",");
  console.log(`[HeldSets] ${body}`);
}
