import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  cardhedgeImportRuns,
  cardImageReports,
  collaborationSessions,
  dailyChallengeCards,
  dailyChallenges,
  gameSets,
  matchContextLog,
  playableCards,
  setOfTheWeek,
  userActiveSets,
} from "@shared/schema";

/**
 * Permanently remove a game_sets row and the dependent rows that FK-block
 * the delete. Order matches schema.ts references (no ON DELETE CASCADE).
 * Returns true if the set existed and was removed.
 */
export async function hardDeleteGameSet(id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: gameSets.id })
      .from(gameSets)
      .where(eq(gameSets.id, id))
      .limit(1);

    if (!existing) {
      return false;
    }

    const cards = await tx
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, id));
    const cardIds = cards.map((c) => c.id);

    if (cardIds.length > 0) {
      await tx
        .delete(dailyChallengeCards)
        .where(inArray(dailyChallengeCards.cardId, cardIds));
      await tx
        .delete(cardImageReports)
        .where(inArray(cardImageReports.cardId, cardIds));
    }

    await tx.delete(playableCards).where(eq(playableCards.gameSetId, id));
    await tx.delete(cardhedgeImportRuns).where(eq(cardhedgeImportRuns.gameSetId, id));
    await tx.delete(userActiveSets).where(eq(userActiveSets.gameSetId, id));
    await tx.delete(matchContextLog).where(eq(matchContextLog.gameSetId, id));
    await tx.delete(setOfTheWeek).where(eq(setOfTheWeek.setId, id));
    await tx
      .update(collaborationSessions)
      .set({ publishedSetId: null })
      .where(eq(collaborationSessions.publishedSetId, id));
    await tx
      .update(dailyChallenges)
      .set({ setId: null })
      .where(eq(dailyChallenges.setId, id));

    const [deleted] = await tx
      .delete(gameSets)
      .where(eq(gameSets.id, id))
      .returning({ id: gameSets.id });

    return Boolean(deleted);
  });
}
