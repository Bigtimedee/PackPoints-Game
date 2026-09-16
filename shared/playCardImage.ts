import { maskedCardImageUrl } from "./maskGeometry";

/** Unmasked original scan served by the existing public proxy. */
export function revealPlayUrl(cardId: string): string {
  return `/api/images/card/${encodeURIComponent(cardId)}`;
}

/** Guessing-phase bake. Same URL as question payloads (`?v=` + CURRENT_MASK_VERSION). */
export function maskedPlayUrl(cardId: string): string {
  return maskedCardImageUrl(cardId);
}

/**
 * Play-loop image src. Mask stays on until a successful answer submit.
 * GameCard stays dumb: parents pass this URL; they do not teach GameCard to fetch originals.
 */
export function resolvePlayCardSrc(opts: { cardId: string; submitted: boolean }): string {
  return opts.submitted ? revealPlayUrl(opts.cardId) : maskedPlayUrl(opts.cardId);
}
