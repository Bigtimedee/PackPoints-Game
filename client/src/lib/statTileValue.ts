/**
 * Game Complete stat values stay on one line inside a ~89px tile at 390px
 * and a ~79px tile at 360px. JetBrains Mono (the loaded mono face) advances
 * 0.6em, so "20/20" at 30px is 90px wide and runs 17px past that 89px tile
 * once the 16px left padding is counted. Size from the character count,
 * from 30px down to an 18px floor. No clip, no ellipsis.
 */
export const STAT_TILE_FONT_MAX_PX = 30;
export const STAT_TILE_FONT_MIN_PX = 18;
export const STAT_TILE_MONO_ADVANCE = 0.6;

/**
 * Ink width that still sits inside a solo stat tile at 360px after the
 * tile's left padding. 5 characters at the 18px floor are 54px.
 */
export const STAT_TILE_INK_PX = 56;

export function statTileValueFontPx(value: string | number): number {
  const chars = Math.max(1, String(value).length);
  const fitted = Math.floor(STAT_TILE_INK_PX / (STAT_TILE_MONO_ADVANCE * chars));
  return Math.min(STAT_TILE_FONT_MAX_PX, Math.max(STAT_TILE_FONT_MIN_PX, fitted));
}

/** Estimated ink width at the chosen size. Used to prove the value fits. */
export function statTileValueInkPx(value: string | number): number {
  return String(value).length * STAT_TILE_MONO_ADVANCE * statTileValueFontPx(value);
}
