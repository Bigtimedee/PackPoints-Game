/**
 * Deterministic source fixes for card scans that were refused for layout, not
 * for their content: scanner frames around 1988 Topps scans and 705x1200
 * vertically stretched 1986 Topps scans. Each entry pins the exact upstream
 * bytes (sha256) and a crop and/or resize. Applied only to the mask bake
 * source. If the upstream bytes change the override does not apply and the
 * bake gets null (fail closed: no bake, card stays refused).
 *
 * An override never approves a card. Re-baked cards stay held behind the card
 * review guard until Design approves them by eye.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import { RECROP_BLOCKED_CARDS, RECROP_STAMP_IDS, RECROP_STRETCH_IDS, TOPPS_1986_SET_ID } from "./toppsRecropReview";

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
const STAMP_IDS = new Set(RECROP_STAMP_IDS);
const STRETCH_IDS = new Set(RECROP_STRETCH_IDS);
const CARD_ASPECT = 3.5 / 2.5;

export async function applyMaskSourceOverride(cardId: string, raw: Buffer): Promise<Buffer | null> {
  if (HELD_BY_ID.has(cardId)) return fixHeldRecropSource(cardId, raw);
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

/**
 * 1988 #495's pinned extract cuts off the team-name banner. The masked image
 * then has no OCR words and the bake is refused. Leave that extract off.
 * #495 and #574 are trimmed on flat scanner margins only. The old mean-luminance
 * trim on #574 shifted the surname outside the diagonal mask.
 */
const SKIP_HELD_EXTRACT = new Set(["8d0fc5e2-41ea-4428-a662-e9a059350599"]);
const FLAT_FRAME_IDS = new Set([
  "8d0fc5e2-41ea-4428-a662-e9a059350599",
  "a5106b0b-151c-496b-91bc-815174d48bb3",
]);
const GIBSON_1986_ID = "1cf53402-61f8-4fac-9aae-4fb7b9cf112e";

/**
 * Held recrop scans are corrected from the current bytes.
 * 1986 #499 is resized to the card aspect when it misses the 0.68-0.76 gate.
 * A dark scanner frame is trimmed. #495 and #574 lose a flat frame of any color.
 * A DISCOVER TOPPS stamp column is cropped past its letters.
 * Nothing is painted over the team name. #328 is not corrected.
 */
async function fixHeldRecropSource(cardId: string, raw: Buffer): Promise<Buffer> {
  const meta = await sharp(raw).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const held = HELD_BY_ID.get(cardId);
  let source = raw;
  if (cardId === GIBSON_1986_ID) {
    const orient = meta.orientation ?? 1;
    if (orient > 1) source = await sharp(raw).rotate().toBuffer();
    source = await trimFlatEdges(source, 0.45);
  }
  const sized = source === raw ? { width, height } : await sharp(source).metadata();
  const useW = sized.width ?? width;
  const useH = sized.height ?? height;
  const ratio = useW > 0 && useH > 0 ? useW / useH : 1;
  const tooTall = ratio < 0.66;
  const gibsonOffGate = cardId === GIBSON_1986_ID && (ratio < 0.68 || ratio > 0.76 || useW < 360);
  const unstretch = (tooTall && (STRETCH_IDS.has(cardId) || held?.setId === TOPPS_1986_SET_ID)) || gibsonOffGate;
  let buf = source;
  if (unstretch) {
    const targetW = Math.max(useW, 360);
    const targetH = Math.round(targetW * CARD_ASPECT);
    buf = await sharp(source).rotate(0).resize(targetW, targetH, { fit: "fill", kernel: "lanczos3" }).toBuffer();
  } else {
    const declared = maskSourceOverrides()[cardId];
    if (!SKIP_HELD_EXTRACT.has(cardId) && declared?.extract && extractFits(width, height, declared.extract)) {
      buf = await sharp(raw).rotate(0).extract(declared.extract).toBuffer();
    }
    buf = FLAT_FRAME_IDS.has(cardId) ? await trimFlatEdges(buf) : await trimDarkEdges(buf);
  }
  if (STAMP_IDS.has(cardId)) buf = await cropDiscoverStamp(buf);
  if (buf === raw) return raw;
  return sharp(buf).jpeg({ quality: 95 }).toBuffer();
}

