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
import { getPackptsDayKey, isPackptsDayKey, PACKPTS_DAY_TZ } from "@shared/packptsDay";
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
  return isPackptsDayKey(date) ? date : getPackptsDayKey();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

/** Design Sync palette — Beat-me / Daily 5 1080 card (SCORE_CARD_CONTRACT). */
export const SCORE_CARD_COLORS = {
  canvas: "#0b0f16",
  gold: "#F5C518",
  green: "#22C55E",
  ink: "#F0F2F5",
  muted: "#8F96A3",
} as const;

/** Same CT day key as Daily 5 / streak / Beat-me (`shared/packptsDay.ts`). */
export const SCORE_CARD_TZ = PACKPTS_DAY_TZ;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

export const PIP_SIZE = 56;
export const PIP_GAP = 14;
export const PIP_Y = 560;

const STRIP_TILE = 24;
const STRIP_GAP = 6;
const STRIP_COUNT = 5;
const STRIP_X = 80;
const STRIP_Y = 142;

export function pipStartX(count: number): number {
  const n = Math.max(1, count);
  const totalW = n * PIP_SIZE + Math.max(0, n - 1) * PIP_GAP;
  return Math.round((SCORE_CARD_SIZE - totalW) / 2);
}

/** Calendar-date formatter. PackPTS day keys (YYYY-MM-DD CT) never UTC-shift. */
export function formatSessionDay(date: string): string {
  if (isPackptsDayKey(date)) {
    const month = Number(date.slice(5, 7));
    const day = Number(date.slice(8, 10));
    return `${MONTHS[month - 1]} ${day}`;
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: SCORE_CARD_TZ,
  }).formatToParts(parsed);
  const mon = (parts.find((p) => p.type === "month")?.value || "").toUpperCase();
  const day = parts.find((p) => p.type === "day")?.value || "";
  return `${mon} ${day}`.trim();
}

/** §3b quiet today identity. Daily 5: `SEP 8 · TODAY'S FIVE`. Other modes: date only. */
export function formatSessionDayIdentity(date: string, isDaily5: boolean): string {
  const day = formatSessionDay(date);
  if (isDaily5) return day ? `${day} · TODAY'S FIVE` : "TODAY'S FIVE";
  return day;
}

/** Mini masked-strip: five cream tiles + gold redaction (Design v2 strip language). */
export function buildMaskedStripSvg(x = STRIP_X, y = STRIP_Y): string {
  const barH = 5;
  const barY = y + Math.round((STRIP_TILE - barH) / 2);
  return Array.from({ length: STRIP_COUNT }, (_, i) => {
    const tx = x + i * (STRIP_TILE + STRIP_GAP);
    return [
      `<rect x="${tx}" y="${y}" width="${STRIP_TILE}" height="${STRIP_TILE}" rx="4" fill="${SCORE_CARD_COLORS.ink}"/>`,
      `<rect x="${tx}" y="${barY}" width="${STRIP_TILE}" height="${barH}" fill="${SCORE_CARD_COLORS.gold}"/>`,
    ].join("");
  }).join("");
}

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

/** Real streak only. Omit when missing or zero — never invent a kit streak. */
export function buildStreakOverlayLabel(streak: unknown): string | undefined {
  const n = asCount(streak);
  if (n < 1) return undefined;
  return n === 1 ? "1-day streak" : `${n}-day streak`;
}

export function buildPipsSvg(correctCount: number, totalQuestions: number): string {
  const count = Math.max(1, Math.min(totalQuestions > 0 ? totalQuestions : 5, 12));
  const filled = Math.max(0, Math.min(correctCount, count));
  const startX = pipStartX(count);
  return Array.from({ length: count }, (_, i) => {
    const x = startX + i * (PIP_SIZE + PIP_GAP);
    if (i < filled) {
      return `<rect x="${x}" y="${PIP_Y}" width="${PIP_SIZE}" height="${PIP_SIZE}" rx="12" fill="${SCORE_CARD_COLORS.green}"/>`;
    }
    return `<rect x="${x}" y="${PIP_Y}" width="${PIP_SIZE}" height="${PIP_SIZE}" rx="12" fill="none" stroke="#3F4654" stroke-width="3"/>`;
  }).join("");
}

