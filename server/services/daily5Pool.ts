/**
 * Cards a Daily 5 deal may use from one set. The SQL predicate is
 * eligibleDealFilter, the same one cardCount and getRandomCardsFromSet use,
 * so a discovery cohort deals only its active release members and only
 * card-review-approved rows. The in-process pass then drops known silhouettes,
 * non-player cards, and mask-band exclusions. Deal creation, the resolver's
 * "can it deal 5 clean cards" check, and the QA preview share this pool.
 */
import { and, asc, eq } from "drizzle-orm";
import { gameSets, playableCards, type PlayableCard } from "@shared/schema";
import { db } from "../db";
import { isKnownSilhouetteUrl } from "../storage";
import { isNonPlayerCard } from "@shared/nonPlayerCard";
import { eligibleDealFilter } from "./playableSetEligibility";
import { isBlockedCard } from "../lib/cardBlocklist";
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
    .where(and(
      eq(playableCards.gameSetId, setId),
      // Same predicate as cardCount and getRandomCardsFromSet, including the
      // active release manifest and the card-review guard.
      eligibleDealFilter("playable_cards"),
    ))
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