function extractFits(width: number, height: number, box: { left: number; top: number; width: number; height: number }): boolean {
  return box.left >= 0 && box.top >= 0 && box.width > 0 && box.height > 0
    && box.left + box.width <= width && box.top + box.height <= height;
}

async function trimDarkEdges(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const w = info.width ?? 0;
  const h = info.height ?? 0;
  const c = info.channels ?? 3;
  if (w < 80 || h < 80) return buf;
  const meanCol = (x: number) => {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < h; y += 3) {
      const i = (y * w + x) * c;
      sum += 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      n += 1;
    }
    return sum / n;
  };
  const meanRow = (y: number) => {
    let sum = 0;
    let n = 0;
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * c;
      sum += 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      n += 1;
    }
    return sum / n;
  };
  let left = 0;
  let right = w - 1;
  let top = 0;
  let bottom = h - 1;
  const maxX = Math.floor(w * 0.12);
  const maxY = Math.floor(h * 0.12);
  while (left < maxX && meanCol(left) < 96) left += 1;
  while (w - 1 - right < maxX && meanCol(right) < 96) right -= 1;
  while (top < maxY && meanRow(top) < 96) top += 1;
  while (h - 1 - bottom < maxY && meanRow(bottom) < 96) bottom -= 1;
  if (left > 0 && meanCol(Math.min(w - 1, left)) < meanCol(0) + 35) left = 0;
  if (right < w - 1 && meanCol(Math.max(0, right)) < meanCol(w - 1) + 35) right = w - 1;
  if (top > 0 && meanRow(Math.min(h - 1, top)) < meanRow(0) + 35) top = 0;
  if (bottom < h - 1 && meanRow(Math.max(0, bottom)) < meanRow(h - 1) + 35) bottom = h - 1;
  if (left < 8 && top < 8 && w - 1 - right < 8 && h - 1 - bottom < 8) return buf;
  const cropW = right - left + 1;
  const cropH = bottom - top + 1;
  const aspect = cropW / cropH;
  if (aspect < 0.66 || aspect > 0.80 || cropW < 360) return buf;
  return sharp(buf).extract({ left, top, width: cropW, height: cropH }).toBuffer();
}

/** Trim a flat scanner frame of any color. Stops at the first non-flat edge, which is the card border. */
async function trimFlatEdges(buf: Buffer, aspectMin = 0.66): Promise<Buffer> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const w = info.width ?? 0;
  const h = info.height ?? 0;
  const c = info.channels ?? 3;
  if (w < 80 || h < 80) return buf;
  const colSd = columnSpread(data, w, h, c);
  const rowSd = rowSpread(data, w, h, c);
  const flat = (sd: number) => sd < 12;
  const maxX = Math.floor(w * 0.16);
  const maxY = Math.floor(h * 0.16);
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  while (left < maxX && flat(colSd[left])) left += 1;
  while (right < maxX && flat(colSd[w - 1 - right])) right += 1;
  while (top < maxY && flat(rowSd[top])) top += 1;
  while (bottom < maxY && flat(rowSd[h - 1 - bottom])) bottom += 1;
  if (left > 0 && flat(colSd[Math.min(w - 1, left)])) left = 0;
  if (right > 0 && flat(colSd[Math.max(0, w - 1 - right)])) right = 0;
  if (top > 0 && flat(rowSd[Math.min(h - 1, top)])) top = 0;
  if (bottom > 0 && flat(rowSd[Math.max(0, h - 1 - bottom)])) bottom = 0;
  if (left < 8 && top < 8 && right < 8 && bottom < 8) return buf;
  const cropW = w - left - right;
  const cropH = h - top - bottom;
  const aspect = cropW / cropH;
  if (aspect < aspectMin || aspect > 0.80 || cropW < 360) return buf;
  return sharp(buf).extract({ left, top, width: cropW, height: cropH }).toBuffer();
}

function columnSpread(data: Buffer, w: number, h: number, c: number): number[] {
  const sds: number[] = [];
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let y = 0; y < h; y += 2) {
      const i = (y * w + x) * c;
      const v = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      sum += v;
      sum2 += v * v;
      n += 1;
    }
    const mean = sum / n;
    sds.push(Math.sqrt(Math.max(0, sum2 / n - mean * mean)));
  }
  return sds;
}

