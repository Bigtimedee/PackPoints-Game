import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_SAMPLE_SIZE,
  analyzePlaceholderPixels,
  evaluateCardImageValidity,
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

  it("does not treat a baked name plaque plus a real photo as a silhouette", () => {
    const pixels = rgbaBuffer((x, y) => {
      if (y >= 54) return [10, 14, 22];
      return [(x * 17 + y * 3) % 256, (x * 5 + 40) % 256, (y * 11 + 20) % 256];
    });
    const analysis = analyzePlaceholderPixels(pixels, PLACEHOLDER_SAMPLE_SIZE, PLACEHOLDER_SAMPLE_SIZE, {
      ignoreMaskFill: true,
    });
    expect(analysis.sampledPixels).toBeGreaterThan(PLACEHOLDER_SAMPLE_SIZE * PLACEHOLDER_SAMPLE_SIZE * 0.4);
    expect(analysis.isPlaceholder).toBe(false);
  });

  it("accepts a portrait 1987-size scan and a sideways file of the same card", () => {
    const portrait = evaluateCardImageValidity({ width: 500, height: 700 });
    expect(portrait.ok).toBe(true);
    expect(portrait.reason).toBeNull();
    expect(portrait.acceptedSidewaysCard).toBe(false);
    expect(portrait.rawAspect).toBeCloseTo(500 / 700, 5);

    const sideways = evaluateCardImageValidity({ width: 700, height: 500 });
    expect(sideways.rawAspect).toBeCloseTo(1.4, 5);
    expect(sideways.rawAspect).toBeGreaterThan(1.3);
    expect(sideways.ok).toBe(true);
    expect(sideways.acceptedSidewaysCard).toBe(true);
    expect(sideways.reason).toBeNull();

    const rotated = evaluateCardImageValidity({ width: 700, height: 500, rotation: 90 });
    expect(rotated.ok).toBe(true);
    expect(rotated.displayAspect).toBeCloseTo(1.4, 5);
    expect(rotated.acceptedSidewaysCard).toBe(true);
    expect(rotated.rotation).toBe(90);
  });

  it("does not reject an upright slab when imageRotation is 90", () => {
    const slab = evaluateCardImageValidity({ width: 500, height: 820, rotation: 90 });
    expect(slab.displayAspect).toBeCloseTo(500 / 820, 5);
    expect(slab.displayAspect).toBeLessThan(1.3);
    expect(slab.cardShaped).toBe(false);
    expect(slab.ok).toBe(true);
    expect(slab.reason).toBeNull();
  });

  it("still rejects a tiny image and a wide banner", () => {
    expect(evaluateCardImageValidity({ width: 40, height: 80 }).reason).toBe("image_too_small");
    const banner = evaluateCardImageValidity({ width: 1600, height: 900 });
    expect(banner.ok).toBe(false);
    expect(banner.reason).toBe("abnormal_aspect_ratio");
    expect(banner.cardShaped).toBe(false);
  });

  it("never canvas-rejects Daily 5 even when the env flag is on", () => {
    expect(shouldRunClientCanvasReject(false, true)).toBe(false);
    expect(shouldRunClientCanvasReject(true, true)).toBe(true);
    expect(shouldRunClientCanvasReject(true, false)).toBe(false);
  });
});
