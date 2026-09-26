import { db } from "../db";
import { dailyChallenges, gameSets } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

/** The one active set whose title stays unverified. */
export const UNVERIFIED_TITLE_SET_NAME = "2024 Basketball";
export const UNVERIFIED_TITLE_ID_PREFIX = "229f0379";

export function eligibleForTitleBackfill(row: {
  id: string;
  setName: string;
  isActive: boolean;
}): boolean {
  if (!row.isActive) return false;
  if (row.setName === UNVERIFIED_TITLE_SET_NAME) return false;
  if (row.id.startsWith(UNVERIFIED_TITLE_ID_PREFIX)) return false;
  return true;
}

/** Public name for Daily 5. Null hides the label. */
export async function verifiedGameSetTitle(setId: string): Promise<string | null> {
  const [row] = await db
    .select({ setName: gameSets.setName, titleVerified: gameSets.titleVerified })
    .from(gameSets)
    .where(eq(gameSets.id, setId))
    .limit(1);
  if (!row?.titleVerified) return null;
  const name = row.setName.trim();
  return name || null;
}

export async function verifiedGameSetTitleForChallenge(challengeId: string): Promise<string | null> {
  const [row] = await db
    .select({ setId: dailyChallenges.setId })
    .from(dailyChallenges)
    .where(eq(dailyChallenges.id, challengeId))
    .limit(1);
  if (!row?.setId) return null;
  return verifiedGameSetTitle(row.setId);
}

function titleEligibleSql() {
  return and(
    eq(gameSets.isActive, true),
    sql`${gameSets.setName} <> ${UNVERIFIED_TITLE_SET_NAME}`,
    sql`${gameSets.id} NOT LIKE ${UNVERIFIED_TITLE_ID_PREFIX + "%"}`,
  );
}

/**
 * One-time boot backfill. After any row is verified, later sets stay false
 * until an admin sets title_verified.
 */
export async function backfillVerifiedSetTitlesOnce(): Promise<number> {
  const rows = await db
    .update(gameSets)
    .set({ titleVerified: true })
    .where(and(
      titleEligibleSql(),
      sql`NOT EXISTS (SELECT 1 FROM game_sets AS already WHERE already.title_verified = true)`,
    ))
    .returning({ id: gameSets.id });
  return rows.length;
}

/** Same eligibility as the boot backfill, limited to these ids. */
export async function markEligibleSetTitlesVerified(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(gameSets)
    .set({ titleVerified: true })
    .where(and(inArray(gameSets.id, ids), titleEligibleSql()))
    .returning({ id: gameSets.id });
  return rows.map((row) => row.id);
}
