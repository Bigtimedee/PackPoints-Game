/**
 * Per-card review guard for integrated sets.
 *
 * A card in an integrated (not user-created) set is dealt only when its id is
 * in card_review_approvals. The first boot of this guard seeds that table with
 * every card that was dealable at that moment, so nothing live drops out. Any
 * card that becomes playable later (card-pool refresh, trusted-band release,
 * purge and re-import under a new id, a new import) is held with
 * CARD_REVIEW_REASON until Design approves it through the token-gated QA route.
 *
 * An approval only lifts this guard. Every other deal filter, including the
 * blocklist and the set hold, still applies, so a blocked card stays blocked.
 *
 * The guard is enabled per process by boot after the seed has run. Tests turn
 * it on explicitly so fixture cards in other test files are unaffected.
 */
export const CARD_REVIEW_REASON = "awaiting_card_review";

let guardEnabled = false;

export function cardReviewGuardEnabled(): boolean {
  return guardEnabled;
}

export function setCardReviewGuardEnabled(enabled: boolean): void {
  guardEnabled = enabled;
}

type CardAlias = "pc" | "playable_cards";

/**
 * SQL text, true when the card may be dealt as far as review is concerned:
 * its id is approved, or its set is user-created. Correlated on `alias.id`.
 */
export function cardReviewApprovedClause(alias: CardAlias): string {
  return `(EXISTS (SELECT 1 FROM card_review_approvals cra WHERE cra.card_id = ${alias}.id)`
    + ` OR EXISTS (SELECT 1 FROM game_sets crgs WHERE crgs.id = ${alias}.game_set_id AND crgs.is_user_created = true))`;
}

/** Blocklist OR-clause, true when the card is awaiting review. Null when the guard is off. */
export function cardAwaitingReviewClause(alias: CardAlias, opts?: { ignoreCardReview?: boolean }): string | null {
  if (opts?.ignoreCardReview || !guardEnabled) return null;
  return `NOT ${cardReviewApprovedClause(alias)}`;
}
