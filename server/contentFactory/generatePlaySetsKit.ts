/**
 * Play-sets share kit (1080²) + optional runtime crop.
 * Contract: docs/PLAY_SETS_SHARE.md
 *
 * Kit templates are Marketing cold posts / placeholders.
 * Runtime compose uses a known set's name + masked/cream stack — never "I MADE THIS SET".
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";
import {
  PLAY_SETS_COPY,
  PLAY_SETS_KIT_DIR,
  PLAY_SETS_KIT_FILES,
  absolutePackptsUrl,
  canonicalPlaySetsPath,
  parsePlaySetsSurface,
  type PlaySetsSurface,
} from "@shared/playSetsShare";
import { buildEmbeddedFontCss, loadScoreCardFonts, measureText, textToPath, type ScoreCardFonts } from "./fonts";
import { getShareOutputBase, SHARE_URL_PREFIX } from "./generateScoreCard";
import { CREAM_SILHOUETTE, WHO_IS_THIS_PLAYER } from "./makerShareSlug";
import { MAKER_SHARE_ASSETS, makerShareGridSlots } from "./makerShareAssets";
import type { MakerCardSlot } from "./generateMakerShare";

export const PLAY_SETS_KIT_SIZE = 1080;
export const PLAY_SETS_OG_WIDTH = 1200;
export const PLAY_SETS_OG_HEIGHT = 630;

const MASKED_P_MARK = `<g transform="scale(0.0546875)">
      <rect width="1024" height="1024" fill="#0b0f16"/>
      <path fill="#ffffff" fill-rule="evenodd" d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z"/>
      <rect x="292" y="448" width="528" height="96" fill="#F5C518"/>
    </g>`;

export const FORBIDDEN_PLAY_SETS_KIT_COPY = [
  "/make",
  "snap-to-set",
  "i made this set",
  "maker rate",
  "packpoints",
  "times played",
  "maker-set-1080.png",
] as const;

export interface PlaySetsKitInput {
  surface: PlaySetsSurface;
  setName?: string | null;
  setId?: string | null;
  slugOrId?: string | null;
  cardSlots?: MakerCardSlot[];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fitText(
  font: ScoreCardFonts["bold"],
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
): { text: string; size: number } {
  const trimmed = text.trim() || PLAY_SETS_COPY.integrated_shelf.title;
  let size = startSize;
  while (size > minSize && measureText(font, trimmed, size) > maxWidth) {
    size -= 2;
  }
  return { text: trimmed, size };
}

function nameBandSvg(fonts: ScoreCardFonts, cardW: number, cardH: number, labelSize: number): string {
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
  return `<rect x="0" y="0" width="${cardW}" height="${cardH}" rx="12" fill="${CREAM_SILHOUETTE}"/>
      <ellipse cx="${cardW / 2}" cy="${Math.round(cardH * 0.32)}" rx="${portraitR}" ry="${Math.round(portraitR * 1.15)}" fill="${MAKER_SHARE_ASSETS.creamPortrait}"/>
      ${nameBandSvg(fonts, cardW, cardH, labelSize)}`;
}

async function cardToDataUri(buffer: Buffer, width: number, height: number): Promise<string> {
  const jpeg = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize(width, height, { fit: "cover", position: "top" })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export function playSetsFooterUrl(input: PlaySetsKitInput): string {
  const path = canonicalPlaySetsPath(input.slugOrId || input.setId);
  return `packpts.com${path}`;
}

export function playSetsHeadline(input: PlaySetsKitInput): string {
  const name = (input.setName || "").trim();
  if (name) return name;
  return PLAY_SETS_COPY[input.surface].title;
}

export function containsForbiddenPlaySetsKitCopy(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_PLAY_SETS_KIT_COPY.some((needle) => lower.includes(needle));
}

export async function buildPlaySetsShareSvg(input: PlaySetsKitInput): Promise<string> {
  const A = MAKER_SHARE_ASSETS;
  const W = PLAY_SETS_KIT_SIZE;
  const H = PLAY_SETS_KIT_SIZE;
  const fonts = loadScoreCardFonts();
  const copy = PLAY_SETS_COPY[input.surface];
  const headline = playSetsHeadline(input);
  const headlineFit = fitText(fonts.bold, headline, 920, 44, 26);
  const footerUrl = playSetsFooterUrl(input);
  const slots = (input.cardSlots && input.cardSlots.length > 0)
    ? input.cardSlots.slice(0, 8)
    : [null, null, null, null, null];
  const n = slots.length;
  const grid = makerShareGridSlots(n);
  const labelSize = n >= 7 ? 8 : n >= 5 ? 9 : 11;

  const clipDefs: string[] = [];
  const gridParts: string[] = [];
  for (let i = 0; i < n; i++) {
    const cell = grid[i];
    if (!cell) continue;
    clipDefs.push(`<clipPath id="playSetCard${i}"><rect x="0" y="0" width="${cell.w}" height="${cell.h}" rx="12"/></clipPath>`);
    let inner: string;
    if (slots[i]) {
      try {
        const uri = await cardToDataUri(slots[i] as Buffer, cell.w, cell.h);
        inner = `<rect x="0" y="0" width="${cell.w}" height="${cell.h}" rx="12" fill="#1a2230"/>
      <image href="${uri}" xlink:href="${uri}" width="${cell.w}" height="${cell.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#playSetCard${i})" />
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
    textToPath(fonts.bold, copy.eyebrow, W / 2, A.headerY, 24, A.textMuted, { anchor: "middle", letterSpacing: 6 }),
    textToPath(fonts.bold, headlineFit.text, W / 2, A.titleY, headlineFit.size, A.textPrimary, { anchor: "middle" }),
    textToPath(fonts.regular, copy.description, W / 2, A.noteY, 24, A.textNote, { anchor: "middle" }),
    textToPath(fonts.bold, "PackPTS", 152, A.footerY, 32, A.textPrimary),
    textToPath(fonts.semibold, footerUrl, 1000, A.footerY, 22, A.textPrimary, { anchor: "end" }),
  ].join("\n  ");

  const desc = [copy.eyebrow, headlineFit.text, copy.description, "PackPTS", footerUrl, WHO_IS_THIS_PLAYER]
    .filter(Boolean)
    .join(" | ");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <desc>${escapeXml(desc)}</desc>
  <defs>
    <style type="text/css">${buildEmbeddedFontCss(fonts)}</style>
    <radialGradient id="playSetsGlow" cx="85%" cy="12%" r="55%">
      <stop offset="0%" stop-color="${A.glow}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#0b0f16" stop-opacity="0"/>
    </radialGradient>
    ${clipDefs.join("\n    ")}
  </defs>

  <rect width="${W}" height="${H}" fill="${A.background}"/>
  <rect width="${W}" height="${H}" fill="url(#playSetsGlow)"/>

  ${gridParts.join("\n  ")}

  ${outlined}

  <g transform="translate(${A.markX}, ${A.markY})">
    ${MASKED_P_MARK}
  </g>
</svg>`;
}

export async function renderPlaySetsSharePng(input: PlaySetsKitInput): Promise<Buffer> {
  const svg = await buildPlaySetsShareSvg(input);
  if (containsForbiddenPlaySetsKitCopy(svg)) {
    throw new Error("Play-sets share must not include /make, Maker Rate, or PackPoints");
  }
  return sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
}

export async function letterboxPlaySetsOg(squarePng: Buffer): Promise<Buffer> {
  const side = PLAY_SETS_OG_HEIGHT;
  const fitted = await sharp(squarePng)
    .resize(side, side, { fit: "contain", background: "#0b0f16" })
    .png()
    .toBuffer();
  const left = Math.round((PLAY_SETS_OG_WIDTH - side) / 2);
  return sharp({
    create: {
      width: PLAY_SETS_OG_WIDTH,
      height: PLAY_SETS_OG_HEIGHT,
      channels: 4,
      background: { r: 11, g: 15, b: 22, alpha: 1 },
    },
  })
    .composite([{ input: fitted, left, top: 0 }])
    .png()
    .toBuffer();
}

export function playSetsKitPublicPath(surface: PlaySetsSurface): string {
  return `${PLAY_SETS_KIT_DIR}/${PLAY_SETS_KIT_FILES[surface]}`;
}

export function playSetsKitDiskCandidates(surface: PlaySetsSurface): string[] {
  const file = PLAY_SETS_KIT_FILES[surface];
  return [
    path.resolve(process.cwd(), "client/public/assets/play-sets", file),
    path.resolve(process.cwd(), "dist/public/assets/play-sets", file),
    path.resolve(process.cwd(), "public/assets/play-sets", file),
    path.join("/app/dist/public/assets/play-sets", file),
  ];
}

export function resolvePlaySetsKitFile(surface: PlaySetsSurface): string | null {
  for (const candidate of playSetsKitDiskCandidates(surface)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function writePlaySetsKitFiles(outDir: string): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  const surfaces: PlaySetsSurface[] = ["play_this_set", "integrated_shelf", "beat_me_from_set"];
  for (const surface of surfaces) {
    const png = await renderPlaySetsSharePng({ surface });
    const dest = path.join(outDir, PLAY_SETS_KIT_FILES[surface]);
    fs.writeFileSync(dest, png);
    written.push(dest);
  }
  return written;
}

export function playSetsRuntimeCacheUrl(setId: string): string {
  return `${SHARE_URL_PREFIX}/play-sets/${setId}.png`;
}

export async function writePlaySetsRuntimeCrop(
  setId: string,
  input: PlaySetsKitInput,
): Promise<{ imagePath: string; imageUrl: string }> {
  const dir = path.join(getShareOutputBase(), "play-sets");
  fs.mkdirSync(dir, { recursive: true });
  const imagePath = path.join(dir, `${setId}.png`);
  const png = await renderPlaySetsSharePng({
    ...input,
    surface: parsePlaySetsSurface(input.surface || "play_this_set"),
    setId,
    slugOrId: input.slugOrId || setId,
  });
  fs.writeFileSync(imagePath, png);
  return { imagePath, imageUrl: playSetsRuntimeCacheUrl(setId) };
}

export function absolutePlaySetsKitUrl(surface: PlaySetsSurface, origin?: string): string {
  return absolutePackptsUrl(playSetsKitPublicPath(surface), origin);
}
