import { db } from "../db";
import { lobbies, matches, MatchStatus } from "@shared/schema";
import { eq, and, lt, inArray } from "drizzle-orm";

const LOBBY_STALE_HOURS = 24;
const MATCH_STALE_HOURS = 2;

export async function cleanupStaleLobbiesAndMatches(): Promise<{ expiredLobbies: number; cancelledMatches: number }> {
  const lobbyCutoff = new Date(Date.now() - LOBBY_STALE_HOURS * 60 * 60 * 1000);
  const matchCutoff = new Date(Date.now() - MATCH_STALE_HOURS * 60 * 60 * 1000);

  const staleLobbies = await db
    .update(lobbies)
    .set({ status: "expired" })
    .where(
      and(
        inArray(lobbies.status, ["waiting", "playing"]),
        lt(lobbies.createdAt, lobbyCutoff)
      )
    )
    .returning({ id: lobbies.id });

  const staleMatches = await db
    .update(matches)
    .set({
      status: MatchStatus.CANCELLED,
      finishedAt: new Date(),
      endReason: "stale_cleanup",
    })
    .where(
      and(
        inArray(matches.status, [MatchStatus.ACTIVE, MatchStatus.INITIALIZING, MatchStatus.LOBBY]),
        lt(matches.createdAt, matchCutoff)
      )
    )
    .returning({ id: matches.id });

  if (staleLobbies.length > 0 || staleMatches.length > 0) {
    console.log(
      `[MatchCleanup] Cleaned up ${staleLobbies.length} stale lobbies (>${LOBBY_STALE_HOURS}h) and ${staleMatches.length} stale matches (>${MATCH_STALE_HOURS}h)`
    );
  }

  return { expiredLobbies: staleLobbies.length, cancelledMatches: staleMatches.length };
}
