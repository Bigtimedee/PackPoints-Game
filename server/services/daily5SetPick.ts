/**
 * Daily 5 set pick: the active integrated set with the most imported cards.
 * Held sets and user-created sets are not candidates.
 */
import { and, desc, eq, notInArray } from "drizzle-orm";
import { gameSets } from "@shared/schema";
import { db } from "../db";
import { currentHeldSetIds, ensureHeldSets } from "../config/heldSets";

export async function pickDaily5Set(): Promise<{ id: string; setName: string } | null> {
  await ensureHeldSets();
  const heldIds = currentHeldSetIds();
  const filters = [
    eq(gameSets.isActive, true),
    eq(gameSets.isUserCreated, false),
  ];
  if (heldIds.length > 0) {
    filters.push(notInArray(gameSets.id, [...heldIds]));
  }
  const [row] = await db
    .select({ id: gameSets.id, setName: gameSets.setName })
    .from(gameSets)
    .where(and(...filters))
    .orderBy(desc(gameSets.cardsImportedCount))
    .limit(1);
  return row ?? null;
}
