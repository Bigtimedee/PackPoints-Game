/**
 * A TOP_PLATE card admitted from the placement contract is not dealable
 * until its id is in the reviewed list. eligibleDealFilter and
 * cardNotBlockedSql both apply this predicate.
 */
import { desc, eq, sql, type SQL } from "drizzle-orm";
import { playableCards } from "@shared/schema";
import { db } from "../db";
import { MASK_FALLBACK_REVIEWED_CARD_IDS } from "../config/maskFallbackReviewed";

export const FALLBACK_PENDING_REVIEW = "fallback_pending_review";

const CARD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CardAlias = "pc" | "playable_cards";

export function reviewedFallbackCardIds(): string[] {
  return Object.keys(MASK_FALLBACK_REVIEWED_CARD_IDS).filter((id) => CARD_ID_RE.test(id));
}

export function isFallbackReviewed(cardId: string): boolean {
  return CARD_ID_RE.test(cardId) && MASK_FALLBACK_REVIEWED_CARD_IDS[cardId] === true;
}

/** True for a normal card, and for a fallback admission whose id is listed. */
export function fallbackAdmissionDealableSql(alias: CardAlias): SQL {
  const state = sql.raw(`${alias}.mask_fallback_state`);
  const id = sql.raw(`${alias}.id`);
  const ids = reviewedFallbackCardIds();
  if (ids.length === 0) {
    return sql`(${state} IS DISTINCT FROM ${FALLBACK_PENDING_REVIEW})`;
  }
  const list = sql.join(ids.map((cardId) => sql`${cardId}`), sql`, `);
  return sql`(
    ${state} IS DISTINCT FROM ${FALLBACK_PENDING_REVIEW}
    OR ${id} IN (${list})
  )`;
}

export async function recordMaskFallbackAdmission(cardId: string): Promise<boolean> {
  const rows = await db
    .update(playableCards)
    .set({
      maskFallbackState: FALLBACK_PENDING_REVIEW,
      updatedAt: new Date(),
    })
    .where(eq(playableCards.id, cardId))
    .returning({ id: playableCards.id });
  return rows.length > 0;
}

export interface FallbackPendingCard {
  cardId: string;
  gameSetId: string;
  state: string;
  player: string | null;
  number: string | null;
  set: string | null;
  reviewed: boolean;
}

export async function listFallbackPendingCards(limit = 500): Promise<{
  cards: FallbackPendingCard[];
  countsBySet: Array<{ gameSetId: string; pending: number }>;
}> {
  const cap = Math.min(1000, Math.max(1, limit));
  const rows = await db
    .select({
      cardId: playableCards.id,
      gameSetId: playableCards.gameSetId,
      state: playableCards.maskFallbackState,
      player: playableCards.player,
      number: playableCards.number,
      set: playableCards.set,
    })
    .from(playableCards)
    .where(eq(playableCards.maskFallbackState, FALLBACK_PENDING_REVIEW))
    .orderBy(desc(playableCards.updatedAt))
    .limit(cap);

  const cards = rows.map((row) => ({
    cardId: row.cardId,
    gameSetId: row.gameSetId,
    state: row.state || FALLBACK_PENDING_REVIEW,
    player: row.player,
    number: row.number,
    set: row.set,
    reviewed: isFallbackReviewed(row.cardId),
  }));
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (card.reviewed) continue;
    counts.set(card.gameSetId, (counts.get(card.gameSetId) || 0) + 1);
  }
  return {
    cards,
    countsBySet: [...counts.entries()].map(([gameSetId, pending]) => ({ gameSetId, pending })),
  };
}
