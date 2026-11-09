/**
 * Exact-output precheck for one measured plate.
 *
 * The painter covers a pixel when that pixel's center lies inside the polygon.
 * JPEG antialiasing can leave the center-inside boundary a few levels off
 * #c4a574. Those pixels are an edge class. They are not an interior hole and
 * they are not a reason to enlarge the polygon.
 *
 * Name ink whose center is outside the polygon and was not painted is residual
 * ink. That still holds. This function does not change the 28/30 paint gates,
 * does not approve a card, and does not clear a set.
 */
export const EXACT_FILL_RGB = [196, 165, 116] as const;
/** Opaque must be at least this close to the fill, by max channel. */
export const PAINTED_FILL_MAX_DELTA = 28;
/** Opaque must also move at least this far from the source. */
export const PAINTED_SOURCE_MIN_DELTA = 30;
export const RESIDUAL_NAME_INK_HOLD = 8;
export const SHORT_SURNAME_RESIDUAL_HOLD = 4;
export const TRUE_INTERIOR_HOLD = 5;
const NAME_LUMINANCE_MIN = 165;
const NAME_CHROMA_MAX = 50;
const CAPSULE_INK_MIN = 55;
const CAPSULE_NEAR_MAX = 70;
const RESIDUAL_BAND_PX = 12;

export type Rgb = readonly [number, number, number];

export type ExactOutputVerdict = "pass_exact_output" | "hold_residual_ink" | "hold_interior";

export interface ExactOutputPrecheck {
  solidFill: number;
  changedFromSource: number;
  /** Name ink on the center-inside boundary that paint moved but did not bring within the fill gate. */
  aaEdge: number;
  /** Name ink strictly inside the painted region that is still the source. Not an antialiased edge. */
  trueInterior: number;
  /** Name ink outside the painted region that was not covered. */
  residualNameInk: number;
  interiorDefect: boolean;
  residualHold: boolean;
  verdict: ExactOutputVerdict;
  aaEdgeCountsAsInteriorDefect: false;
  releaseAuthorized: false;
}

export function chebyshev(left: Rgb, right: Rgb): number {
  return Math.max(Math.abs(left[0] - right[0]), Math.abs(left[1] - right[1]), Math.abs(left[2] - right[2]));
}

export function classifyPaint(source: Rgb, opaque: Rgb): "solid_fill" | "changed_not_solid" | "unpainted" {
  const fillDelta = chebyshev(opaque, EXACT_FILL_RGB);
  const sourceDelta = chebyshev(opaque, source);
  if (fillDelta <= PAINTED_FILL_MAX_DELTA && sourceDelta >= PAINTED_SOURCE_MIN_DELTA) return "solid_fill";
  if (sourceDelta >= PAINTED_SOURCE_MIN_DELTA) return "changed_not_solid";
  return "unpainted";
}

function luminance(pixel: Rgb): number {
  return 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2];
}

function chroma(pixel: Rgb): number {
  return Math.max(pixel[0], pixel[1], pixel[2]) - Math.min(pixel[0], pixel[1], pixel[2]);
}

