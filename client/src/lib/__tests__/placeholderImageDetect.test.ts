import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_SAMPLE_SIZE,
  analyzePlaceholderPixels,
  isPlaceholderBitmap,
  isPlaceholderUrl,
  shouldRunClientCanvasReject,
} from "../placeholderImageDetect";

function rgbaBuffer(fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const w = PLACEHOLDER_SAMPLE_SIZE;
  const h = PLACEHOLDER_SAMPLE_SIZE;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * w + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

/** Dark chrome frame (~57% dominant) + colorful inner photo — the 2026-09-15 Batum false positive. */
function chromeLikeCardPixels(): Uint8ClampedArray {
  const inner = 65;
  const ox = Math.floor((PLACEHOLDER_SAMPLE_SIZE - inner) / 2);
  const oy = Math.floor((PLACEHOLDER_SAMPLE_SIZE - inner) / 2);
  return rgbaBuffer((x, y) => {
    const inPhoto = x >= ox && x < ox + inner && y >= oy && y < oy + inner;
    if (!inPhoto) return [24, 27, 34];
    return [
      (x * 13 + y * 7) % 256,
      (x * 5 + y * 17) % 256,
      (x * 11 + y * 3) % 256,
    ];
  });
}

function silhouettePixels(): Uint8ClampedArray {
  return rgbaBuffer((x, y) => {
    if (x > 40 && x < 60 && y > 20 && y < 80) return [48, 48, 52];
    return [40, 40, 40];
  });
}

describe("placeholder bitmap heuristic", () => {
  it("does not reject a dark high-dominant Chrome-like real card", () => {
    const pixels = chromeLikeCardPixels();
    const analysis = analyzePlaceholderPixels(
      pixels,
      PLACEHOLDER_SAMPLE_SIZE,
      PLACEHOLDER_SAMPLE_SIZE,
    );
    expect(analysis.dominantPercent).toBeGreaterThan(50);
    expect(analysis.uniqueColors).toBeGreaterThan(30);
    expect(analysis.isPlaceholder).toBe(false);
    expect(isPlaceholderBitmap(pixels, PLACEHOLDER_SAMPLE_SIZE, PLACEHOLDER_SAMPLE_SIZE)).toBe(false);
  });

  it("rejects a near-flat low-color silhouette", () => {
    const pixels = silhouettePixels();
    const analysis = analyzePlaceholderPixels(
      pixels,
      PLACEHOLDER_SAMPLE_SIZE,
      PLACEHOLDER_SAMPLE_SIZE,
    );
    expect(analysis.uniqueColors).toBeLessThan(30);
    expect(analysis.nearFlatHistogram).toBe(true);
    expect(analysis.isPlaceholder).toBe(true);
  });

  it("matches known silhouette URL patterns without treating masked-image paths as fakes", () => {
    expect(isPlaceholderUrl("https://cdn.example/silhouette.png")).toBe(true);
    expect(isPlaceholderUrl("/api/cards/1356d9c8-1d34-4335-b6df-16fb97472fca/masked-image")).toBe(false);
  });

  it("never canvas-rejects Daily 5 even when the env flag is on", () => {
    expect(shouldRunClientCanvasReject(false, true)).toBe(false);
    expect(shouldRunClientCanvasReject(true, true)).toBe(true);
    expect(shouldRunClientCanvasReject(true, false)).toBe(false);
  });
});
