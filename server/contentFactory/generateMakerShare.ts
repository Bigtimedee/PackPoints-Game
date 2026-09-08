/**
 * generateMakerShare.ts
 *
 * Runtime "I MADE THIS SET" PNG: the published set's masked cards + set name +
 * mixtape note. Stock vector fans are never the default.
 *
 * Contract: docs/MAKER_SHARE_CONTRACT.md
 * Storage / URL layout matches generateScoreCard.ts.
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { DEFAULT_MASK_REGIONS, type MaskRegion } from "@shared/schema";
import { buildEmbeddedFontCss, loadScoreCardFonts, measureText, textToPath, type ScoreCardFonts } from "./fonts";
import { getShareOutputBase, SHARE_URL_PREFIX, SCORE_CARD_SIZE, type ScoreCardOutput } from "./generateScoreCard";

export const MAKER_SHARE_SIZE = SCORE_CARD_SIZE;
export const MAKER_SHARE_EYEBROW = "I MADE THIS SET";
export const MAKER_SHARE_FOOTER_URL = "packpts.com/sets";
export const MAKER_SHARE_MAX_FAN = 5;

/** Copy that must never appear on maker share art (gated public brags / stock). */
export const FORBIDDEN_MAKER_SHARE_COPY = [
  "maker rate",
  "dau",
  "wau",
  "mau",
  "stock fan",
  "vector fan",
  "10k makers",
  "thousand makers",
];

const MASKED_P_MARK = `<g transform="scale(0.0546875)">
      <rect width="1024" height="1024" fill="#0b0f16"/>
      <path fill="#ffffff" fill-rule="evenodd" d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z"/>
      <rect x="292" y="448" width="528" height="96" fill="#F5C518"/>
    </g>`;

export interface MakerShareInput {
  setName: string;
  makerNote?: string | null;
  cardCount: number;
  date: string;
  /** Redacted JPEG/PNG buffers, already name-masked. Fan shows up to 5. */
  cardImages: Buffer[];
}

