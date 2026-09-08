/**
 * generateMakerShare.ts
 *
 * Runtime 1080² "I MADE THIS SET" PNG after a successful /make publish.
 * Contract: docs/MAKER_SHARE_CONTRACT.md
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { DEFAULT_MASK_REGIONS, type MaskRegion } from "@shared/schema";
import { buildEmbeddedFontCss, loadScoreCardFonts, measureText, textToPath, type ScoreCardFonts } from "./fonts";
import { getShareOutputBase, SHARE_URL_PREFIX, type ScoreCardOutput } from "./generateScoreCard";
import {
  CREAM_SILHOUETTE,
  MAKER_SHARE_MAX_STACK,
  STOCK_FAN_ASSET,
  WHO_IS_THIS_PLAYER,
  makerShareFooterUrl,
  setsMadeLabel,
} from "./makerShareSlug";
import {
  MAKER_SHARE_ASSETS,
  isMakerShareRasterFormat,
  makerShareGridSlots,
} from "./makerShareAssets";

export const MAKER_SHARE_SIZE = MAKER_SHARE_ASSETS.canvas;
export const MAKER_SHARE_EYEBROW = MAKER_SHARE_ASSETS.eyebrow;
export { STOCK_FAN_ASSET, CREAM_SILHOUETTE, WHO_IS_THIS_PLAYER, makerShareFooterUrl };

const MASKED_P_MARK = `<g transform="scale(0.0546875)">
      <rect width="1024" height="1024" fill="#0b0f16"/>
      <path fill="#ffffff" fill-rule="evenodd" d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z"/>
      <rect x="292" y="448" width="528" height="96" fill="#F5C518"/>
    </g>`;

export const FORBIDDEN_MAKER_SHARE_COPY = [
  "maker rate",
  "dau",
  "wau",
  "mau",
  "stock fan",
  "vector fan",
  "10k makers",
  "thousand makers",
  STOCK_FAN_ASSET,
];

/** null = cream Daily-5 silhouette for that published card (mask/photo failed). */
export type MakerCardSlot = Buffer | null;

export interface MakerShareInput {
  setName: string;
  makerNote?: string | null;
  cardCount: number;
  date: string;
  setId: string;
  /** Personal Sets Made, only when the ≥10 non-staff gate is unlocked. */
  setsMade?: number | null;
  cardSlots: MakerCardSlot[];
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
    if (needle.includes(" ") || needle.includes(".")) return lower.includes(needle);
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
 * Same floor as Daily 5 / GameCard (DEFAULT_MASK_REGIONS).
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

    const dark = await sharp({
      create: {
        width: rw,
        height: rh,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    }).png().toBuffer();
    overlays.push({ input: dark, left, top });
  }

  return sharp(normalized).composite(overlays).jpeg({ quality: 82 }).toBuffer();
}

