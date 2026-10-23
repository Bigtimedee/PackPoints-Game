/**
 * Deterministic source fixes for card scans that were refused for layout, not
 * for their content: scanner frames around 1988 Topps scans and 705x1200
 * vertically stretched 1986 Topps scans. Each entry pins the exact upstream
 * bytes (sha256) and a crop and/or resize. Applied only to the mask bake
 * source. If the upstream bytes change the override does not apply and the
 * bake gets null (fail closed: no bake, card stays refused).
 *
 * Released #495 and #574 are cropped to the printed card instead. That crop
 * does not register a region shift, so the set mask is not widened. #499, the
 * stamp cards, and the autograph are not cropped. An override never approves a card.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import type { MaskRegion } from "@shared/schema";
import { RECROP_BLOCKED_CARDS, RECROP_RELEASED_1988_IDS, recropPermanentlyExcluded } from "./toppsRecropReview";
import { TOPPS_1988_REVIEWED_SOURCES } from "./topps1988Geometry";

export interface MaskSourceOverride {
  setId: string;
  number: string;
  player: string;
  inputSha256: string;
  extract?: { left: number; top: number; width: number; height: number };
  resize?: { width: number; height: number };
  why: string;
}

let cache: Record<string, MaskSourceOverride> | null = null;

export function maskSourceOverrides(): Record<string, MaskSourceOverride> {
  if (cache) return cache;
  try {
    const file = path.join(process.cwd(), "server", "data", "maskSourceOverrides.json");
    cache = JSON.parse(readFileSync(file, "utf8")) as Record<string, MaskSourceOverride>;
  } catch {
    cache = {};
  }
  return cache;
}

export function setMaskSourceOverridesForTests(next: Record<string, MaskSourceOverride> | null): void {
  cache = next;
}

/** Stable digest of the overrides for one set; part of the profile rebuild signature. */
export function maskSourceOverrideDigest(setId: string): string {
  const entries = Object.entries(maskSourceOverrides())
    .filter(([, o]) => o.setId === setId)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "";
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16);
}

export function hasMaskSourceOverride(cardId: string): boolean {
  return Boolean(maskSourceOverrides()[cardId]);
}

/**
 * Returns the fixed buffer, the raw buffer when the card has no override, or
 * null when an override exists but the upstream bytes no longer match.
 */
const HELD_BY_ID = new Map(RECROP_BLOCKED_CARDS.map((card) => [card.id, card]));

