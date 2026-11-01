/**
 * 1200x630 link-preview PNGs. Text is outlined Inter so the image does not
 * depend on system fonts. A set image paints that set's already-masked cover
 * (the bake from its approved mask profile) with fit contain, so the name
 * band is not cropped off. Static images use a cleared set's masked cover
 * and copy with no digits and no percentages.
 */
import sharp from "sharp";
import { loadScoreCardFonts, measureText, textToPath } from "./fonts";
import { SHARE_OG_HEIGHT, SHARE_OG_WIDTH, staticShareCopyForbidden } from "@shared/sharePreview";

const BG = "#0b0f16";
const GOLD = "#F5C518";
const WHITE = "#FFFFFF";
const MUTED = "#C5CBD6";

export interface SharePreviewInput {
  kind: "set" | "static";
  eyebrow: string;
  title: string;
  line: string;
  footer: string;
  cardJpeg?: Buffer | null;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fitSize(text: string, maxWidth: number, start: number, min: number): number {
  const fonts = loadScoreCardFonts();
  let size = start;
  while (size > min && measureText(fonts.bold, text, size) > maxWidth) size -= 2;
  return size;
}

export function assertSharePreviewCopy(input: SharePreviewInput): void {
  const blob = [input.eyebrow, input.title, input.line, input.footer].join("\n");
  if (/[\u2013\u2014]/.test(blob)) throw new Error("share_preview_dash");
  if (input.kind === "static" && staticShareCopyForbidden(blob)) throw new Error("share_preview_static_copy");
}

export async function renderSharePreviewPng(input: SharePreviewInput): Promise<Buffer> {
  assertSharePreviewCopy(input);
  const fonts = loadScoreCardFonts();
  const W = SHARE_OG_WIDTH;
  const H = SHARE_OG_HEIGHT;
  const titleSize = fitSize(input.title, 640, 54, 28);
  const lineSize = fitSize(input.line, 640, 28, 18);
  const text = [
    textToPath(fonts.bold, input.eyebrow, 72, 150, 22, GOLD, { letterSpacing: 3 }),
    textToPath(fonts.bold, input.title, 72, 230, titleSize, WHITE),
    textToPath(fonts.regular, input.line, 72, 290, lineSize, MUTED),
    textToPath(fonts.bold, "PackPTS", 72, 540, 28, WHITE),
    textToPath(fonts.regular, input.footer, 72, 578, 18, MUTED),
  ].join("\n");

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <desc>${escapeXml([input.eyebrow, input.title, input.line, input.footer].join(" | "))}</desc>
  <defs>
    <radialGradient id="g" cx="88%" cy="18%" r="55%">
      <stop offset="0%" stop-color="#1e3a5f" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="${BG}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect x="748" y="36" width="388" height="558" rx="18" fill="#111827" stroke="${GOLD}" stroke-width="3"/>
  ${text}
</svg>`;

  const base = sharp(Buffer.from(svg)).png();
  if (!input.cardJpeg || input.cardJpeg.length < 32) {
    const empty = await base.toBuffer();
    return empty;
  }
  const card = await sharp(input.cardJpeg, { failOn: "none" })
    .rotate()
    .resize(360, 530, { fit: "contain", background: { r: 17, g: 24, b: 39, alpha: 1 } })
    .png()
    .toBuffer();
  return base.composite([{ input: card, left: 762, top: 50 }]).png().toBuffer();
}

export function setYearLabel(setName: string, year: number): string {
  const match = /^(?:\d{4}(?:-\d{2})?)/.exec(setName.trim());
  return match ? match[0] : String(year);
}