function rowSpread(data: Buffer, w: number, h: number, c: number): number[] {
  const sds: number[] = [];
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * c;
      const v = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      sum += v;
      sum2 += v * v;
      n += 1;
    }
    const mean = sum / n;
    sds.push(Math.sqrt(Math.max(0, sum2 / n - mean * mean)));
  }
  return sds;
}

/**
 * How far the vertical DISCOVER TOPPS letters extend in from the right edge.
 * Letters cross a local luminance baseline. The photo behind a smooth border
 * does not. A busy photo is capped so the walk cannot keep going across the card.
 */
function stampColumnCut(data: Buffer, w: number, h: number, c: number): number {
  if (w < 80 || h < 80) return 0;
  const y0 = Math.floor(h * 0.2);
  const y1 = Math.floor(h * 0.8);
  const depth = Math.min(Math.floor(w * 0.22), 180);
  const win = 55;
  const span = y1 - y0;
  if (span <= win + 2) return 0;
  const scores: number[] = [];
  for (let dx = 0; dx < depth; dx++) {
    const x = w - 1 - dx;
    const vals: number[] = [];
    for (let y = y0; y < y1; y++) {
      const i = (y * w + x) * c;
      vals.push(0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]);
    }
    let sum = 0;
    for (let k = 0; k <= win; k++) sum += vals[k];
    let crossings = 0;
    let prev = 0;
    for (let i = win; i < span; i++) {
      if (i > win) sum += vals[i] - vals[i - win - 1];
      const delta = vals[i] - sum / (win + 1);
      const sign = delta > 20 ? 1 : delta < -20 ? -1 : 0;
      if (sign !== 0 && sign !== prev) crossings += 1;
      if (sign !== 0) prev = sign;
    }
    scores.push(crossings);
  }
  const floor = 22;
  let best: { start: number; end: number; peak: number } | null = null;
  let i = 0;
  while (i < scores.length) {
    if (scores[i] < floor) {
      i += 1;
      continue;
    }
    const start = i;
    let end = i;
    let peak = scores[i];
    let gap = 0;
    i += 1;
    while (i < scores.length && i < start + 96) {
      if (scores[i] >= floor) {
        end = i;
        if (scores[i] > peak) peak = scores[i];
        gap = 0;
      } else {
        gap += 1;
        if (gap > 6) break;
      }
      i += 1;
    }
    if (end - start >= 10 && peak >= 30 && (!best || peak > best.peak)) best = { start, end, peak };
  }
  if (!best) return 0;
  const strong = best.peak * 0.42;
  const limit = Math.min(best.end, best.start + 78);
  let end = best.start;
  for (let k = best.start; k <= limit; k++) if (scores[k] >= strong) end = k;
  return end + 10;
}

/**
 * Crop a DISCOVER TOPPS stamp off the right edge. A flat scanner margin is
 * removed, then the vertical letter column just inside the card border is
 * cropped past. The team-name banner is a long content run and stays.
 * A solid white rectangle over #410's team name is cleared without painting
 * over the letters.
 */
