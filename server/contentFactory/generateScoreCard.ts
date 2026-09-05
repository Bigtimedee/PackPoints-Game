/**
 * generateScoreCard.ts
 *
 * Generates PNG share cards for PackPTS game results using sharp (SVG → PNG).
 *
 * Asset storage layout (production):
 *   /app/data/masked-cards/generated/share/{YYYY-MM-DD}/{assetId}.png
 *   (Railway persistent volume — the only path the non-root `packpts` user can write)
 *
 * Asset storage layout (local / CI, no volume mount):
 *   public/generated/share/{YYYY-MM-DD}/{assetId}.png
 *
 * Public URL served by Express (same prefix in every environment):
 *   /generated/share/{YYYY-MM-DD}/{assetId}.png
 *
 * Score card contract (docs/SCORE_CARD_CONTRACT.md): 1080 × 1080 px square.
 * Streak badges remain 1080 × 1920.
 * Compression: PNG quality 90.
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { buildEmbeddedFontCss, loadScoreCardFonts, measureText, textToPath } from "./fonts";

export const SHARE_URL_PREFIX = "/generated/share";

const VOLUME_ROOT = "/app/data/masked-cards";
const VOLUME_SHARE_DIR = path.join(VOLUME_ROOT, "generated", "share");
const LOCAL_SHARE_DIR = path.resolve("public/generated/share");

/**
 * Production writes to the persistent volume because the app process runs as
 * `packpts` and cannot mkdir under `/app/public` (EACCES). Local/CI keep the
 * original public/ path so existing tests and `express.static("public")` work.
 */
export function getShareOutputBase(): string {
  if (fs.existsSync(VOLUME_ROOT)) {
    return VOLUME_SHARE_DIR;
  }
  return LOCAL_SHARE_DIR;
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

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "...";
}

export interface ScoreCardInput {
  username: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  mode: string;
  streak?: number;
  rank?: number;
  date: string;
  setName?: string;
}

export interface ScoreCardOutput {
  imagePath: string;
  imageUrl: string;
}

export const SCORE_CARD_SIZE = 1080;

const NUMBER_WORDS = [
  "None", "One", "Two", "Three", "Four", "Five",
  "Six", "Seven", "Eight", "Nine", "Ten",
];

function numberWord(n: number): string {
  if (n >= 0 && n < NUMBER_WORDS.length) return NUMBER_WORDS[n];
  return String(n);
}

/** Session headline. Always uses the real correct/open counts — never a canned 4/5. */
export function buildScoreCardHeadline(correctCount: number, totalQuestions: number): string {
  const locked = Math.max(0, Math.min(correctCount, totalQuestions));
  const open = Math.max(0, totalQuestions - locked);
  if (totalQuestions <= 0) return "No cards played.";
  if (locked === totalQuestions) return `${numberWord(locked)} locked.`;
  return `${numberWord(locked)} locked. ${numberWord(open)} open.`;
}

function asCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function buildPipsSvg(correctCount: number, totalQuestions: number): string {
  const count = Math.max(1, Math.min(totalQuestions > 0 ? totalQuestions : 5, 12));
  const filled = Math.max(0, Math.min(correctCount, count));
  const size = 56;
  const gap = 14;
  const startX = 80;
  const y = 560;
  return Array.from({ length: count }, (_, i) => {
    const x = startX + i * (size + gap);
    if (i < filled) {
      return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="12" fill="#22C55E"/>`;
    }
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="12" fill="none" stroke="#3F4654" stroke-width="3"/>`;
  }).join("");
}

export function buildScoreCardSvg(input: ScoreCardInput): string {
  const W = SCORE_CARD_SIZE;
  const H = SCORE_CARD_SIZE;
  const correct = asCount(input.correctCount);
  const total = asCount(input.totalQuestions);
  const score = asCount(input.score);
  const headline = buildScoreCardHeadline(correct, total);
  const isDaily5 = input.mode === "daily5" || total === 5;
  const eyebrow = isDaily5 ? "DAILY 5" : input.mode === "1v1" ? "1V1 MATCH" : "SOLO";
  const pointsLabel = `${score} pts`;
  const fonts = loadScoreCardFonts();

  const scoreNum = String(correct);
  const scoreDen = `/${total}`;
  const scoreSize = 200;
  const numWidth = measureText(fonts.bold, scoreNum, scoreSize);

  const outlined = [
    textToPath(fonts.bold, eyebrow, 80, 120, 28, "#9CA3AF", { letterSpacing: 6 }),
    textToPath(fonts.bold, scoreNum, 80, 380, scoreSize, "#FFFFFF"),
    textToPath(fonts.bold, scoreDen, 80 + numWidth, 380, scoreSize, "#6B7280"),
    textToPath(fonts.semibold, pointsLabel, 80, 460, 36, "#9CA3AF"),
    textToPath(fonts.bold, headline, 80, 700, 48, "#FFFFFF"),
    textToPath(fonts.bold, "PackPTS", 152, 978, 32, "#FFFFFF"),
    textToPath(fonts.semibold, "packpts.com/daily", 1000, 978, 26, "#FFFFFF", { anchor: "end" }),
  ].join("\n  ");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <desc>${escapeXml(`${eyebrow} | ${scoreNum}${scoreDen} | ${pointsLabel} | ${headline} | PackPTS | packpts.com/daily`)}</desc>
  <defs>
    <style type="text/css">${buildEmbeddedFontCss(fonts)}</style>
    <radialGradient id="glow" cx="85%" cy="12%" r="55%">
      <stop offset="0%" stop-color="#1e3a5f" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#0b0f16" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#0b0f16"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  ${outlined}

  ${buildPipsSvg(correct, total)}

  <g transform="translate(80, 940)">
    <g transform="scale(0.0546875)">
      <!-- Locked masked-P mark: white P + gold bar on dark (not yellow-P-on-white) -->
      <rect width="1024" height="1024" fill="#0b0f16"/>
      <path fill="#ffffff" fill-rule="evenodd" d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z"/>
      <rect x="292" y="448" width="528" height="96" fill="#F5C518"/>
    </g>
  </g>
</svg>`;
}

function buildStreakBadgeSvg(username: string, streak: number, date: string): string {
  const W = 1080;
  const H = 1920;
  const un = truncate(username || "Player", 20);
  const milestoneColors: Record<number, string> = {
    3: "#00FF88", 7: "#FFD700", 14: "#FF6B35", 30: "#FF4444",
  };
  const color = milestoneColors[streak] || "#FFD700";
  const milestoneLabel = streak >= 30 ? "LEGENDARY" : streak >= 14 ? "ON FIRE" : streak >= 7 ? "HOT STREAK" : "WARMING UP";
  const fonts = loadScoreCardFonts();
  const mid = { anchor: "middle" as const };

  const outlined = [
    textToPath(fonts.bold, "STREAK MILESTONE", W / 2, 300, 42, "#888899", { ...mid, letterSpacing: 8 }),
    textToPath(fonts.regular, date, W / 2, 380, 32, "#666688", mid),
    textToPath(fonts.bold, String(streak), W / 2, 700, 300, color, mid),
    textToPath(fonts.bold, "DAY STREAK", W / 2, 800, 56, color, mid),
    textToPath(fonts.bold, milestoneLabel, W / 2, 950, 64, "#FFFFFF", mid),
    textToPath(fonts.bold, `@${un}`, W / 2, 1100, 48, "#AAAACC", mid),
    textToPath(fonts.bold, "PACKPTS", W / 2, 1720, 56, color, mid),
    textToPath(fonts.regular, "packpts.com - The Baseball Card Challenge", W / 2, 1850, 22, "#444466", mid),
  ].join("\n  ");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style type="text/css">${buildEmbeddedFontCss(fonts)}</style>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0A0A2E"/>
      <stop offset="50%" stop-color="#2A1A0E"/>
      <stop offset="100%" stop-color="#0A0A2E"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="40" fill="none" stroke="${color}" stroke-width="4" opacity="0.5"/>

  ${outlined}

  <rect x="140" y="1500" width="800" height="100" rx="50" fill="${color}"/>
  ${textToPath(fonts.bold, "Play at PackPTS.com", W / 2, 1565, 40, "#FFFFFF", mid)}
</svg>`;
}

function getOutputDir(date: string): string {
  const dir = path.join(getShareOutputBase(), safeDateDir(date));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function generateScoreCard(
  input: ScoreCardInput,
  assetId: string,
): Promise<ScoreCardOutput> {
  const svg = buildScoreCardSvg(input);
  const dir = getOutputDir(input.date);
  const filename = `${assetId}.png`;
  const imagePath = path.join(dir, filename);

  await sharp(Buffer.from(svg))
    .png({ quality: 90 })
    .toFile(imagePath);

  const imageUrl = `${SHARE_URL_PREFIX}/${safeDateDir(input.date)}/${filename}`;
  return { imagePath, imageUrl };
}

export async function generateStreakBadge(
  username: string,
  streak: number,
  date: string,
  assetId: string,
): Promise<ScoreCardOutput> {
  const svg = buildStreakBadgeSvg(username, streak, date);
  const dir = getOutputDir(date);
  const filename = `${assetId}.png`;
  const imagePath = path.join(dir, filename);

  await sharp(Buffer.from(svg))
    .png({ quality: 90 })
    .toFile(imagePath);

  const imageUrl = `${SHARE_URL_PREFIX}/${safeDateDir(date)}/${filename}`;
  return { imagePath, imageUrl };
}