export function buildScoreCardSvg(input: ScoreCardInput): string {
  const W = SCORE_CARD_SIZE;
  const H = SCORE_CARD_SIZE;
  const cx = W / 2;
  const correct = asCount(input.correctCount);
  const total = asCount(input.totalQuestions);
  const score = asCount(input.score);
  const headline = buildScoreCardHeadline(correct, total);
  const streakLabel = buildStreakOverlayLabel(input.streak);
  const isDaily5Mode = input.mode === "daily5";
  const treatAsDaily5 = isDaily5Mode || total === 5;
  const eyebrow = treatAsDaily5 ? "DAILY 5" : input.mode === "1v1" ? "1V1 MATCH" : "SOLO";
  const pointsLabel = `${score} pts`;
  const identity = formatSessionDayIdentity(input.date, isDaily5Mode);
  const fonts = loadScoreCardFonts();
  const { ink, muted, gold, canvas } = SCORE_CARD_COLORS;

  const scoreNum = String(correct);
  const scoreDen = `/${total}`;
  const scoreSize = 200;
  const numWidth = measureText(fonts.bold, scoreNum, scoreSize);
  const denWidth = measureText(fonts.bold, scoreDen, scoreSize);
  const scoreX = cx - (numWidth + denWidth) / 2;

  const outlined = [
    textToPath(fonts.bold, eyebrow, 80, 108, 22, muted, { letterSpacing: 4 }),
    identity
      ? textToPath(fonts.bold, identity, 1000, 108, 22, muted, { anchor: "end", letterSpacing: 2 })
      : "",
    textToPath(fonts.bold, scoreNum, scoreX, 400, scoreSize, ink),
    textToPath(fonts.bold, scoreDen, scoreX + numWidth, 400, scoreSize, muted),
    textToPath(fonts.semibold, pointsLabel, cx, 470, 32, muted, { anchor: "middle" }),
    streakLabel
      ? textToPath(fonts.semibold, streakLabel, cx, 518, 28, muted, { anchor: "middle" })
      : "",
    textToPath(fonts.bold, headline, cx, 700, 48, ink, { anchor: "middle" }),
    textToPath(fonts.bold, "PackPTS", 152, 978, 32, ink),
    textToPath(fonts.semibold, "packpts.com/daily", 1000, 978, 26, ink, { anchor: "end" }),
  ].filter(Boolean).join("\n  ");

  const strip = treatAsDaily5 ? buildMaskedStripSvg() : "";
  const desc = [
    eyebrow,
    identity,
    `${scoreNum}${scoreDen}`,
    pointsLabel,
    streakLabel,
    headline,
    "PackPTS",
    "packpts.com/daily",
  ].filter(Boolean).join(" | ");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <desc>${escapeXml(desc)}</desc>
  <defs>
    <style type="text/css">${buildEmbeddedFontCss(fonts)}</style>
    <radialGradient id="glow" cx="85%" cy="12%" r="55%">
      <stop offset="0%" stop-color="#1e3a5f" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${canvas}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="${canvas}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  ${outlined}

  ${strip}

  ${buildPipsSvg(correct, total)}

  <g transform="translate(80, 940)">
    <g transform="scale(0.0546875)">
      <!-- Locked masked-P mark: white P + gold bar on dark (not yellow-P-on-white) -->
      <rect width="1024" height="1024" fill="${canvas}"/>
      <path fill="#ffffff" fill-rule="evenodd" d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z"/>
      <rect x="292" y="448" width="528" height="96" fill="${gold}"/>
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
