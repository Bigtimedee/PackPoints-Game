/**
 * Game Complete labels follow the tile's content box, not the viewport.
 * Solo and Daily 5 share this rule from 320px to 430px.
 *
 * Inter Regular uppercase "ACCURACY" at 12px with 0.05em tracking is
 * 71.85px wide (scroll width 72). That overflows a 57px solo content box
 * at 390px and a 69px Daily 5 content box at 360px. Below 76px of content
 * the label is 10px with no extra tracking (ACCURACY is 56.38px).
 *
 * Horizontal padding keeps at least 60px of content for that 10px label
 * and for the 18px value floor (worst ink is "100%" at 55.2px), and never
 * exceeds the 16px padding used on a wide tile.
 */

export const STAT_TILE_LABEL_SWITCH_PX = 76;
export const STAT_TILE_LABEL_WIDE_PX = 12;
export const STAT_TILE_LABEL_NARROW_PX = 10;
export const STAT_TILE_LABEL_WIDE_TRACKING_EM = 0.05;
export const STAT_TILE_CONTENT_MIN_PX = 60;
export const STAT_TILE_PAD_X_MIN_PX = 0;
export const STAT_TILE_PAD_X_MAX_PX = 16;

/** Inter Regular, unitsPerEm 2048. Sum of uppercase advances. */
const INTER_UPEM = 2048;
const LABEL_ADVANCE_UNITS = {
  ACCURACY: 11546,
  PTS: 3944,
  SCORE: 6925,
} as const;

export type StatTileLabel = keyof typeof LABEL_ADVANCE_UNITS;

export function statTilePadX(tileBorderPx: number): number {
  const raw = (tileBorderPx - STAT_TILE_CONTENT_MIN_PX) / 2;
  return Math.min(STAT_TILE_PAD_X_MAX_PX, Math.max(STAT_TILE_PAD_X_MIN_PX, raw));
}

export function statTileContentPx(tileBorderPx: number): number {
  return tileBorderPx - statTilePadX(tileBorderPx) * 2;
}

export function statTileLabelIsNarrow(contentPx: number): boolean {
  return contentPx < STAT_TILE_LABEL_SWITCH_PX;
}

/** Ink width of the uppercase label at the size the container query picks. */
export function statTileLabelInkPx(label: StatTileLabel, contentPx: number): number {
  const narrow = statTileLabelIsNarrow(contentPx);
  const size = narrow ? STAT_TILE_LABEL_NARROW_PX : STAT_TILE_LABEL_WIDE_PX;
  const tracking = narrow ? 0 : STAT_TILE_LABEL_WIDE_TRACKING_EM;
  const advance = (LABEL_ADVANCE_UNITS[label] * size) / INTER_UPEM;
  return advance + tracking * size * (label.length - 1);
}

/** Page px-4, card max-w-md, 1px border, CardContent p-8, grid gap-3. */
export function soloStatTileBorderPx(viewport: number): number {
  const card = Math.min(viewport - 32, 28 * 16);
  const grid = card - 2 - 64;
  return (grid - 24) / 3;
}

/** Container px-4, grid max-w-md, gap-3. No card padding. */
export function daily5StatTileBorderPx(viewport: number): number {
  const grid = Math.min(viewport - 32, 28 * 16);
  return (grid - 24) / 3;
}
