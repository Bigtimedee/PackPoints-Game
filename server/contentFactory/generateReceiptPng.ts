/**
 * PackPTS receipt share PNG — 1080×1080, RECEIPT_CONTRACT + SOCIAL_PNG_QA.
 * Outlined DejaVu paths only. No <text>, no CDN Inter.
 */
import sharp from "sharp";
import {
  RECEIPT_COLORS,
  RECEIPT_COPY,
  containsBannedReceiptCopy,
  type ReceiptPlaqueView,
} from "@shared/receiptContract";
import { loadDejaVuFonts, measureText, textToPath, type DejaVuFonts } from "./fonts";

export const RECEIPT_PNG_SIZE = 1080;
export const RECEIPT_PNG_MIN_BYTES = 50_000;

const MASKED_P_MARK = `<g transform="scale(0.068359375)">
      <rect width="1024" height="1024" fill="${RECEIPT_COLORS.canvas}"/>
      <path fill="#ffffff" fill-rule="evenodd" d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z"/>
      <rect x="292" y="448" width="528" height="96" fill="${RECEIPT_COLORS.gold}"/>
    </g>`;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapLines(font: DejaVuFonts["bold"], text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measureText(font, next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(" ").length;
  if (consumed < text.length && lines.length) {
    const last = lines[lines.length - 1];
    let clipped = last;
    while (clipped.length > 1 && measureText(font, `${clipped}…`, size) > maxWidth) {
      clipped = clipped.slice(0, -1).trimEnd();
    }
    lines[lines.length - 1] = `${clipped}…`;
  }
  return lines.length ? lines : [text];
}

function chipSvg(fonts: DejaVuFonts, label: string, color: string, x: number, y: number): { svg: string; width: number } {
  const size = 18;
  const padX = 16;
  const width = Math.ceil(measureText(fonts.bold, label, size) + padX * 2);
  const height = 36;
  const svg = `
    <rect x="${x}" y="${y - 24}" width="${width}" height="${height}" rx="18" fill="none" stroke="${color}" stroke-width="2"/>
    ${textToPath(fonts.bold, label, x + width / 2, y, size, color, { anchor: "middle", letterSpacing: 0.6 })}
  `;
  return { svg, width };
}

export function receiptPngMetaLeft(
  plaque: Pick<ReceiptPlaqueView, "packptsSpentLabel" | "createdAtLabel" | "grantMethodLabel">,
): Array<[string, string]> {
  const metaLeft: Array<[string, string]> = [
    ["PackPTS spent", plaque.packptsSpentLabel],
  ];
  if (plaque.createdAtLabel) metaLeft.push(["Created", plaque.createdAtLabel]);
  if (plaque.grantMethodLabel) metaLeft.push(["Grant", plaque.grantMethodLabel]);
  return metaLeft;
}

export function buildReceiptPngSvg(plaque: ReceiptPlaqueView): string {
  const fonts = loadDejaVuFonts();
  const W = RECEIPT_PNG_SIZE;
  const H = RECEIPT_PNG_SIZE;
  const { canvas, ink, muted, gold, green, surface } = RECEIPT_COLORS;
  const heroColor = plaque.status === "CREDIT_GRANTED" ? green : ink;
  const helperColor = plaque.chip.label === "PURCHASE_CONFIRMED" ? gold : muted;

  const chip = chipSvg(fonts, plaque.chip.label, plaque.chip.color, 0, 0);
  const chipX = 980 - chip.width;
  const listingLines = wrapLines(fonts.bold, plaque.listingTitle, 28, 820, 2);

  const metaLeft = receiptPngMetaLeft(plaque);

  const metaRight: Array<[string, string]> = [
    ["Intent", plaque.intentId.replace(/-/g, "").slice(0, 8)],
  ];
  if (plaque.grantedAtLabel) metaRight.push(["Granted", plaque.grantedAtLabel]);
  if (plaque.evidenceLabel) metaRight.push(["Evidence", plaque.evidenceLabel]);

  const outlined = [
    textToPath(fonts.regular, plaque.walletHeader, 980, 118, 20, muted, { anchor: "end" }),
    textToPath(fonts.bold, RECEIPT_COPY.eyebrow, 100, 196, 18, muted, { letterSpacing: 3.2 }),
    chipSvg(fonts, plaque.chip.label, plaque.chip.color, chipX, 196).svg,
    textToPath(fonts.monoBold, plaque.heroAmount, 100, 320, 72, heroColor),
    ...(plaque.status === "CREDIT_GRANTED"
      ? [
          textToPath(fonts.regular, plaque.helper, 100, 368, 22, helperColor),
          textToPath(fonts.regular, plaque.subline, 100, 404, 22, muted),
        ]
      : [
          textToPath(fonts.regular, plaque.subline, 100, 368, 22, muted),
          textToPath(fonts.regular, plaque.helper, 100, 404, 22, helperColor),
        ]),
    textToPath(fonts.regular, "Partner", 100, 478, 20, muted),
    textToPath(fonts.bold, plaque.partner, 980, 478, 22, ink, { anchor: "end" }),
    textToPath(fonts.regular, RECEIPT_COPY.partnerPrice, 100, 522, 20, muted),
    textToPath(fonts.bold, plaque.partnerPrice, 980, 522, 22, ink, { anchor: "end" }),
    textToPath(fonts.regular, "Listing", 100, 586, 20, muted),
    ...listingLines.map((line, i) => textToPath(fonts.bold, line, 100, 626 + i * 36, 28, ink)),
    ...metaLeft.flatMap((row, i) => [
      textToPath(fonts.regular, row[0], 100, 760 + i * 64, 18, muted),
      textToPath(fonts.bold, row[1], 100, 788 + i * 64, 22, ink),
    ]),
    ...metaRight.flatMap((row, i) => [
      textToPath(fonts.regular, row[0], 560, 760 + i * 64, 18, muted),
      textToPath(i === 0 ? fonts.monoBold : fonts.bold, row[1], 560, 788 + i * 64, 22, ink),
    ]),
    textToPath(fonts.bold, "PackPTS", 176, 1012, 28, ink),
    textToPath(fonts.regular, `packpts.com/redemptions/${plaque.intentId.replace(/-/g, "").slice(0, 8)}`, 980, 1012, 18, muted, { anchor: "end" }),
  ].join("\n  ");

  const desc = [
    RECEIPT_COPY.eyebrow,
    plaque.chip.label,
    plaque.heroAmount,
    plaque.helper,
    plaque.subline,
    RECEIPT_COPY.partnerPrice,
    plaque.listingTitle,
    "PackPTS",
    plaque.footerCta,
  ].join(" | ");

  const banned = containsBannedReceiptCopy(desc);
  if (banned.length) {
    throw new Error(`[ReceiptPNG] Banned copy: ${banned.join(", ")}`);
  }

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <desc>${escapeXml(desc)}</desc>
  <defs>
    <radialGradient id="receiptGlow" cx="80%" cy="8%" r="60%">
      <stop offset="0%" stop-color="#1e3a5f" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${canvas}" stop-opacity="0"/>
    </radialGradient>
    <filter id="receiptGrain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${canvas}"/>
  <rect width="${W}" height="${H}" fill="url(#receiptGlow)"/>
  <rect width="${W}" height="${H}" filter="url(#receiptGrain)" opacity="0.045"/>
  <rect x="48" y="132" width="984" height="860" rx="28" fill="${surface}"/>
  <line x1="100" y1="220" x2="980" y2="220" stroke="${gold}" stroke-width="2"/>
  <line x1="100" y1="432" x2="980" y2="432" stroke="#2A3140" stroke-width="1"/>
  <line x1="100" y1="548" x2="980" y2="548" stroke="#2A3140" stroke-width="1"/>
  <line x1="100" y1="708" x2="980" y2="708" stroke="#2A3140" stroke-width="1"/>
  ${outlined}
  <g transform="translate(84, 952)">
    ${MASKED_P_MARK}
  </g>
</svg>`;
}

export async function renderReceiptPng(plaque: ReceiptPlaqueView): Promise<Buffer> {
  const svg = buildReceiptPngSvg(plaque);
  if (/<text[\s>]/.test(svg) || svg.includes("sans-serif")) {
    throw new Error("[ReceiptPNG] SVG must outline DejaVu — no <text> / sans-serif");
  }
  const png = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
  if (png.byteLength < RECEIPT_PNG_MIN_BYTES) {
    throw new Error(`[ReceiptPNG] PNG too small (${png.byteLength} bytes); SOCIAL_PNG_QA requires >50KB`);
  }
  return png;
}
