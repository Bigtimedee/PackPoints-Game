/**
 * Play card height-fit (GameCard fitToViewport + index.css .play-card-fit).
 *
 * Each play screen sets the widest the card may be (--pc-cap, its old
 * max-width) and the height everything else on the screen needs
 * (--pc-reserve). The card slot is then min(cap * 7/5, 100dvh - reserve)
 * tall, floored at 240px, so at 375x667 the label, all 4 answers and the
 * Submit / Next Question row sit on screen under a card of 300px or more.
 * Nothing is added to the freed space. No scores or points during play.
 *
 * Reserves (px) at phone widths:
 * - Solo /game: header 50 (pt-1, 32px back button, mb-1, 6px progress, pb-1)
 *   + slot py-1 8 + label 20 + answers 4x40 + 3x6 gaps 178 + pt-2 8
 *   + Next Question 36 + 8 + Report Wrong Image 32 + bottom pad 8 = 348,
 *   plus 4px for borders and rounding = 352.
 *   Fitting the post-submit stack also fits the pre-submit one.
 * - Daily 5 /daily: app header 65 + py-2 8 + badge row 22 + 8 + progress 6
 *   + 8 + gap 8 + answers 178 + gap 8 + Submit / Next 36 + bottom pad 8 = 355,
 *   plus 3px for borders and rounding = 358. The set label truncates to keep
 *   that row to one line.
 *   The bottom nav is hidden during Daily 5 play (playChrome.ts).
 * - 1v1 /match: pt-4 16 + score row 48 + 16 + progress 16 + 16 + gap 16
 *   + 2x2 answers 104 + fixed Submit bar 65 + 8, plus room for the battle
 *   header = 340.
 */
export const PLAY_CARD_RESERVE_PX = {
  solo: 352,
  daily5: 358,
  match: 340,
} as const;

export const PLAY_CARD_MIN_PX = 240;

/** Solo keeps its old widths (280 / 340 / 380) as the cap. */
export const SOLO_PLAY_CARD_FIT_CLASS =
  "[--pc-cap:280px] sm:[--pc-cap:340px] md:[--pc-cap:380px] [--pc-reserve:352px]";

/** Daily 5 keeps max-w-xs (320) as the cap. */
export const DAILY5_PLAY_CARD_FIT_CLASS = "[--pc-cap:320px] [--pc-reserve:358px]";

/** 1v1 keeps max-w-xs (320) as the cap. */
export const MATCH_PLAY_CARD_FIT_CLASS = "[--pc-cap:320px] [--pc-reserve:340px]";

/** Card slot height (px) the CSS produces, for tests and harness checks. */
export function playCardSlotHeight(viewportH: number, capPx: number, reservePx: number): number {
  return Math.min(capPx * 7 / 5, Math.max(PLAY_CARD_MIN_PX, viewportH - reservePx));
}
