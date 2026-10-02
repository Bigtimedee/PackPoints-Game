/**
 * Active integrated sets with no registered mask profile stay out of deals
 * and public set pages. A set is released when its year, brand, sport, and
 * name resolve in server/masking/maskProfiles.ts.
 * The deleted 1990 Hoops id is not a hold key. A re-import matches by identity.
 */
import { and, eq } from "drizzle-orm";
import { buildSetMaskHint } from "@shared/maskGeometry";
import { gameSets } from "@shared/schema";
import { db } from "../db";
import { getMaskProfile, profileIsRegistered } from "../masking/maskProfiles";

export const NO_MASK_PROFILE_REASON = "no_mask_profile";

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
}

let heldRecords: HeldSetRecord[] = [];
let refreshGeneration = 0;

export function maskProfileForSet(set: MaskSetIdentity) {
  return getMaskProfile(buildSetMaskHint(set), set.id);
}

export function setHasRegisteredMaskProfile(set: MaskSetIdentity): boolean {
  return profileIsRegistered(maskProfileForSet(set), set.id);
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
    .filter((row) => !setHasRegisteredMaskProfile(row))
    .map((row) => ({ id: row.id, reason: NO_MASK_PROFILE_REASON }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (ticket !== refreshGeneration) return heldRecords;
  heldRecords = next;
  return heldRecords;
}

export async function ensureHeldSets(): Promise<void> {
  await refreshHeldSets();
}

/** One boot line. Each held set is the first 8 id characters and its reason. */
export async function logHeldSets(): Promise<void> {
  const rows = await refreshHeldSets();
  const body = rows.length === 0
    ? "none"
    : rows.map((row) => `${row.id.slice(0, 8)}:${row.reason}`).join(",");
  console.log(`[HeldSets] ${body}`);
}
