/**
 * One insert path for integrated (not user-created) game sets.
 * Locks the canonical identity for the transaction, then the partial unique
 * index rejects a second commit. User-created rows are not part of this key.
 */
import { and, eq, sql } from "drizzle-orm";
import { gameSets } from "@shared/schema";
import { db } from "../../db";
import { canonicalSetKey, collidingIdentities, type IdentityRow } from "./identity";

type InsertValues = {
  id?: string;
  sport: string;
  brand: string;
  year: number;
  setName: string;
  league?: string | null;
  isActive?: boolean;
  marketplaceKeywords?: string[];
  cardhedgeSetQuery?: string | null;
  cardhedgeCategory?: string | null;
  isUserCreated?: boolean;
  createdByUserId?: string | null;
  coCreatorUserId?: string | null;
  makerNote?: string | null;
};

export type IntegratedInsertResult =
  | { created: true; id: string }
  | { created: false; code: "exists"; id: string }
  | { created: false; code: "existing_identity"; matches: Pick<IdentityRow, "id" | "isActive" | "setName" | "year" | "brand" | "cards">[] };

function uniqueViolation(error: unknown): boolean {
  const value = error as { code?: string; cause?: { code?: string } };
  return value?.code === "23505" || value?.cause?.code === "23505";
}

export async function insertIntegratedGameSet(values: InsertValues): Promise<IntegratedInsertResult> {
  if (values.isUserCreated) {
    const [row] = await db.insert(gameSets).values(values).returning({ id: gameSets.id });
    return { created: true, id: row.id };
  }
  const key = canonicalSetKey(values);
  return db.transaction(async (tx) => {
    if (key) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    if (values.id) {
      const [same] = await tx.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.id, values.id)).limit(1);
      if (same) return { created: false, code: "exists", id: same.id };
    }
    if (key) {
      const candidates = await tx
        .select({
          id: gameSets.id,
          sport: gameSets.sport,
          year: gameSets.year,
          brand: gameSets.brand,
          setName: gameSets.setName,
          isActive: gameSets.isActive,
          isUserCreated: gameSets.isUserCreated,
        })
        .from(gameSets)
        .where(and(eq(gameSets.isUserCreated, false), eq(gameSets.year, values.year)));
      const collisions = collidingIdentities(values, candidates.map((row) => ({ ...row, cards: 0 })), values.id || "");
      if (collisions.length > 0) {
        return {
          created: false,
          code: "existing_identity",
          matches: collisions.map((row) => ({ id: row.id, isActive: row.isActive, setName: row.setName, year: row.year, brand: row.brand, cards: row.cards })),
        };
      }
    }
    try {
      const [row] = await tx.insert(gameSets).values({
        ...values,
        isUserCreated: false,
        canonicalIdentity: key,
      }).returning({ id: gameSets.id });
      return { created: true, id: row.id };
    } catch (error) {
      if (!uniqueViolation(error) || !key) throw error;
      const [owner] = await tx.select({ id: gameSets.id, isActive: gameSets.isActive, setName: gameSets.setName, year: gameSets.year, brand: gameSets.brand })
        .from(gameSets).where(eq(gameSets.canonicalIdentity, key)).limit(1);
      if (!owner) throw error;
      return { created: false, code: "existing_identity", matches: [{ ...owner, cards: 0 }] };
    }
  });
}
