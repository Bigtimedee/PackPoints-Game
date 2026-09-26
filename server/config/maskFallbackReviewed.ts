/**
 * Card ids Design has reviewed after a placement-contract fallback admission.
 * Keyed by card id. Empty until a reviewed id is added here.
 * A listed id may be dealt. Every other `fallback_pending_review` row stays out.
 */
export const MASK_FALLBACK_REVIEWED_CARD_IDS: Record<string, true> = {};
