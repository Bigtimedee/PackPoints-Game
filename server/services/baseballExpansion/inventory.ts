import { and, gte, lte, sql } from "drizzle-orm";
import { gameSets } from "@shared/schema";
import { db } from "../../db";
import { collidingIdentities, type IdentityRow } from "./identity";
import { BASEBALL_EXPANSION_TARGETS, type ExpansionTarget } from "./registry";

export async function baseballIdentityRows(): Promise<IdentityRow[]> {
  const sets = await db
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
    .where(and(
      gte(gameSets.year, 1986),
      lte(gameSets.year, 1991),
      sql`lower(${gameSets.sport}) in ('baseball', 'mlb')`,
    ));
  const ids = sets.map((row) => row.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const grouped = await db.execute<{ game_set_id: string; n: number }>(sql`
      SELECT game_set_id, count(*)::int AS n FROM playable_cards
      WHERE game_set_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      GROUP BY game_set_id`);
    for (const row of grouped.rows ?? []) counts.set(row.game_set_id, Number(row.n) || 0);
  }
  return sets.map((row) => ({
    id: row.id,
    sport: row.sport,
    year: row.year,
    brand: row.brand,
    setName: row.setName,
    isActive: row.isActive,
    isUserCreated: row.isUserCreated,
    cards: counts.get(row.id) ?? 0,
  }));
}

export function inventoryView(target: ExpansionTarget, rows: readonly IdentityRow[]) {
  const sameId = rows.find((row) => row.id.toLowerCase() === target.id.toLowerCase()) ?? null;
  return {
    slug: target.slug,
    setId: target.id,
    role: target.role,
    year: target.identity.year,
    brand: target.identity.brand,
    setName: target.identity.setName,
    baseCount: target.baseCount,
    insertsEnabled: target.baseCount != null,
    createAllowed: target.role === "missing",
    daily5Blocked: target.role === "missing",
    existing: sameId ? { id: sameId.id, isActive: sameId.isActive, cards: sameId.cards } : null,
    collisions: collidingIdentities(target.identity, rows, target.id).map((row) => ({
      id: row.id,
      isActive: row.isActive,
      setName: row.setName,
      year: row.year,
      brand: row.brand,
      cards: row.cards,
    })),
  };
}

export async function listExpansionInventory() {
  const rows = await baseballIdentityRows();
  return {
    targets: BASEBALL_EXPANSION_TARGETS.length,
    missing: BASEBALL_EXPANSION_TARGETS.filter((target) => target.role === "missing").length,
    sets: BASEBALL_EXPANSION_TARGETS.map((target) => inventoryView(target, rows)),
  };
}
