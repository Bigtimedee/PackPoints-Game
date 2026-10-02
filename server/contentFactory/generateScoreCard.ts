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
import { scoreCardStackForCount } from "@shared/scoreCardStack";
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
  /** Answered / scored count (Dave's 6/9). Not the dealt total when skips exist. */
  totalQuestions: number;
  /** Dealt cards that were skipped. Do not fold this into totalQuestions. */
  skippedQuestions?: number;
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
/** Pip row for a 5-card block. Other counts use `scoreCardStackForCount`. */
export const PIP_Y = scoreCardStackForCount(5).pipY;

const STRIP_TILE_W = 30;
const STRIP_TILE_H = 42;
const STRIP_GAP = 8;
const STRIP_COUNT = 5;
const STRIP_X = 80;
const STRIP_Y = 136;

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

/** Five mini masked cards. Cream body, navy plaque, gold seam and bar. No live text. */
export function buildMaskedStripSvg(x = STRIP_X, y = STRIP_Y): string {
  return Array.from({ length: STRIP_COUNT }, (_, i) => {
    const tx = x + i * (STRIP_TILE_W + STRIP_GAP);
    return [
      `<rect x="${tx}" y="${y}" width="${STRIP_TILE_W}" height="${STRIP_TILE_H}" rx="4" fill="#F0F2F5" stroke="#D6CBB6" stroke-width="1"/>`,
      `<rect x="${tx + 1}" y="${y + 24}" width="28" height="16" fill="#0A0E16"/>`,
      `<rect x="${tx + 1}" y="${y + 24}" width="28" height="1.5" fill="#977C17"/>`,
      `<rect x="${tx + 9}" y="${y + 31}" width="12" height="2" fill="#F5C518"/>`,
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

export function skippedQuestionCount(skipped: unknown): number {
  return asCount(skipped);
}

/** Dealt cards = scored answers + skips. Used for pip count so 10−1 is not a silent 9. */
export function dealtQuestionCount(scoredTotal: number, skipped: unknown): number {
  return Math.max(0, asCount(scoredTotal) + skippedQuestionCount(skipped));
}

export function buildSkipOverlayLabel(skipped: unknown): string | undefined {
  const n = skippedQuestionCount(skipped);
  if (n < 1) return undefined;
  return n === 1 ? "1 skipped" : `${n} skipped`;
}

/** Muted status under pts: streak and/or skip. Matches Game Complete “1 card skipped”. */
export function buildScoreCardStatusLine(streak: unknown, skipped: unknown): string | undefined {
  const parts = [buildStreakOverlayLabel(streak), buildSkipOverlayLabel(skipped)].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** Session headline. Always uses the real correct/open counts — never a canned 4/5. Skip is the status line + skip pip. */
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

function skippedPipSvg(x: number, y: number): string {
  const barH = 6;
  const barY = y + Math.round((PIP_SIZE - barH) / 2);
  const inset = 8;
  return [
    `<rect x="${x}" y="${y}" width="${PIP_SIZE}" height="${PIP_SIZE}" rx="12" fill="none" stroke="${SCORE_CARD_COLORS.muted}" stroke-width="3"/>`,
    `<rect x="${x + inset}" y="${barY}" width="${PIP_SIZE - inset * 2}" height="${barH}" rx="2" fill="${SCORE_CARD_COLORS.gold}"/>`,
  ].join("");
}

/**
 * Pips are the dealt story. `totalQuestions` is scored (6/9); `skippedQuestions`
 * adds skip pips so a 10-card solo with 1 skip is not a clean 9-pip row.
 */
export function buildPipsSvg(
  correctCount: number,
  totalQuestions: number,
  skippedQuestions = 0,
): string {
  const scored = Math.max(0, totalQuestions);
  const skipped = skippedQuestionCount(skippedQuestions);
  const dealt = dealtQuestionCount(scored, skipped);
  const count = Math.max(1, Math.min(dealt > 0 ? dealt : 5, 12));
  const filled = Math.max(0, Math.min(correctCount, count));
  const skipPips = Math.max(0, Math.min(skipped, count - filled));
  const startX = pipStartX(count);
  const pipY = scoreCardStackForCount(Math.max(1, scored)).pipY;
  return Array.from({ length: count }, (_, i) => {
    const x = startX + i * (PIP_SIZE + PIP_GAP);
    if (i < filled) {
      return `<rect x="${x}" y="${pipY}" width="${PIP_SIZE}" height="${PIP_SIZE}" rx="12" fill="${SCORE_CARD_COLORS.green}"/>`;
    }
    if (i < filled + skipPips) {
      return skippedPipSvg(x, pipY);
    }
    return `<rect x="${x}" y="${pipY}" width="${PIP_SIZE}" height="${PIP_SIZE}" rx="12" fill="none" stroke="#3F4654" stroke-width="3"/>`;
  }).join("");
}

export function isDaily5ScoreCardMode(mode: string | undefined): boolean {
  return mode === "daily5";
}

export function scoreCardEyebrow(mode: string | undefined): string {
  if (mode === "daily5") return "DAILY 5";
  if (mode === "1v1") return "1V1 MATCH";
  return "SOLO";
}

/** Footer CTA. Only Daily 5 prints packpts.com/daily — solo/1v1 stay packpts.com. */
export function scoreCardFooterCta(mode: string | undefined): string {
  return mode === "daily5" ? "packpts.com/daily" : "packpts.com";
}

export function buildScoreCardSvg(input: ScoreCardInput): string {
  const W = SCORE_CARD_SIZE;
  const H = SCORE_CARD_SIZE;
  const cx = W / 2;
  const correct = asCount(input.correctCount);
  const total = asCount(input.totalQuestions);
  const skipped = skippedQuestionCount(input.skippedQuestions);
  const dealt = dealtQuestionCount(total, skipped);
  const score = asCount(input.score);
  const headline = buildScoreCardHeadline(correct, total);
  const statusLine = buildScoreCardStatusLine(input.streak, skipped);
  const isDaily5Mode = isDaily5ScoreCardMode(input.mode);
  const eyebrow = scoreCardEyebrow(input.mode);
  const footerCta = scoreCardFooterCta(input.mode);
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
  const frame = scoreCardStackForCount(Math.max(1, total));

  const outlined = [
    textToPath(fonts.bold, eyebrow, 80, 108, 22, muted, { letterSpacing: 4 }),
    identity
      ? textToPath(fonts.bold, identity, 1000, 108, 22, muted, { anchor: "end", letterSpacing: 2 })
      : "",
    textToPath(fonts.bold, scoreNum, scoreX, frame.scoreBaseline, scoreSize, ink),
    textToPath(fonts.bold, scoreDen, scoreX + numWidth, frame.scoreBaseline, scoreSize, muted),
    textToPath(fonts.semibold, pointsLabel, cx, frame.ptsBaseline, 32, muted, { anchor: "middle" }),
    statusLine
      ? textToPath(fonts.semibold, statusLine, cx, frame.statusBaseline, 28, muted, { anchor: "middle" })
      : "",
    textToPath(fonts.bold, headline, cx, frame.headlineBaseline, 48, ink, { anchor: "middle" }),
    textToPath(fonts.bold, "PackPTS", 152, 978, 32, ink),
    textToPath(fonts.semibold, footerCta, 1000, 978, 26, ink, { anchor: "end" }),
  ].filter(Boolean).join("\n  ");

  const strip = isDaily5Mode ? buildMaskedStripSvg(STRIP_X, frame.stripY) : "";
  const desc = [
    eyebrow,
    identity,
    `${scoreNum}${scoreDen}`,
    dealt !== total ? `${dealt} dealt` : "",
    pointsLabel,
    statusLine,
    headline,
    "PackPTS",
    footerCta,
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

  ${buildPipsSvg(correct, total, skipped)}

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

export interface ChallengeShareInput {
  correctCount: number;
  date: string;
  streak?: number;
}

/**
 * Kit D challenge PNG. Session X/5 only — never a canned 4/5.
 * Visual CTA stays packpts.com/daily; the shared href is the token URL.
 */
export function buildChallengeShareSvg(input: ChallengeShareInput): string {
  const correct = asCount(input.correctCount);
  if (correct > 5) throw new Error("Challenge share score must be a real 0–5 count");
  const W = SCORE_CARD_SIZE;
  const H = SCORE_CARD_SIZE;
  const cx = W / 2;
  const identity = formatSessionDayIdentity(input.date, true);
  const went = `I went ${correct}/5.`;
  const playLine = "Play today's Daily 5.";
  const streakLabel = buildStreakOverlayLabel(input.streak);
  const fonts = loadScoreCardFonts();
  const { ink, muted, gold, canvas } = SCORE_CARD_COLORS;
  const surface = "#161B24";
  const border = "#2A303C";

  const scoreNum = String(correct);
  const scoreDen = "/5";
  const scoreSize = 168;
  const numWidth = measureText(fonts.bold, scoreNum, scoreSize);
  const denWidth = measureText(fonts.bold, scoreDen, scoreSize);
  const scoreX = cx - (numWidth + denWidth) / 2;

  const plaqueX = 760;
  const plaqueY = 690;
  const plaqueW = 240;
  const plaqueCx = plaqueX + plaqueW / 2;
  const plaqueScoreSize = 48;
  const plaqueNumW = measureText(fonts.bold, scoreNum, plaqueScoreSize);
  const plaqueDenW = measureText(fonts.bold, scoreDen, plaqueScoreSize);
  const plaqueScoreX = plaqueCx - (plaqueNumW + plaqueDenW) / 2;

  const outlined = [
    textToPath(fonts.bold, "DAILY 5", 80, 108, 22, muted, { letterSpacing: 4 }),
    identity
      ? textToPath(fonts.bold, identity, 1000, 108, 22, muted, { anchor: "end", letterSpacing: 2 })
      : "",
    textToPath(fonts.bold, scoreNum, scoreX, 360, scoreSize, ink),
    textToPath(fonts.bold, scoreDen, scoreX + numWidth, 360, scoreSize, muted),
    textToPath(fonts.bold, "Beat me.", 80, 760, 64, gold),
    textToPath(fonts.semibold, went, 80, 820, 36, ink),
    textToPath(fonts.semibold, playLine, 80, 868, 26, muted),
    streakLabel
      ? textToPath(fonts.semibold, streakLabel, 80, 912, 24, muted)
      : "",
    textToPath(fonts.bold, "TODAY", plaqueCx, 748, 18, muted, { anchor: "middle", letterSpacing: 2 }),
    textToPath(fonts.bold, scoreNum, plaqueScoreX, 810, plaqueScoreSize, ink),
    textToPath(fonts.bold, scoreDen, plaqueScoreX + plaqueNumW, 810, plaqueScoreSize, muted),
    textToPath(fonts.bold, "PackPTS", 152, 978, 32, ink),
    textToPath(fonts.semibold, "packpts.com/daily", 1000, 978, 26, ink, { anchor: "end" }),
  ].filter(Boolean).join("\n  ");

  const desc = [
    "DAILY 5",
    identity,
    `${scoreNum}${scoreDen}`,
    "Beat me.",
    went,
    playLine,
    streakLabel,
    "TODAY",
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
  <rect x="${plaqueX}" y="${plaqueY}" width="${plaqueW}" height="150" rx="8" fill="${surface}" stroke="${border}" stroke-width="2"/>

  ${outlined}

  ${buildMaskedStripSvg()}

  ${buildPipsSvg(correct, 5)}

  <g transform="translate(80, 940)">
    <g transform="scale(0.0546875)">
      <rect width="1024" height="1024" fill="${canvas}"/>
      <path fill="#ffffff" fill-rule="evenodd" d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z"/>
      <rect x="292" y="448" width="528" height="96" fill="${gold}"/>
    </g>
  </g>
</svg>`;
}

async function writeSharePng(svg: string, date: string, filename: string): Promise<ScoreCardOutput> {
  const dir = getOutputDir(date);
  const imagePath = path.join(dir, filename);
  await sharp(Buffer.from(svg))
    .png({ quality: 90 })
    .toFile(imagePath);
  const imageUrl = `${SHARE_URL_PREFIX}/${safeDateDir(date)}/${filename}`;
  return { imagePath, imageUrl };
}

export async function generateScoreCard(
  input: ScoreCardInput,
  assetId: string,
): Promise<ScoreCardOutput> {
  return writeSharePng(buildScoreCardSvg(input), input.date, `${assetId}.png`);
}

export async function generateChallengeShare(
  input: ChallengeShareInput,
  assetId: string,
): Promise<ScoreCardOutput> {
  const safeId = assetId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96) || "beatme";
  return writeSharePng(buildChallengeShareSvg(input), input.date, `${safeId}.png`);
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
