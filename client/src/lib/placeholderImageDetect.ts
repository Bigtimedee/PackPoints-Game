/**
 * Client silhouette / placeholder bitmap heuristic.
 *
 * 2026-09-15 Daily 5 hang: a real Topps Chrome scan (HTTP 200) had a dark
 * border covering ~57% of a 100×100 quantized sample. The old rule treated
 * "dominant bucket > 50%" as a silhouette and hid a playable card.
 *
 * Silhouettes are a *conjunction*: few unique quantized colors AND a
 * near-flat histogram (one bucket owns almost every pixel). High dominant
 * share alone is a normal chrome/border signature.
 */

export const PLACEHOLDER_SAMPLE_SIZE = 100;
export const PLACEHOLDER_QUANT_STEP = 32;
export const PLACEHOLDER_LOW_UNIQUE_COLORS = 30;
/** Near-flat: one quantized bucket covers this share of the sample. */
export const PLACEHOLDER_NEAR_FLAT_DOMINANT_PCT = 80;

export const PLACEHOLDER_URL_PATTERNS = [
  /placeholder/i,
  /no[-_]?image/i,
  /default[-_]?image/i,
  /missing[-_]?image/i,
  /silhouette/i,
  /generic[-_]?card/i,
  /coming[-_]?soon/i,
  /not[-_]?available/i,
  /fallback/i,
  /blank[-_]?card/i,
  /unavailable/i,
];

export function isPlaceholderUrl(url: string): boolean {
  return PLACEHOLDER_URL_PATTERNS.some((pattern) => pattern.test(url));
}

export interface PlaceholderBitmapAnalysis {
  uniqueColors: number;
  dominantPercent: number;
  nearFlatHistogram: boolean;
  isPlaceholder: boolean;
}

function quantizeChannel(value: number): number {
  return Math.floor(value / PLACEHOLDER_QUANT_STEP) * PLACEHOLDER_QUANT_STEP;
}

export function analyzePlaceholderPixels(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): PlaceholderBitmapAnalysis {
  const colorCounts = new Map<string, number>();
  const totalPixels = Math.max(1, width * height);

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const key = `${quantizeChannel(pixels[i])},${quantizeChannel(pixels[i + 1])},${quantizeChannel(pixels[i + 2])}`;
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
  }

  const uniqueColors = colorCounts.size;
  const maxCount = uniqueColors === 0 ? 0 : Math.max(...colorCounts.values());
  const dominantPercent = (maxCount / totalPixels) * 100;
  const nearFlatHistogram = dominantPercent >= PLACEHOLDER_NEAR_FLAT_DOMINANT_PCT;
  const isPlaceholder =
    uniqueColors < PLACEHOLDER_LOW_UNIQUE_COLORS && nearFlatHistogram;

  return { uniqueColors, dominantPercent, nearFlatHistogram, isPlaceholder };
}

export function isPlaceholderBitmap(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): boolean {
  return analyzePlaceholderPixels(pixels, width, height).isPlaceholder;
}

/** Canvas reject is opt-out per surface. Daily 5 must pass false — no replace path. */
export function shouldRunClientCanvasReject(
  allowClientImageReject: boolean,
  envValidationEnabled: boolean,
): boolean {
  return allowClientImageReject && envValidationEnabled;
}