async function cropDiscoverStamp(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const w = info.width ?? 0;
  const h = info.height ?? 0;
  const c = info.channels ?? 3;
  if (w < 80 || h < 80) return buf;
  const rowSd: number[] = [];
  const colSd: number[] = [];
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * c;
      const v = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      sum += v;
      sum2 += v * v;
      n += 1;
    }
    const mean = sum / n;
    rowSd.push(Math.sqrt(Math.max(0, sum2 / n - mean * mean)));
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let y = 0; y < h; y += 3) {
      const i = (y * w + x) * c;
      const v = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      sum += v;
      sum2 += v * v;
      n += 1;
    }
    const mean = sum / n;
    colSd.push(Math.sqrt(Math.max(0, sum2 / n - mean * mean)));
  }
  const content = (sd: number) => sd > 14;
  const inset = (sds: number[], forward: boolean): number => {
    const limit = Math.floor(sds.length * 0.16);
    const at = (i: number) => sds[forward ? i : sds.length - 1 - i];
    let i = 0;
    while (i < limit) {
      if (!content(at(i))) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < limit && content(at(j))) j += 1;
      let k = j;
      while (k < limit && !content(at(k))) k += 1;
      const island = j - i;
      const gap = k - j;
      if (island < Math.floor(sds.length * 0.05) && gap >= 4 && k < limit) {
        i = k;
        continue;
      }
      return i;
    }
    return 0;
  };
  const top = inset(rowSd, true);
  const bottomCut = inset(rowSd, false);
  const left = inset(colSd, true);
  const marginRight = inset(colSd, false);
  const stampRight = stampColumnCut(data, w, h, c);
  const rightCut = Math.max(marginRight, stampRight);
  const cropH = h - top - bottomCut;
  let cropped = buf;
  // Stretched 705x1200 scans sit near 0.59, and a stamp column cut makes them
  // narrower. The 1988 mask is percentage-based, so keep a crop that stays in range.
  const fits = (right: number) => {
    const cropW = w - left - right;
    const aspect = cropW / cropH;
    const moved = top >= 8 || bottomCut >= 8 || left >= 8 || right >= 8;
    return cropW >= 360 && aspect >= 0.48 && aspect <= 0.80 && moved;
  };
  const right = fits(rightCut) ? rightCut : marginRight;
  if (fits(right)) {
    cropped = await sharp(buf).extract({ left, top, width: w - left - right, height: cropH }).toBuffer();
  }
  return clearBannerWhitePatch(cropped);
}

/** Remove a solid white rectangle covering #410's team name. Letter pixels stay. */
async function clearBannerWhitePatch(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const w = info.width ?? 0;
  const h = info.height ?? 0;
  const c = info.channels ?? 3;
  if (w < 80 || h < 80 || c < 3) return buf;
  const y1 = Math.floor(h * 0.16);
  const lumAt = (x: number, y: number) => {
    const i = (y * w + x) * c;
    return 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
  };
  // Banner letters are the first high-variance rows. A white patch on those
  // rows is a wide run of near-white pixels.
  let letterTop = -1;
  let letterBottom = -1;
  for (let y = 0; y < y1; y++) {
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let x = 0; x < w; x += 2) {
      const v = lumAt(x, y);
      sum += v;
      sum2 += v * v;
      n += 1;
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    if (sd > 28 && mean > 80 && mean < 220) {
      if (letterTop < 0) letterTop = y;
      letterBottom = y;
    }
  }
  if (letterTop < 0 || letterBottom - letterTop < 8) return buf;
  let best: { x0: number; x1: number; y0: number; y1: number } | null = null;
  for (let y = letterTop; y <= letterBottom; y++) {
    let x = 0;
    while (x < w) {
      if (lumAt(x, y) < 236) {
        x += 1;
        continue;
      }
      let x2 = x;
      while (x2 < w && lumAt(x2, y) >= 236) x2 += 1;
      if (x2 - x >= Math.floor(w * 0.12)) {
        let y2 = y;
        while (y2 <= letterBottom) {
          let white = 0;
          let n = 0;
          for (let xx = x; xx < x2; xx += 2) {
            n += 1;
            if (lumAt(xx, y2) >= 236) white += 1;
          }
          if (n === 0 || white / n < 0.92) break;
          y2 += 1;
        }
        if (y2 - y >= 8 && (!best || (x2 - x) * (y2 - y) > (best.x1 - best.x0) * (best.y1 - best.y0))) {
          best = { x0: x, x1: x2, y0: y, y1: y2 };
        }
      }
      x = x2 + 1;
    }
  }
  if (!best) return buf;
  const sampleX = Math.min(w - 1, best.x1 + 2);
  const sampleY = Math.min(h - 1, Math.floor((best.y0 + best.y1) / 2));
  const si = (sampleY * w + sampleX) * c;
  const copy = Buffer.from(data);
  for (let y = best.y0; y < best.y1; y++) {
    for (let x = best.x0; x < best.x1; x++) {
      if (lumAt(x, y) < 236) continue;
      const i = (y * w + x) * c;
      copy[i] = data[si];
      copy[i + 1] = data[si + 1];
      copy[i + 2] = data[si + 2];
    }
  }
  return sharp(copy, { raw: { width: w, height: h, channels: c } }).jpeg({ quality: 95 }).toBuffer();
}
