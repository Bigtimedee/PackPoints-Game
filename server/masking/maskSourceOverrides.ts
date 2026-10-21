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
 * Held recrop scans are corrected from the current bytes.
 * A 705x1200 scan is the stretched file; 327 and 656, and the held 1986
 * unstretch cohort, are resized to the card aspect (2.5 by 3.5).
 * A dark scanner frame is trimmed. A DISCOVER TOPPS stamp is covered.
 */
async function fixHeldRecropSource(cardId: string, raw: Buffer): Promise<Buffer> {
  const meta = await sharp(raw).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const held = HELD_BY_ID.get(cardId);
  const stretched = width > 0 && height > 0 && width / height < 0.66;
  const unstretch = stretched && (STRETCH_IDS.has(cardId) || (held?.setId === TOPPS_1986_SET_ID && width === 705 && height === 1200));
  let buf = raw;
  if (unstretch) {
    const targetH = Math.round(width * CARD_ASPECT);
    buf = await sharp(raw).rotate(0).resize(width, targetH, { fit: "fill", kernel: "lanczos3" }).toBuffer();
  } else {
    const declared = maskSourceOverrides()[cardId];
    if (declared?.extract && extractFits(width, height, declared.extract)) {
      buf = await sharp(raw).rotate(0).extract(declared.extract).toBuffer();
    }
    buf = await trimDarkEdges(buf);
  }
  if (STAMP_IDS.has(cardId)) buf = await coverDiscoverStamp(buf);
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

/** Cover the top-left DISCOVER TOPPS stamp with the banner color beside it. */
async function coverDiscoverStamp(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 80 || h < 80) return buf;
  const left = Math.round(w * 0.015);
  const top = Math.round(h * 0.012);
  const width = Math.max(8, Math.round(w * 0.40));
  const height = Math.max(8, Math.round(h * 0.14));
  const sampleLeft = Math.min(w - 3, left + width + 4);
  const sampleTop = Math.min(h - 3, top + Math.round(height / 2));
  const sample = await sharp(buf).extract({ left: sampleLeft, top: sampleTop, width: 3, height: 3 }).raw().toBuffer();
  const patch = await sharp({
    create: { width, height, channels: 3, background: { r: sample[0], g: sample[1], b: sample[2] } },
  }).png().toBuffer();
  return sharp(buf).composite([{ input: patch, left, top }]).toBuffer();
}