function axisRect(polygon: readonly (readonly number[])[]): { x0: number; y0: number; x1: number; y1: number } | null {
  if (polygon.length !== 4) return null;
  const xs = [...new Set(polygon.map((point) => point[0]))];
  const ys = [...new Set(polygon.map((point) => point[1]))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function rayInside(x: number, y: number, polygon: readonly (readonly number[])[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function centerInside(x: number, y: number, polygon: readonly (readonly number[])[], rect: { x0: number; y0: number; x1: number; y1: number } | null): boolean {
  if (rect) return x + 0.5 >= rect.x0 && x + 0.5 < rect.x1 && y + 0.5 >= rect.y0 && y + 0.5 < rect.y1;
  return rayInside(x + 0.5, y + 0.5, polygon);
}

function readPixel(buffer: Buffer, width: number, channels: number, x: number, y: number): Rgb {
  const index = (y * width + x) * channels;
  return [buffer[index] ?? 0, buffer[index + 1] ?? 0, buffer[index + 2] ?? 0];
}

function isNameInk(buffer: Buffer, width: number, height: number, channels: number, x: number, y: number, capsule: Rgb, badgeXMax: number): boolean {
  if (x <= badgeXMax) return false;
  const pixel = readPixel(buffer, width, channels, x, y);
  if (luminance(pixel) < NAME_LUMINANCE_MIN || chroma(pixel) > NAME_CHROMA_MAX || chebyshev(pixel, capsule) < CAPSULE_INK_MIN) return false;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const neighbor = readPixel(buffer, width, channels, xx, yy);
      const nearBlack = neighbor[0] < 40 && neighbor[1] < 40 && neighbor[2] < 40;
      const nearWhite = neighbor[0] > 245 && neighbor[1] > 245 && neighbor[2] > 245;
      const near = chebyshev(neighbor, capsule) <= CAPSULE_NEAR_MAX && !nearBlack && !nearWhite;
      if (near) return true;
    }
  }
  return false;
}

export function evaluateExactOutputPrecheck(input: {
  width: number;
  height: number;
  source: Buffer;
  opaque: Buffer;
  polygon: readonly (readonly number[])[];
  capsule: Rgb;
  badgeXMax: number;
  shortSurname?: boolean;
}): ExactOutputPrecheck {
  const channels = 3;
  if (input.source.length !== input.width * input.height * channels || input.opaque.length !== input.source.length) {
    throw new Error("exact-output precheck expects tightly packed RGB");
  }
  const rect = axisRect(input.polygon);
  let solidFill = 0;
  let changedFromSource = 0;
  let aaEdge = 0;
  let trueInterior = 0;
  let residualNameInk = 0;
  const deepRows = { above: new Set<number>(), below: new Set<number>(), left: new Set<number>(), right: new Set<number>() };
  const bounds = rect ?? {
    x0: Math.min(...input.polygon.map((point) => point[0]!)),
    x1: Math.max(...input.polygon.map((point) => point[0]!)),
    y0: Math.min(...input.polygon.map((point) => point[1]!)),
    y1: Math.max(...input.polygon.map((point) => point[1]!)),
  };
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const source = readPixel(input.source, input.width, channels, x, y);
      const opaque = readPixel(input.opaque, input.width, channels, x, y);
      const paint = classifyPaint(source, opaque);
      if (paint !== "unpainted") changedFromSource += 1;
      if (paint === "solid_fill") solidFill += 1;
      if (!isNameInk(input.source, input.width, input.height, channels, x, y, input.capsule, input.badgeXMax)) continue;
      const here = centerInside(x, y, input.polygon, rect);
      if (!here) {
        if (paint === "solid_fill") continue;
        const dx = x + 0.5 < bounds.x0 ? bounds.x0 - x : (x + 0.5 >= bounds.x1 ? x - (bounds.x1 - 1) : 0);
        const dy = y + 0.5 < bounds.y0 ? bounds.y0 - y : (y + 0.5 >= bounds.y1 ? y - (bounds.y1 - 1) : 0);
        if (Math.max(dx, dy) > RESIDUAL_BAND_PX) continue;
        residualNameInk += 1;
        if (dy >= 2 && dy >= dx) (y + 0.5 < bounds.y0 ? deepRows.above : deepRows.below).add(x);
        if (dx >= 2 && dx > dy) (x + 0.5 < bounds.x0 ? deepRows.left : deepRows.right).add(y);
        continue;
      }
      if (paint === "solid_fill") continue;
      const neighborOutside = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => {
        if (nx! < 0 || ny! < 0 || nx! >= input.width || ny! >= input.height) return true;
        return !centerInside(nx!, ny!, input.polygon, rect);
      });
      if (neighborOutside && paint === "changed_not_solid") aaEdge += 1;
      else trueInterior += 1;
    }
  }
  const depthHold = Object.values(deepRows).some((rows) => rows.size >= 2);
  const countHold = input.shortSurname === true
    ? residualNameInk >= SHORT_SURNAME_RESIDUAL_HOLD
    : residualNameInk >= RESIDUAL_NAME_INK_HOLD;
  const residualHold = countHold || depthHold;
  const interiorDefect = trueInterior >= TRUE_INTERIOR_HOLD;
  const verdict: ExactOutputVerdict = interiorDefect ? "hold_interior" : (residualHold ? "hold_residual_ink" : "pass_exact_output");
  return {
    solidFill,
    changedFromSource,
    aaEdge,
    trueInterior,
    residualNameInk,
    interiorDefect,
    residualHold,
    verdict,
    aaEdgeCountsAsInteriorDefect: false,
    releaseAuthorized: false,
  };
}