/** Crop of a held scan, in the upright source pixels the set mask was drawn on. */
export interface HeldCropMeta {
  srcW: number;
  srcH: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

const heldCrops = new WeakMap<Buffer, HeldCropMeta>();

export function heldCropMeta(buffer: Buffer): HeldCropMeta | null {
  return heldCrops.get(buffer) ?? null;
}

/**
 * Move set-profile regions onto the cropped scan.
 * A region that the crop cut away is dropped. The part that remains covers
 * the same card pixels, including the name plate, and not the photo above it.
 */
export function remapMaskRegions(regions: readonly MaskRegion[], meta: HeldCropMeta): MaskRegion[] {
  const mapped: MaskRegion[] = [];
  for (const region of regions) {
    const x0 = (region.xPct / 100) * meta.srcW;
    const y0 = (region.yPct / 100) * meta.srcH;
    const x1 = x0 + (region.wPct / 100) * meta.srcW;
    const y1 = y0 + (region.hPct / 100) * meta.srcH;
    const cx0 = Math.max(x0, meta.left);
    const cy0 = Math.max(y0, meta.top);
    const cx1 = Math.min(x1, meta.left + meta.width);
    const cy1 = Math.min(y1, meta.top + meta.height);
    const wPx = cx1 - cx0;
    const hPx = cy1 - cy0;
    if (wPx < 2 || hPx < 2) continue;
    mapped.push({
      xPct: ((cx0 - meta.left) / meta.width) * 100,
      yPct: ((cy0 - meta.top) / meta.height) * 100,
      wPct: (wPx / meta.width) * 100,
      hPct: (hPx / meta.height) * 100,
      type: region.type,
      radiusPct: region.radiusPct ?? 0,
    });
  }
  return mapped;
}

/** Profile regions, shifted onto this held crop when the scan was trimmed. */
export function regionsAfterHeldCrop(regions: readonly MaskRegion[], buffer: Buffer): MaskRegion[] {
  const meta = heldCrops.get(buffer);
  if (!meta) return regions.map((region) => ({ ...region }));
  const mapped = remapMaskRegions(regions, meta);
  return mapped.length ? mapped : regions.map((region) => ({ ...region }));
}

export async function applyMaskSourceOverride(cardId: string, raw: Buffer): Promise<Buffer | null> {
  if (EDGE_CROP_IDS.has(cardId) || HELD_BY_ID.has(cardId)) return fixHeldRecropSource(cardId, raw);
  const o = maskSourceOverrides()[cardId];
  if (!o) return raw;
  if (createHash("sha256").update(raw).digest("hex") !== o.inputSha256) {
    console.warn(`[MaskSourceOverride] card=${cardId} upstream changed; override not applied, bake refused`);
    return null;
  }
  return applyDeclared(raw, o);
}

async function applyDeclared(raw: Buffer, o: MaskSourceOverride): Promise<Buffer> {
  let img = sharp(raw).rotate(0);
  if (o.extract) img = img.extract(o.extract);
  if (o.resize) img = img.resize(o.resize.width, o.resize.height, { fit: "fill", kernel: "lanczos3" });
  return img.jpeg({ quality: 95 }).toBuffer();
}

const EDGE_CROP_IDS = new Set<string>(RECROP_RELEASED_1988_IDS);

/**
 * Excluded cards are not cropped.
 * #495 and #574 lose a near-black scanner frame and a near-white mat
 * and keep the printed card. The set mask is not remapped, so it is not widened.
 * A narrow result is scaled with the ratio kept. Nothing is stretched or painted.
 */
function expectedEdgeRawSha(cardId: string): string | null {
  return maskSourceOverrides()[cardId]?.inputSha256
    ?? TOPPS_1988_REVIEWED_SOURCES.find((source) => source.cardId === cardId)?.sha256
    ?? null;
}

async function fixHeldRecropSource(cardId: string, raw: Buffer): Promise<Buffer | null> {
  if (recropPermanentlyExcluded(cardId) || !EDGE_CROP_IDS.has(cardId)) return raw;
  const expected = expectedEdgeRawSha(cardId);
  if (expected && createHash("sha256").update(raw).digest("hex") !== expected) return null;
  const trimmed = await trimPrintedCardEdge(raw);
  let out = trimmed;
  const sized = await sharp(out).metadata();
  const width = sized.width ?? 0;
  if (width > 0 && width < 360) {
    out = await sharp(out).resize({ width: 360, kernel: "lanczos3" }).toBuffer();
  }
  if (out === raw) return raw;
  return sharp(out).jpeg({ quality: 95 }).toBuffer();
}

interface LineStat {
  mean: number;
  sd: number;
  white: number;
}

function luminance(data: Buffer, index: number): number {
  return 0.3 * data[index] + 0.59 * data[index + 1] + 0.11 * data[index + 2];
}

/** Stats on the middle of the line, so a dark side frame does not hide a white mat. */
function lineStat(
  data: Buffer,
  width: number,
  channels: number,
  axis: "row" | "col",
  index: number,
  from: number,
  to: number,
): LineStat {
  let sum = 0;
  let sum2 = 0;
  let white = 0;
  let n = 0;
  if (axis === "row") {
    for (let x = from; x < to; x += 2) {
      const v = luminance(data, (index * width + x) * channels);
      sum += v;
      sum2 += v * v;
      n += 1;
      if (v >= 225) white += 1;
    }
  } else {
    for (let y = from; y < to; y += 2) {
      const v = luminance(data, (y * width + index) * channels);
      sum += v;
      sum2 += v * v;
      n += 1;
      if (v >= 225) white += 1;
    }
  }
  const mean = n > 0 ? sum / n : 0;
  return { mean, sd: Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean)), white: n > 0 ? white / n : 0 };
}

function isScannerDark(stat: LineStat): boolean {
  return stat.mean < 42 && stat.sd < 18 && stat.white < 0.05;
}

