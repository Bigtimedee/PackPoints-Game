/**
 * Cards a Daily 5 deal may use from one set, after every deal-time refusal:
 * playable, verified image, not rejected, mask name still covered, card
 * blocklist (SQL and in-process), known silhouettes, non-player cards, and
 * the mask band limit. Shared by deal creation, the set resolver's
 * "can it deal 5 clean cards" check, and the QA preview, so they agree.
 */
import { and, asc, eq, isNotNull, ne, isNull, or, not, like } from "drizzle-orm";
import { gameSets, playableCards, type PlayableCard } from "@shared/schema";
import { db } from "../db";
import { isKnownSilhouetteUrl } from "../storage";
import { isNonPlayerCard } from "@shared/nonPlayerCard";
import { maskNameStillCovered } from "./playableSetEligibility";
import { cardNotBlockedSql, isBlockedCard } from "../lib/cardBlocklist";
import { isMaskBandExcluded } from "../masking/maskBandLimit";

export const DAILY5_CARDS_PER_DEAL = 5;

export interface Daily5Pool {
  /** Rows that passed SQL filters. Wrong-answer names come from here. */
  candidates: PlayableCard[];
  /** Rows a deal may actually use. */
  filtered: PlayableCard[];
}

export async function loadDaily5Pool(setId: string): Promise<Daily5Pool> {
  const candidates = await db
    .select()
    .from(playableCards)
    .where(
      and(
        eq(playableCards.gameSetId, setId),
        eq(playableCards.isPlayable, true),
        or(isNull(playableCards.contentVerified), eq(playableCards.contentVerified, true)),
        isNotNull(playableCards.imageUrl),
        ne(playableCards.imageUrl, ""),
        not(like(playableCards.imageUrl, "%null%")),
        like(playableCards.imageUrl, "https://%"),
        not(like(playableCards.imageUrl, "%s3.amazonaws.com/appforest_uf%05-Baseball%")),
        not(like(playableCards.imageUrl, "%s3.amazonaws.com/appforest_uf%05-Football%")),
        not(like(playableCards.imageUrl, "%s3.amazonaws.com/appforest_uf%05-Basketball%")),
        isNotNull(playableCards.player),
        ne(playableCards.player, ""),
        or(
          isNull(playableCards.imageReviewStatus),
          ne(playableCards.imageReviewStatus, "rejected")
        ),
        maskNameStillCovered("playable_cards"),
        cardNotBlockedSql("playable_cards"),
      )
    )
    // Stable input order so the seeded shuffle, and the QA preview, are
    // reproducible. Without it, row order followed heap position.
    .orderBy(asc(playableCards.id));

  const filtered = candidates.filter(c => !isKnownSilhouetteUrl(c.imageUrl) && !isNonPlayerCard(c.player, c.description) && !isBlockedCard(c.gameSetId, c.player, c) && !isMaskBandExcluded(c.id));
  return { candidates, filtered };
}

export async function daily5DealableCount(setId: string): Promise<number> {
  const { filtered } = await loadDaily5Pool(setId);
  return filtered.length;
}

export interface Daily5SetRow {
  id: string;
  setName: string;
  isActive: boolean;
  isUserCreated: boolean;
}

export async function describeDaily5Set(setId: string): Promise<Daily5SetRow | null> {
  const [row] = await db
    .select({
      id: gameSets.id,
      setName: gameSets.setName,
      isActive: gameSets.isActive,
      isUserCreated: gameSets.isUserCreated,
    })
    .from(gameSets)
    .where(eq(gameSets.id, setId))
    .limit(1);
  return row ?? null;
}
