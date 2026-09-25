/**
 * GameCard image-error overlay. Daily 5 has no replace/skip path — never lie
 * that a replacement is in progress. See docs/audits/DAILY5_STUCK_REPLACEMENT_2026-09-16.md.
 */

export const GAME_CARD_HONEST_IMAGE_ERROR_COPY =
  "Card image didn’t load. You can still answer.";

export const GAME_CARD_REPLACEMENT_PENDING_COPY =
  "Finding a replacement card...";

export type GameCardImageErrorKind =
  | "honest"
  | "replace-pending"
  | "replace-button"
  | "skip-button"
  | "replace-failed";

export function resolveGameCardImageErrorKind(opts: {
  showSkipButton?: boolean;
  showReplaceButton?: boolean;
  onImageError?: unknown;
}): GameCardImageErrorKind {
  if (opts.showReplaceButton) return "replace-button";
  if (opts.showSkipButton) return "skip-button";
  if (opts.onImageError) return "replace-pending";
  return "honest";
}
