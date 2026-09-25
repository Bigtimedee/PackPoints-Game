/**
 * Vertical rhythm for the Game Complete share card.
 * The thumb strip, score, pts line, pips, and tagline are one block,
 * centered between the SOLO/date row and the footer mark.
 * The strip keeps at least 32px of air above the score digits.
 */

export const SHARE_STRIP = {
  canvas: 1080,
  tileW: 64,
  tileH: 90,
  gap: 16,
  rowGap: 12,
  sideInset: 80,
  narrowTileW: 56,
} as const;

/** Ink bottom of the SOLO / date row (baseline 108). */
export const SCORE_CARD_HEADER_BOTTOM = 108;
/** First visible footer ink: the masked P, just under the canvas-colored mark tile. */
export const SCORE_CARD_FOOTER_TOP = 950;
export const SCORE_CARD_STRIP_TO_DIGITS = 32;
/**
 * Inter Bold at 200px: the "/" reaches 152.34px above the baseline.
 * 153px keeps the painted digits at least 32px under the strip.
 */
export const SCORE_CARD_SCORE_INK_ABOVE = 153;
export const SCORE_CARD_PTS_DELTA = 70;
export const SCORE_CARD_STATUS_DELTA = 118;
export const SCORE_CARD_PIP_DELTA = 160;
export const SCORE_CARD_HEADLINE_DELTA = 300;
/** Deepest tagline descender at 48px is about 10.4px below the baseline. */
export const SCORE_CARD_TAGLINE_BELOW = 11;

export type ScoreCardStack = {
  stripY: number;
  stripHeight: number;
  stripBottom: number;
  scoreInkTop: number;
  scoreBaseline: number;
  ptsBaseline: number;
  statusBaseline: number;
  pipY: number;
  headlineBaseline: number;
  taglineBottom: number;
  topGap: number;
  bottomGap: number;
  stripToDigits: number;
};

export type ShareStripBox = { x: number; y: number; w: number; h: number };

type StripSpec = { tileW: number; tileH: number; gap: number; rowGap: number; rows: number };

function evenGap(count: number, tileW: number, maxW: number, preferred: number, minGap: number): number | null {
  if (count <= 1) return 0;
  const room = maxW - count * tileW;
  if (room < 0) return null;
  const exact = Math.floor(room / (count - 1));
  if (exact < minGap) return null;
  return Math.min(preferred, exact);
}

function cardHeight(tileW: number): number {
  return Math.round((tileW * SHARE_STRIP.tileH) / SHARE_STRIP.tileW);
}

/**
 * One 64×90 row while the gap can stay at least 8px, including 12 cards.
 * Fifteen stays one 56×79 row. Twenty wraps to two 64×90 rows. The score
 * sits under the strip, so the thumbs are not cropped to clear it.
 */
export function shareStripSpec(count: number): StripSpec {
  const maxW = SHARE_STRIP.canvas - SHARE_STRIP.sideInset * 2;
  const wide = evenGap(count, SHARE_STRIP.tileW, maxW, SHARE_STRIP.gap, 8);
  if (wide != null) {
    return { tileW: SHARE_STRIP.tileW, tileH: SHARE_STRIP.tileH, gap: wide, rowGap: SHARE_STRIP.rowGap, rows: 1 };
  }
  const narrowH = cardHeight(SHARE_STRIP.narrowTileW);
  const narrow = evenGap(count, SHARE_STRIP.narrowTileW, maxW, SHARE_STRIP.gap, 4);
  if (narrow != null) {
    return { tileW: SHARE_STRIP.narrowTileW, tileH: narrowH, gap: narrow, rowGap: SHARE_STRIP.rowGap, rows: 1 };
  }
  const per = Math.ceil(count / 2);
  const two = evenGap(per, SHARE_STRIP.tileW, maxW, SHARE_STRIP.gap, 8);
  if (two != null) {
    return { tileW: SHARE_STRIP.tileW, tileH: SHARE_STRIP.tileH, gap: two, rowGap: SHARE_STRIP.rowGap, rows: 2 };
  }
  const twoNarrow = evenGap(per, SHARE_STRIP.narrowTileW, maxW, SHARE_STRIP.gap, 4);
  if (twoNarrow != null) {
    return { tileW: SHARE_STRIP.narrowTileW, tileH: narrowH, gap: twoNarrow, rowGap: 8, rows: 2 };
  }
  const rowGap = 4;
  const maxH = SCORE_CARD_FOOTER_TOP - SCORE_CARD_HEADER_BOTTOM - SCORE_CARD_STRIP_TO_DIGITS - SCORE_CARD_SCORE_INK_ABOVE - SCORE_CARD_HEADLINE_DELTA - SCORE_CARD_TAGLINE_BELOW;
  const tileH = Math.max(1, Math.floor((maxH - rowGap) / 2));
  const tileW = Math.max(1, Math.round((tileH * SHARE_STRIP.tileW) / SHARE_STRIP.tileH));
  return { tileW, tileH, gap: evenGap(per, tileW, maxW, 8, 2) ?? 2, rowGap, rows: 2 };
}