function safeDateDir(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getOutputDir(date: string): string {
  const dir = path.join(getShareOutputBase(), safeDateDir(date));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function parseCardPhotoId(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  const match = imageUrl.match(/\/api\/card-photos\/([a-zA-Z0-9-]+)/i);
  return match?.[1] ?? null;
}

export function makerShareSourceEventId(setId: string): string {
  return `maker_set_${setId}`;
}

export function cardCountLabel(cardCount: number): string {
  const n = Number.isFinite(cardCount) ? Math.max(0, Math.floor(cardCount)) : 0;
  return n === 1 ? "1 card" : `${n} cards`;
}

export function containsForbiddenMakerShareCopy(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_MAKER_SHARE_COPY.some((needle) => {
    if (needle.includes(" ")) return lower.includes(needle);
    return new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(lower);
  });
}

function fitText(
  font: ScoreCardFonts["bold"],
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
): { text: string; size: number } {
  const trimmed = text.trim() || "Untitled set";
  let size = startSize;
  while (size > minSize && measureText(font, trimmed, size) > maxWidth) {
    size -= 2;
  }
  if (measureText(font, trimmed, size) <= maxWidth) {
    return { text: trimmed, size };
  }
  let t = trimmed;
  while (t.length > 1 && measureText(font, `${t}...`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return { text: `${t}...`, size };
}

function safeOutline(
  font: ScoreCardFonts["bold"],
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fill: string,
  options: { anchor?: "start" | "middle" | "end"; letterSpacing?: number } = {},
): string {
  const cleaned = [...text].filter((ch) => {
    if (ch.trim() === "") return true;
    try {
      const d = font.getPath(ch, 0, 0, fontSize).toPathData({ decimalPlaces: 2, flipY: false });
      return !!d;
    } catch {
      return false;
    }
  }).join("");
  return textToPath(font, cleaned, x, y, fontSize, fill, options);
}

function wrapLines(
  font: ScoreCardFonts["regular"],
  text: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (measureText(font, trial, fontSize) <= maxWidth) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measureText(font, `${last}...`, fontSize) > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[maxLines - 1] = `${last}...`;
  return kept;
}

function uniqueRegions(regions: MaskRegion[]): MaskRegion[] {
  const seen = new Set<string>();
  const out: MaskRegion[] = [];
  for (const region of regions) {
    const key = `${region.xPct}:${region.yPct}:${region.wPct}:${region.hPct}:${region.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(region);
  }
  return out;
}

/**
 * Pixelate + darken name bands so share art never leaks the printed player name.
 * Brand-specific regions are applied on top of DEFAULT_MASK_REGIONS (gameplay floor).
 */
export async function redactCardForShare(
  input: Buffer,
  brandRegions: MaskRegion[] = [],
): Promise<Buffer> {
  const regions = uniqueRegions([...DEFAULT_MASK_REGIONS, ...brandRegions]);
  const normalized = await sharp(input).rotate().ensureAlpha().png().toBuffer();
  const meta = await sharp(normalized).metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;

  const overlays: sharp.OverlayOptions[] = [];
  for (const region of regions) {
    const left = Math.max(0, Math.round((region.xPct / 100) * w));
    const top = Math.max(0, Math.round((region.yPct / 100) * h));
    const rw = Math.min(w - left, Math.max(0, Math.round((region.wPct / 100) * w)));
    const rh = Math.min(h - top, Math.max(0, Math.round((region.hPct / 100) * h)));
    if (rw < 2 || rh < 2) continue;

    if (region.type === "pixelate" || region.type === "blur") {
      const pixelated = await sharp(normalized)
        .extract({ left, top, width: rw, height: rh })
        .resize(Math.max(4, Math.floor(rw / 18)), Math.max(4, Math.floor(rh / 18)), { kernel: "nearest" })
        .resize(rw, rh, { kernel: "nearest" })
        .png()
        .toBuffer();
      overlays.push({ input: pixelated, left, top });
    }

    const alpha = region.type === "solid" ? 0.95 : 0.86;
    const dark = await sharp({
      create: {
        width: rw,
        height: rh,
        channels: 4,
        background: { r: 11, g: 15, b: 22, alpha },
      },
    }).png().toBuffer();
    overlays.push({ input: dark, left, top });
  }

  return sharp(normalized).composite(overlays).jpeg({ quality: 82 }).toBuffer();
}

function fanAngles(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const spread = Math.min(36, 10 * (count - 1));
  const start = -spread / 2;
  const step = spread / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

async function cardToDataUri(buffer: Buffer, width: number, height: number): Promise<string> {
  const jpeg = await sharp(buffer)
    .resize(width, height, { fit: "cover", position: "top" })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export async function buildMakerShareSvg(input: MakerShareInput): Promise<string> {
  const W = MAKER_SHARE_SIZE;
  const H = MAKER_SHARE_SIZE;
  const fonts = loadScoreCardFonts();
  const setNameFit = fitText(fonts.bold, input.setName || "Untitled set", 920, 48, 28);
  const noteRaw = (input.makerNote || "").trim();
  const noteLines = noteRaw
    ? wrapLines(fonts.regular, `"${noteRaw}"`, 28, 920, 2)
    : [];
  const countText = cardCountLabel(input.cardCount);
  const fan = input.cardImages.slice(0, MAKER_SHARE_MAX_FAN);
  const angles = fanAngles(fan.length);

  const CARD_W = 240;
  const CARD_H = 336;
  const CX = W / 2;
  const CY = 400;

  const cardUris = await Promise.all(fan.map((buf) => cardToDataUri(buf, CARD_W, CARD_H)));
  const clipDefs = cardUris.map((_, i) =>
    `<clipPath id="makerCard${i}"><rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" rx="14"/></clipPath>`,
  ).join("\n    ");

  const fanSvg = cardUris.map((uri, i) => {
    const angle = angles[i];
    return `<g transform="translate(${CX},${CY}) rotate(${angle.toFixed(2)}) translate(${-CARD_W / 2},${-CARD_H / 2 + 12})">
      <rect x="-6" y="8" width="${CARD_W}" height="${CARD_H}" rx="14" fill="#000000" opacity="0.35"/>
      <rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" rx="14" fill="#1a2230" stroke="#3F4654" stroke-width="3"/>
      <image href="${uri}" xlink:href="${uri}" width="${CARD_W}" height="${CARD_H}" preserveAspectRatio="xMidYMid slice" clip-path="url(#makerCard${i})" />
    </g>`;
  }).join("\n    ");

  const outlined = [
    textToPath(fonts.bold, MAKER_SHARE_EYEBROW, W / 2, 88, 26, "#9CA3AF", { anchor: "middle", letterSpacing: 6 }),
    safeOutline(fonts.bold, setNameFit.text, W / 2, 730, setNameFit.size, "#FFFFFF", { anchor: "middle" }),
    ...noteLines.map((line, i) =>
      safeOutline(fonts.regular, line, W / 2, 786 + i * 36, 28, "#C5CBD6", { anchor: "middle" }),
    ),
    textToPath(fonts.semibold, countText, W / 2, 880, 28, "#9CA3AF", { anchor: "middle" }),
    textToPath(fonts.bold, "PackPTS", 152, 978, 32, "#FFFFFF"),
    textToPath(fonts.semibold, MAKER_SHARE_FOOTER_URL, 1000, 978, 26, "#FFFFFF", { anchor: "end" }),
  ].join("\n  ");

  const desc = [
    MAKER_SHARE_EYEBROW,
    setNameFit.text,
    noteRaw,
    countText,
    "PackPTS",
    MAKER_SHARE_FOOTER_URL,
  ].filter(Boolean).join(" | ");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <desc>${escapeXml(desc)}</desc>
  <defs>
    <style type="text/css">${buildEmbeddedFontCss(fonts)}</style>
    <radialGradient id="makerGlow" cx="85%" cy="12%" r="55%">
      <stop offset="0%" stop-color="#1e3a5f" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#0b0f16" stop-opacity="0"/>
    </radialGradient>
    ${clipDefs}
  </defs>

  <rect width="${W}" height="${H}" fill="#0b0f16"/>
  <rect width="${W}" height="${H}" fill="url(#makerGlow)"/>

  ${fanSvg}

  ${outlined}

  <g transform="translate(80, 940)">
    ${MASKED_P_MARK}
  </g>
</svg>`;
}

export async function generateMakerShare(
  input: MakerShareInput,
  assetId: string,
): Promise<ScoreCardOutput> {
  const svg = await buildMakerShareSvg(input);
  const dir = getOutputDir(input.date);
  const filename = `${assetId}.png`;
  const imagePath = path.join(dir, filename);

  await sharp(Buffer.from(svg))
    .png({ quality: 90 })
    .toFile(imagePath);

  const imageUrl = `${SHARE_URL_PREFIX}/${safeDateDir(input.date)}/${filename}`;
  return { imagePath, imageUrl };
}
