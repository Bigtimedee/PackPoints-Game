/**
 * Active integrated sets the game can deal.
 * Shared by GET /api/sets and Daily 5 rotation. Do not copy this query.
 */
import { and, asc, eq } from "drizzle-orm";
import { gameSets, users } from "@shared/schema";
import { db } from "../db";
import { userSetPlayCountSql } from "../routes/userSetCounts";
import {
  dedupeSetsByNameYearSport,
  eligiblePlayableCardCountSql,
} from "./playableSetEligibility";

export interface ActiveIntegratedSet {
  id: string;
  setName: string;
  sport: string;
  brand: string;
  year: number;
  makerNote: string | null;
  createdAt: Date | null;
  makerUsername: string | null;
  isUserCreated: boolean;
  cardCount: number;
  playCount: number;
}

export async function loadActiveIntegratedSets(): Promise<ActiveIntegratedSet[]> {
  const rows = await db
    .select({
      id: gameSets.id,
      setName: gameSets.setName,
      sport: gameSets.sport,
      brand: gameSets.brand,
      year: gameSets.year,
      makerNote: gameSets.makerNote,
      createdAt: gameSets.createdAt,
      makerUsername: users.username,
      isUserCreated: gameSets.isUserCreated,
      cardCount: eligiblePlayableCardCountSql,
      playCount: userSetPlayCountSql,
    })
    .from(gameSets)
    .leftJoin(users, eq(users.id, gameSets.createdByUserId))
    .where(and(eq(gameSets.isActive, true), eq(gameSets.isUserCreated, false)))
    .orderBy(asc(gameSets.year), asc(gameSets.setName));

  const { kept } = dedupeSetsByNameYearSport(
    rows.map((row) => ({
      ...row,
      cardCount: Number(row.cardCount) || 0,
      playCount: Number(row.playCount) || 0,
    })),
  );

  return kept;
}
