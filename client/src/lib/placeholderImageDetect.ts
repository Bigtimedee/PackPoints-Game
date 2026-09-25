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
  /** Pixels that counted. Mask-fill pixels are omitted when ignoreMaskFill is set. */
  sampledPixels: number;
}

/** Opaque bake fill `#0a0e16`. JPEG q=85 shifts it a little. */
const MASK_FILL = { r: 10, g: 14, b: 22 };
const MASK_FILL_TOLERANCE = 18;

export function isMaskFillPixel(r: number, g: number, b: number): boolean {
  return Math.abs(r - MASK_FILL.r) <= MASK_FILL_TOLERANCE
    && Math.abs(g - MASK_FILL.g) <= MASK_FILL_TOLERANCE
    && Math.abs(b - MASK_FILL.b) <= MASK_FILL_TOLERANCE;
}

/** 2.5×3.5. A sideways file of the same card is about 1.40, just over the old > 1.3 cutoff. */
export const TRADING_CARD_SHORT_OVER_LONG = 2.5 / 3.5;
export const CARD_SHAPE_TOLERANCE = 0.12;

export interface CardImageValidity {
  ok: boolean;
  reason: "image_too_small" | "abnormal_aspect_ratio" | null;
  width: number;
  height: number;
  rotation: number;
  rawAspect: number;
  displayAspect: number;
  cardShaped: boolean;
  /** Landscape pixels that still match a trading card. The 1987 Topps false positive. */
  acceptedSidewaysCard: boolean;
}

export function displayCardSize(
  width: number,
  height: number,
  rotation = 0,
): { width: number; height: number } {
  const turns = ((rotation % 360) + 360) % 360;
  if (turns === 90 || turns === 270) return { width: height, height: width };
  return { width, height };
}

export function isTradingCardShape(width: number, height: number): boolean {
  const major = Math.max(width, height);
  const minor = Math.min(width, height);
  if (major <= 0) return false;
  const ratio = minor / major;
  const target = TRADING_CARD_SHORT_OVER_LONG;
  return ratio >= target * (1 - CARD_SHAPE_TOLERANCE)
    && ratio <= target * (1 + CARD_SHAPE_TOLERANCE);
}

/**
 * Client gate for a loaded scan. Portrait cards pass. A card-shaped landscape
 * file (aspect ≈ 1.40, or 90°/270° rotation) passes too — that is a portrait
 * scan stored sideways, not a banner. Wider images still fail.
 */
export function evaluateCardImageValidity(input: {
  width: number;
  height: number;
  rotation?: number;
}): CardImageValidity {
  const width = input.width;
  const height = input.height;
  const rotation = input.rotation ?? 0;
  const rawAspect = height > 0 ? width / height : Number.POSITIVE_INFINITY;
  const displayed = displayCardSize(width, height, rotation);
  const displayAspect = displayed.height > 0 ? displayed.width / displayed.height : Number.POSITIVE_INFINITY;
  const cardShaped = isTradingCardShape(displayed.width, displayed.height);
  const base = {
    width,
    height,
    rotation,
    rawAspect,
    displayAspect,
    cardShaped,
    acceptedSidewaysCard: false,
  };

  if (width < 50 || height < 50) {
    return { ...base, ok: false, reason: "image_too_small" };
  }
  if (displayAspect > 1.3 && !cardShaped) {
    return { ...base, ok: false, reason: "abnormal_aspect_ratio" };
  }
  return {
    ...base,
    ok: true,
    reason: null,
    acceptedSidewaysCard: displayAspect > 1.3 && cardShaped,
  };
}

function quantizeChannel(value: number): number {
  return Math.floor(value / PLACEHOLDER_QUANT_STEP) * PLACEHOLDER_QUANT_STEP;
}

export function analyzePlaceholderPixels(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  options?: { ignoreMaskFill?: boolean },
): PlaceholderBitmapAnalysis {
  const colorCounts = new Map<string, number>();
  let sampledPixels = 0;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (options?.ignoreMaskFill && isMaskFillPixel(r, g, b)) continue;
    sampledPixels += 1;
    const key = `${quantizeChannel(r)},${quantizeChannel(g)},${quantizeChannel(b)}`;
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
  }

  const totalPixels = Math.max(1, sampledPixels);
  const uniqueColors = colorCounts.size;
  const maxCount = uniqueColors === 0 ? 0 : Math.max(...colorCounts.values());
  const dominantPercent = (maxCount / totalPixels) * 100;
  const nearFlatHistogram = dominantPercent >= PLACEHOLDER_NEAR_FLAT_DOMINANT_PCT;
  // A baked plaque can be most of the sample. Don't call the card a silhouette
  // when almost every pixel was the mask fill — there is no photo left to judge.
  const enoughPhoto = !options?.ignoreMaskFill || sampledPixels >= width * height * 0.15;
  const isPlaceholder = enoughPhoto
    && uniqueColors < PLACEHOLDER_LOW_UNIQUE_COLORS
    && nearFlatHistogram;

  return { uniqueColors, dominantPercent, nearFlatHistogram, isPlaceholder, sampledPixels };
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