/** JPEG/WebP/PNG from /make identify (HEIC already normalized client-side). Card-aspect or square crop. */
export async function cropMakerCardThumb(input: Buffer, width: number, height: number): Promise<Buffer> {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const format = (meta.format || "").toLowerCase();
  if (format && !isMakerShareRasterFormat(format)) {
    throw new Error(`Maker share thumb rejects ${format}; expected jpeg/webp/png`);
  }
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize(width, height, { fit: "cover", position: "top" })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function cardToDataUri(buffer: Buffer, width: number, height: number): Promise<string> {
  const jpeg = await cropMakerCardThumb(buffer, width, height);
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

function nameBandSvg(
  fonts: ScoreCardFonts,
  cardW: number,
  cardH: number,
  labelSize: number,
): string {
  const bandPct = MAKER_SHARE_ASSETS.redactionBandPct / 100;
  const bandY = Math.round(cardH * (1 - bandPct));
  const bandH = cardH - bandY;
  const labelY = bandY + Math.round(bandH * 0.58);
  const fitted = fitText(fonts.bold, WHO_IS_THIS_PLAYER, cardW - 12, labelSize, 6);
  return `<rect x="0" y="${bandY}" width="${cardW}" height="${bandH}" fill="${MAKER_SHARE_ASSETS.redactionBar}"/>
      ${textToPath(fonts.bold, fitted.text, cardW / 2, labelY, fitted.size, "#F1F5F9", { anchor: "middle" })}`;
}

function creamCardSvg(fonts: ScoreCardFonts, cardW: number, cardH: number, labelSize: number): string {
  const portraitR = Math.round(cardW * 0.22);
  return `<rect x="0" y="0" width="${cardW}" height="${cardH}" rx="12" fill="${MAKER_SHARE_ASSETS.cream}"/>
      <ellipse cx="${cardW / 2}" cy="${Math.round(cardH * 0.32)}" rx="${portraitR}" ry="${Math.round(portraitR * 1.15)}" fill="${MAKER_SHARE_ASSETS.creamPortrait}"/>
      ${nameBandSvg(fonts, cardW, cardH, labelSize)}`;
}

export async function buildMakerShareSvg(input: MakerShareInput): Promise<string> {
  const A = MAKER_SHARE_ASSETS;
  const W = A.canvas;
  const H = A.canvas;
  const fonts = loadScoreCardFonts();
  const setNameFit = fitText(fonts.bold, input.setName || "Untitled set", 920, 44, 26);
  const noteRaw = (input.makerNote || "").trim();
  const noteLines = noteRaw
    ? wrapLines(fonts.regular, `"${noteRaw}"`, 26, 920, 2)
    : [];
  const countText = cardCountLabel(input.cardCount);
  const footerUrl = makerShareFooterUrl(input.setName, input.setId);
  const made = typeof input.setsMade === "number" && input.setsMade > 0
    ? setsMadeLabel(input.setsMade)
    : "";
  const slots = input.cardSlots.slice(0, MAKER_SHARE_MAX_STACK);
  const n = slots.length;
  const grid = makerShareGridSlots(n);
  const labelSize = n >= 7 ? 8 : n >= 5 ? 9 : 11;

  const clipDefs: string[] = [];
  const gridParts: string[] = [];
  for (let i = 0; i < n; i++) {
    const cell = grid[i];
    if (!cell) continue;
    clipDefs.push(`<clipPath id="makerCard${i}"><rect x="0" y="0" width="${cell.w}" height="${cell.h}" rx="12"/></clipPath>`);
    let inner: string;
    if (slots[i]) {
      try {
        const uri = await cardToDataUri(slots[i] as Buffer, cell.w, cell.h);
        inner = `<rect x="0" y="0" width="${cell.w}" height="${cell.h}" rx="12" fill="#1a2230"/>
      <image href="${uri}" xlink:href="${uri}" width="${cell.w}" height="${cell.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#makerCard${i})" />
      ${nameBandSvg(fonts, cell.w, cell.h, labelSize)}`;
      } catch {
        inner = creamCardSvg(fonts, cell.w, cell.h, labelSize);
      }
    } else {
      inner = creamCardSvg(fonts, cell.w, cell.h, labelSize);
    }
    gridParts.push(`<g transform="translate(${cell.x},${cell.y})">${inner}</g>`);
  }

  const outlined = [
    textToPath(fonts.bold, MAKER_SHARE_EYEBROW, W / 2, A.headerY, 24, A.textMuted, { anchor: "middle", letterSpacing: 6 }),
    safeOutline(fonts.bold, setNameFit.text, W / 2, A.titleY, setNameFit.size, A.textPrimary, { anchor: "middle" }),
    ...noteLines.map((line, i) =>
      safeOutline(fonts.regular, line, W / 2, A.noteY + i * 32, 24, A.textNote, { anchor: "middle" }),
    ),
    textToPath(fonts.semibold, countText, W / 2, A.gridBottom + 28, 24, A.textMuted, { anchor: "middle" }),
    ...(made ? [textToPath(fonts.semibold, made, W / 2, A.gridBottom + 58, 20, A.textMuted, { anchor: "middle" })] : []),
    textToPath(fonts.bold, "PackPTS", 152, A.footerY, 32, A.textPrimary),
    textToPath(fonts.semibold, footerUrl, 1000, A.footerY, 22, A.textPrimary, { anchor: "end" }),
  ].join("\n  ");

  const desc = [
    MAKER_SHARE_EYEBROW,
    setNameFit.text,
    noteRaw,
    countText,
    made,
    "PackPTS",
    footerUrl,
    WHO_IS_THIS_PLAYER,
  ].filter(Boolean).join(" | ");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <desc>${escapeXml(desc)}</desc>
  <defs>
    <style type="text/css">${buildEmbeddedFontCss(fonts)}</style>
    <radialGradient id="makerGlow" cx="85%" cy="12%" r="55%">
      <stop offset="0%" stop-color="${A.glow}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#0b0f16" stop-opacity="0"/>
    </radialGradient>
    ${clipDefs.join("\n    ")}
  </defs>

  <rect width="${W}" height="${H}" fill="${A.background}"/>
  <rect width="${W}" height="${H}" fill="url(#makerGlow)"/>

  ${gridParts.join("\n  ")}

  ${outlined}

  <g transform="translate(${A.markX}, ${A.markY})">
    ${MASKED_P_MARK}
  </g>
</svg>`;
}

export async function generateMakerShare(
  input: MakerShareInput,
  assetId: string,
): Promise<ScoreCardOutput> {
  const svg = await buildMakerShareSvg(input);
  if (svg.toLowerCase().includes(STOCK_FAN_ASSET)) {
    throw new Error("Maker share must never reference maker-set-1080.png");
  }
  const dir = getOutputDir(input.date);
  const filename = `${assetId}.png`;
  const imagePath = path.join(dir, filename);

  await sharp(Buffer.from(svg))
    .png({ quality: 90 })
    .toFile(imagePath);

  const imageUrl = `${SHARE_URL_PREFIX}/${safeDateDir(input.date)}/${filename}`;
  return { imagePath, imageUrl };
}
