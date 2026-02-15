import { db } from "../db";
import { gameSessionsTable } from "@shared/schema";
import { eq, and, lt, sql } from "drizzle-orm";

const STALE_THRESHOLD_HOURS = 24;

export async function cleanupStaleGameSessions(): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();

  const result = await db
    .update(gameSessionsTable)
    .set({ status: "expired" })
    .where(
      and(
        eq(gameSessionsTable.status, "active"),
        lt(gameSessionsTable.startedAt, cutoff)
      )
    )
    .returning({ id: gameSessionsTable.id });

  if (result.length > 0) {
    console.log(`[GameSessionCleanup] Expired ${result.length} stale game sessions older than ${STALE_THRESHOLD_HOURS}h`);
  }

  return { expired: result.length };
}