function isScannerGray(stat: LineStat): boolean {
  return stat.mean < 78 && stat.sd < 16 && stat.white < 0.05;
}

function isScannerWhite(stat: LineStat): boolean {
  return stat.white >= 0.82 && stat.mean >= 205 && stat.sd < 20;
}

/**
 * How far a near-black frame and the white mat after it extend in from this edge.
 * Gray between the black frame and the mat is included only when the mat follows.
 * A colored name plate with no mat after it stays.
 */
function matInset(stats: LineStat[]): number {
  const limit = Math.floor(stats.length * 0.22);
  if (limit < 8) return 0;
  let i = 0;
  while (i < limit && isScannerDark(stats[i])) i += 1;
  if (i >= limit) return 0;
  const blackEnd = i;
  let j = i;
  let lastGray = blackEnd;
  let grayMisses = 0;
  const grayLimit = Math.min(limit, blackEnd + 70);
  while (j < grayLimit) {
    if (isScannerGray(stats[j]) || isScannerDark(stats[j])) {
      grayMisses = 0;
      j += 1;
      lastGray = j;
      continue;
    }
    grayMisses += 1;
    if (grayMisses > 3) break;
    j += 1;
  }
  const bridgeEnd = lastGray;
  let k = bridgeEnd;
  let whiteEnd = -1;
  while (k < limit) {
    if (!isScannerWhite(stats[k])) {
      k += 1;
      continue;
    }
    const start = k;
    while (k < limit && isScannerWhite(stats[k])) k += 1;
    if (k - start >= 8 && start - bridgeEnd <= 36) whiteEnd = k;
    else break;
  }
  if (whiteEnd >= 0) return whiteEnd;
  return blackEnd >= 8 ? blackEnd : 0;
}

/**
 * A one-pixel white line can sit just inside a dark speck of the scanner frame.
 * Shave through that line when the pixels outside it are not the photo.
 */
function throughWhiteLine(stats: LineStat[], fromStart: boolean): number {
  const limit = Math.min(8, stats.length);
  let lastWhite = -1;
  for (let i = 0; i < limit; i++) {
    const stat = stats[fromStart ? i : stats.length - 1 - i];
    if (stat.white >= 0.45 && stat.mean >= 175) lastWhite = i;
  }
  if (lastWhite < 0) return 0;
  for (let i = 0; i < lastWhite; i++) {
    const stat = stats[fromStart ? i : stats.length - 1 - i];
    if (stat.white >= 0.2) return 0;
  }
  return lastWhite + 1;
}

/** Crop a scanner frame and white mat. The printed card, including its name plate, stays. */
async function trimPrintedCardEdge(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).rotate().raw().toBuffer({ resolveWithObject: true });
  const w = info.width ?? 0;
  const h = info.height ?? 0;
  const c = info.channels ?? 3;
  if (w < 80 || h < 80 || c < 3) return buf;
  const x0 = Math.floor(w * 0.28);
  const x1 = Math.floor(w * 0.72);
  const y0 = Math.floor(h * 0.22);
  const y1 = Math.floor(h * 0.72);
  const rows: LineStat[] = [];
  const cols: LineStat[] = [];
  for (let y = 0; y < h; y++) rows.push(lineStat(data, w, c, "row", y, x0, x1));
  for (let x = 0; x < w; x++) cols.push(lineStat(data, w, c, "col", x, y0, y1));
  let top = matInset(rows);
  let bottom = matInset([...rows].reverse());
  let left = matInset(cols);
  let right = matInset([...cols].reverse());
  const keptRows = rows.slice(top, h - bottom);
  const keptCols = cols.slice(left, w - right);
  top += throughWhiteLine(keptRows, true);
  bottom += throughWhiteLine(keptRows, false);
  left += throughWhiteLine(keptCols, true);
  right += throughWhiteLine(keptCols, false);
  if (left === 0 && right === 0 && top === 0 && bottom === 0) return buf;
  const cropW = w - left - right;
  const cropH = h - top - bottom;
  if (cropW < 80 || cropH < 80) return buf;
  return sharp(buf).rotate().extract({ left, top, width: cropW, height: cropH }).toBuffer();
}