export function shareStripHeight(spec: StripSpec): number {
  return spec.rows * spec.tileH + Math.max(0, spec.rows - 1) * spec.rowGap;
}

/** Center a strip of `stripHeight` between the header row and the footer. */
export function scoreCardStack(stripHeight: number): ScoreCardStack {
  const block = stripHeight
    + SCORE_CARD_STRIP_TO_DIGITS
    + SCORE_CARD_SCORE_INK_ABOVE
    + SCORE_CARD_HEADLINE_DELTA
    + SCORE_CARD_TAGLINE_BELOW;
  const free = SCORE_CARD_FOOTER_TOP - SCORE_CARD_HEADER_BOTTOM;
  const extra = free - block;
  const topGap = Math.floor(extra / 2);
  const bottomGap = extra - topGap;
  const stripY = SCORE_CARD_HEADER_BOTTOM + topGap;
  const stripBottom = stripY + stripHeight;
  const scoreInkTop = stripBottom + SCORE_CARD_STRIP_TO_DIGITS;
  const scoreBaseline = scoreInkTop + SCORE_CARD_SCORE_INK_ABOVE;
  const headlineBaseline = scoreBaseline + SCORE_CARD_HEADLINE_DELTA;
  return {
    stripY,
    stripHeight,
    stripBottom,
    scoreInkTop,
    scoreBaseline,
    ptsBaseline: scoreBaseline + SCORE_CARD_PTS_DELTA,
    statusBaseline: scoreBaseline + SCORE_CARD_STATUS_DELTA,
    pipY: scoreBaseline + SCORE_CARD_PIP_DELTA,
    headlineBaseline,
    taglineBottom: headlineBaseline + SCORE_CARD_TAGLINE_BELOW,
    topGap,
    bottomGap,
    stripToDigits: SCORE_CARD_STRIP_TO_DIGITS,
  };
}

/** Strip boxes plus the centered block for this many scored thumbs. */
export function scoreCardFrame(count: number): ScoreCardStack & { boxes: ShareStripBox[] } {
  const n = Math.max(0, Math.floor(count));
  const spec = shareStripSpec(Math.max(1, n));
  const stack = scoreCardStack(n === 0 ? 0 : shareStripHeight(spec));
  const boxes: ShareStripBox[] = [];
  if (n === 0) return { ...stack, boxes };
  const perRow = spec.rows === 1 ? n : Math.ceil(n / 2);
  let index = 0;
  for (let row = 0; row < spec.rows && index < n; row++) {
    const rowCount = Math.min(perRow, n - index);
    const rowW = rowCount * spec.tileW + (rowCount - 1) * spec.gap;
    const x0 = Math.round((SHARE_STRIP.canvas - rowW) / 2);
    const y = stack.stripY + row * (spec.tileH + spec.rowGap);
    for (let i = 0; i < rowCount; i++) {
      boxes.push({
        x: x0 + i * (spec.tileW + spec.gap),
        y,
        w: spec.tileW,
        h: spec.tileH,
      });
    }
    index += rowCount;
  }
  return { ...stack, boxes };
}

export function scoreCardStackForCount(count: number): ScoreCardStack {
  const frame = scoreCardFrame(count);
  return frame;
}
