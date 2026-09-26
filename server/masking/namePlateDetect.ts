/**
 * Find the name plate on this scan.
 * Profile fractions assume a ~750x1030 file that still has its outer margin.
 * A tight crop keeps the plate and drops that margin, so the plate edge has
 * to be measured on the file that will be baked.
 */
import sharp from "sharp";
import type { NamePlateBox } from "@shared/maskGeometry";
import type { NameAnchor } from "./maskProfiles";

function lumAt(raw: Buffer, width: number, channels: number, x: number, y: number): number {
  const i = (y * width + x) * channels;
  return 0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2];
}

export function rowMeans(raw: Buffer, width: number, height: number, channels: number): number[] {
  const means: number[] = [];
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) sum += lumAt(raw, width, channels, x, y);
    means.push(sum / Math.max(1, width));
  }
  return means;
}

function avg(means: number[], start: number, end: number): number {
  const a = Math.max(0, Math.min(means.length, start));
  const b = Math.max(a, Math.min(means.length, end));
  if (b <= a) return means[Math.min(means.length - 1, a)] ?? 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += means[i];
  return sum / (b - a);
}

/** Deepest luminance break in the top 42%. Stacked header bars stay inside the plate. */
export function lastLuminanceEdgeFromTop(means: number[]): number | null {
  const height = means.length;
  if (height < 8) return null;
  const limit = Math.floor(height * 0.42);
  const window = Math.max(2, Math.round(height * 0.02));
  let best: number | null = null;
  for (let y = window; y < limit - window; y++) {
    const before = avg(means, y - window, y);
    const after = avg(means, y, y + window * 2);
    if (Math.abs(after - before) >= 30) best = y;
  }
  return best;
}

/** First luminance break walking up from the bottom. That row is the top of the plaque. */
export function firstLuminanceEdgeFromBottom(means: number[]): number | null {
  const height = means.length;
  if (height < 8) return null;
  const window = Math.max(2, Math.round(height * 0.02));
  const stop = Math.floor(height * 0.35);
  for (let y = height - window - 1; y > stop; y--) {
    const towardBottom = avg(means, y, y + window);
    const towardPhoto = avg(means, y - window * 2, y);
    if (Math.abs(towardBottom - towardPhoto) >= 30) return y;
  }
  return null;
}

/**
 * Dark ink on a light plate (or the reverse). A resized mean can hide this:
 * vertical letter bars average to the same gray as the photo, so the luminance
 * edge never fires and the band stops mid-letter.
 */
export function rowIsBimodalText(lum: number[]): boolean {
  if (lum.length < 8) return false;
  const sorted = [...lum].sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  if (p90 - p10 < 80) return false;
  let peaks = 0;
  for (const value of lum) {
    if (value <= p10 + 25 || value >= p90 - 25) peaks++;
  }
  return peaks / lum.length >= 0.72;
}

export function rowTextFlags(raw: Buffer, width: number, height: number, channels: number): boolean[] {
  const flags: boolean[] = [];
  for (let y = 0; y < height; y++) {
    const lum: number[] = new Array(width);
    for (let x = 0; x < width; x++) lum[x] = lumAt(raw, width, channels, x, y);
    flags.push(rowIsBimodalText(lum));
  }
  return flags;
}

/** Bottom of a text run that starts in the top 12% and ends before the 42% cap. */
export function lastTextEdgeFromTop(textRows: boolean[]): number | null {
  const height = textRows.length;
  if (height < 8) return null;
  const limit = Math.floor(height * 0.42);
  const minRun = Math.max(3, Math.round(height * 0.04));
  const startLimit = Math.floor(height * 0.12);
  let runStart = -1;
  let best: number | null = null;
  for (let y = 0; y <= limit; y++) {
    const on = y < limit && textRows[y] === true;
    if (on) {
      if (runStart < 0) runStart = y;
      continue;
    }
    if (runStart >= 0) {
      if (runStart <= startLimit && y - runStart >= minRun) best = y;
      runStart = -1;
    }
  }
  return best;
}

/** Top of a text run that reaches the bottom edge. Unbounded runs are ignored. */
export function firstTextEdgeFromBottom(textRows: boolean[]): number | null {
  return bottomTextRun(textRows)?.top ?? null;
}

/**
 * The printed name in the lower half, as a run of letter rows.
 * The run's own bottom is the box, not the card edge, so a name line does
 * not become the whole plaque.
 */
export function bottomTextRun(textRows: boolean[]): { top: number; bottom: number } | null {
  const height = textRows.length;
  if (height < 8) return null;
  const stop = Math.floor(height * 0.45);
  const minRun = Math.max(3, Math.round(height * 0.03));
  let y = height - 1;
  while (y > stop) {
    if (!textRows[y]) {
      y--;
      continue;
    }
    const runEnd = y;
    while (y > stop && textRows[y - 1]) y--;
    if (y === stop && y > 0 && textRows[y - 1]) return null;
    if (runEnd - y + 1 >= minRun) return { top: y, bottom: runEnd + 1 };
    y--;
  }
  return null;
}

function deeperEdge(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/** Text may extend a little above the color break. A much higher edge is the photo. */
function higherPlateEdge(lum: number | null, text: number | null, height: number): number | null {
  if (text == null) return lum;
  if (lum == null) return text;
  if (text < lum && lum - text <= height * 0.08) return text;
  return lum;
}

/**
 * Plate box in the original image's pixels. Null when this anchor has no edge
 * (a flat fixture, or a slab that paints both bands from the profile).
 */
export async function detectAnchorPlate(
  buffer: Buffer,
  anchor: NameAnchor,
): Promise<NamePlateBox | null> {
  if (anchor === "both") return null;
  const meta = await sharp(buffer).metadata();
  const srcW = meta.width || 0;
  const srcH = meta.height || 0;
  if (srcW < 20 || srcH < 20) return null;

  const targetW = 64;
  const targetH = Math.max(24, Math.round(srcH * (targetW / srcW)));
  const { data, info } = await sharp(buffer)
    .resize(targetW, targetH, { fit: "fill", kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const means = rowMeans(data, info.width, info.height, info.channels);
  const text = rowTextFlags(data, info.width, info.height, info.channels);

  if (anchor === "top") {
    const edge = deeperEdge(lastLuminanceEdgeFromTop(means), lastTextEdgeFromTop(text));
    if (edge == null || edge < 2) return null;
    const hPx = Math.max(1, Math.round((edge / info.height) * srcH));
    return { x: 0, y: 0, w: srcW, h: Math.min(srcH, hPx) };
  }

  const lum = firstLuminanceEdgeFromBottom(means);
  const run = bottomTextRun(text);
  if (run && (lum == null || run.top >= lum - info.height * 0.08)) {
    const yPx = Math.min(srcH - 1, Math.max(0, Math.round((run.top / info.height) * srcH)));
    const bottomPx = Math.min(srcH, Math.max(yPx + 1, Math.round((run.bottom / info.height) * srcH)));
    return { x: 0, y: yPx, w: srcW, h: bottomPx - yPx };
  }
  const edge = higherPlateEdge(lum, run?.top ?? null, info.height);
  if (edge == null) return null;
  const yPx = Math.min(srcH - 1, Math.max(0, Math.round((edge / info.height) * srcH)));
  return { x: 0, y: yPx, w: srcW, h: Math.max(1, srcH - yPx) };
}
