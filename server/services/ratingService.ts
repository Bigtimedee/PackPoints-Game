/**
 * ratingService.ts
 *
 * ELO-based player rating system for ranked competitive matches.
 * Uses playerRatings and ratingHistory tables from shared/schema.ts.
 */
import { db } from "../db";
import { playerRatings, ratingHistory, users, RANKED_TIER_THRESHOLDS } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

const K_FACTOR = 32;
const DEFAULT_RATING = 1200;

type TierName = keyof typeof RANKED_TIER_THRESHOLDS;

function getTierForRating(rating: number): TierName {
  const tiers = Object.entries(RANKED_TIER_THRESHOLDS) as [TierName, { min: number; max: number }][];
  for (const [name, range] of tiers) {
    if (rating >= range.min && rating <= range.max) return name;
  }
  return rating >= 2000 ? "LEGEND" : "BRONZE";
}

/**
 * Pure ELO calculation. Returns the change for player A.
 * result: 1 = A wins, 0 = A loses, 0.5 = draw
 */
export function calculateEloChange(ratingA: number, ratingB: number, result: number): number {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(K_FACTOR * (result - expectedA));
}

/**
 * Get or create a player rating record. Upserts on first call.
 */
export async function getOrCreateRating(userId: string) {
  const [existing] = await db
    .select()
    .from(playerRatings)
    .where(eq(playerRatings.userId, userId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(playerRatings)
    .values({ userId, rating: DEFAULT_RATING, peakRating: DEFAULT_RATING, tier: "BRONZE" })
    .onConflictDoNothing({ target: playerRatings.userId })
    .returning();

  // If onConflict hit (race condition), re-fetch
  if (!created) {
    const [refetched] = await db
      .select()
      .from(playerRatings)
      .where(eq(playerRatings.userId, userId))
      .limit(1);
    return refetched!;
  }

  return created;
}

/**
 * Get recent rating history for a user.
 */
export async function getUserRatingHistory(userId: string, limit: number = 10) {
  return db
    .select()
    .from(ratingHistory)
    .where(eq(ratingHistory.userId, userId))
    .orderBy(desc(ratingHistory.createdAt))
    .limit(limit);
}

/**
 * Get the ranked leaderboard ordered by rating descending.
 */
export async function getRankedLeaderboard(limit: number = 50) {
  const rows = await db
    .select({
      rating: playerRatings.rating,
      tier: playerRatings.tier,
      wins: playerRatings.wins,
      losses: playerRatings.losses,
      draws: playerRatings.draws,
      winStreak: playerRatings.winStreak,
      bestWinStreak: playerRatings.bestWinStreak,
      userId: playerRatings.userId,
      username: users.username,
    })
    .from(playerRatings)
    .leftJoin(users, eq(playerRatings.userId, users.id))
    .orderBy(desc(playerRatings.rating))
    .limit(limit);

  return { rows };
}

/**
 * Update ratings after a match completes.
 * winnerId gets +change, loserId gets -change. For draws, both get partial.
 */
export async function updateRatingsAfterMatch(
  winnerId: string,
  loserId: string,
  isDraw: boolean,
  matchId: string,
) {
  const winnerRating = await getOrCreateRating(winnerId);
  const loserRating = await getOrCreateRating(loserId);

  const winnerResult = isDraw ? 0.5 : 1;
  const loserResult = isDraw ? 0.5 : 0;

  const winnerChange = calculateEloChange(winnerRating.rating, loserRating.rating, winnerResult);
  const loserChange = calculateEloChange(loserRating.rating, winnerRating.rating, loserResult);

  const newWinnerRating = winnerRating.rating + winnerChange;
  const newLoserRating = Math.max(0, loserRating.rating + loserChange);

  const winnerTier = getTierForRating(newWinnerRating);
  const loserTier = getTierForRating(newLoserRating);

  // Update winner
  await db
    .update(playerRatings)
    .set({
      rating: newWinnerRating,
      peakRating: Math.max(winnerRating.peakRating, newWinnerRating),
      tier: winnerTier,
      wins: isDraw ? winnerRating.wins : winnerRating.wins + 1,
      draws: isDraw ? winnerRating.draws + 1 : winnerRating.draws,
      winStreak: isDraw ? 0 : winnerRating.winStreak + 1,
      bestWinStreak: isDraw
        ? winnerRating.bestWinStreak
        : Math.max(winnerRating.bestWinStreak, winnerRating.winStreak + 1),
      lastMatchAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(playerRatings.userId, winnerId));

  // Update loser
  await db
    .update(playerRatings)
    .set({
      rating: newLoserRating,
      tier: loserTier,
      losses: isDraw ? loserRating.losses : loserRating.losses + 1,
      draws: isDraw ? loserRating.draws + 1 : loserRating.draws,
      winStreak: 0,
      lastMatchAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(playerRatings.userId, loserId));

  // Record history for both
  await db.insert(ratingHistory).values([
    {
      userId: winnerId,
      matchId,
      ratingBefore: winnerRating.rating,
      ratingAfter: newWinnerRating,
      ratingChange: winnerChange,
      opponentRating: loserRating.rating,
      result: isDraw ? "DRAW" : "WIN",
    },
    {
      userId: loserId,
      matchId,
      ratingBefore: loserRating.rating,
      ratingAfter: newLoserRating,
      ratingChange: loserChange,
      opponentRating: winnerRating.rating,
      result: isDraw ? "DRAW" : "LOSS",
    },
  ]);

  return { winnerChange, loserChange, newWinnerRating, newLoserRating };
}
