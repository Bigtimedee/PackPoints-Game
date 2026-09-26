/**
 * Today's Daily 5 row, after a name-leak quarantine.
 *
 * Past dates are never rewritten. A CLOSED row is never rewritten.
 * When nobody has started today's challenge, each leaked position is replaced
 * with the next eligible card in that set (createdAt, then id). The response
 * is the new card's choices. It does not reveal the removed player.
 * When a registered entry or a guest run already exists, the stored card stays
 * so grading does not move under someone who has the card open. The masked
 * JPEG is not served. Daily 5 still does not call solo replace-card, so the
 * client shows the honest image error and Submit stays usable.
 */
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { getPackptsDayKey } from "@shared/packptsDay";
import {
  anonDailyRuns,
  dailyChallengeCards,
  dailyChallengeEntries,
  dailyChallenges,
  gameSets,
  playableCards,
} from "@shared/schema";
import { isNonPlayerCard, omitNonPlayerNames } from "@shared/nonPlayerCard";
import { db } from "../db";
import { NAME_VISIBLE_OUTSIDE_MASK } from "../masking/nameOutsideMask";
import { playerCoverIdentity } from "./setCovers";
import { eligibleDealFilter } from "./playableSetEligibility";

const LEAK_REASONS = new Set(["mask_name_uncovered", NAME_VISIBLE_OUTSIDE_MASK]);

export interface Daily5LeakSwapResult {
  date: string | null;
  swapped: number;
  held: number;
}

function leaked(row: { isPlayable: boolean | null; blockedReason: string | null }): boolean {
  return row.blockedReason != null && LEAK_REASONS.has(row.blockedReason);
}

export async function swapFailedCardsOnTodayChallenge(): Promise<Daily5LeakSwapResult> {
  const today = getPackptsDayKey();
  const empty = { date: today, swapped: 0, held: 0 };
  const [challenge] = await db
    .select()
    .from(dailyChallenges)
    .where(eq(dailyChallenges.date, today))
    .limit(1);
  if (!challenge || challenge.status === "CLOSED" || !challenge.setId) return empty;
  if (challenge.date !== today) return empty;

  const stored = await db
    .select({
      id: dailyChallengeCards.id,
      position: dailyChallengeCards.position,
      cardId: dailyChallengeCards.cardId,
      correctAnswer: dailyChallengeCards.correctAnswer,
      isPlayable: playableCards.isPlayable,
      blockedReason: playableCards.blockedReason,
      player: playableCards.player,
    })
    .from(dailyChallengeCards)
    .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
    .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id))
    .orderBy(asc(dailyChallengeCards.position));

  const bad = stored.filter((row) => leaked(row));
  if (bad.length === 0) return empty;

  const [startedEntry] = await db
    .select({ id: dailyChallengeEntries.id })
    .from(dailyChallengeEntries)
    .where(eq(dailyChallengeEntries.dailyChallengeId, challenge.id))
    .limit(1);
  const [startedAnon] = await db
    .select({ id: anonDailyRuns.id })
    .from(anonDailyRuns)
    .where(eq(anonDailyRuns.dailyChallengeId, challenge.id))
    .limit(1);
  if (startedEntry || startedAnon) {
    console.log(`[Daily5] name leak held date=${today} positions=${bad.map((row) => row.position).join(",")} reason=already_started`);
    return { date: today, swapped: 0, held: bad.length };
  }

  const [setRow] = await db
    .select({ sport: gameSets.sport })
    .from(gameSets)
    .where(eq(gameSets.id, challenge.setId))
    .limit(1);
  const sport = setRow?.sport || "";

  const used = new Set(stored.map((row) => row.cardId));
  const usedPlayers = new Set(stored.map((row) => playerCoverIdentity(row.player || row.correctAnswer)));
  let swapped = 0;

  for (const row of bad) {
    const filters = [
      eq(playableCards.gameSetId, challenge.setId),
      eligibleDealFilter("playable_cards"),
      notInArray(playableCards.id, [...used]),
    ];
    if (sport) filters.push(sql`LOWER(playable_cards.category) = LOWER(${sport})`);
    const candidates = await db
      .select({
        id: playableCards.id,
        player: playableCards.player,
      })
      .from(playableCards)
      .where(and(...filters))
      .orderBy(asc(playableCards.createdAt), asc(playableCards.id))
      .limit(40);

    const next = candidates.find((card) => {
      if (!card.player || isNonPlayerCard(card.player)) return false;
      const identity = playerCoverIdentity(card.player);
      return Boolean(identity) && !usedPlayers.has(identity);
    });
    if (!next?.player) {
      console.log(`[Daily5] name leak held date=${today} position=${row.position} reason=no_spare`);
      continue;
    }

    const names = omitNonPlayerNames(candidates.map((card) => card.player || ""));
    const wrong = names.filter((name) => name !== next.player).slice(0, 3);
    await db
      .update(dailyChallengeCards)
      .set({
        cardId: next.id,
        correctAnswer: next.player,
        choices: [next.player, ...wrong],
      })
      .where(and(
        eq(dailyChallengeCards.id, row.id),
        eq(dailyChallengeCards.dailyChallengeId, challenge.id),
      ));
    used.add(next.id);
    usedPlayers.add(playerCoverIdentity(next.player));
    swapped += 1;
    console.log(`[Daily5] name leak swapped date=${today} position=${row.position}`);
  }

  return { date: today, swapped, held: bad.length - swapped };
}
