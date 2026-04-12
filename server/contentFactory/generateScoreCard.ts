/**
 * generateScoreCard.ts
 *
 * Generates PNG share cards for PackPTS game results using sharp (SVG → PNG).
 *
 * Asset storage layout:
 *   public/generated/share/{YYYY-MM-DD}/{assetId}.png
 *
 * Public URL served by Express static:
 *   /generated/share/{YYYY-MM-DD}/{assetId}.png
 *
 * Full disk path (resolved from project root):
 *   <project-root>/public/generated/share/{YYYY-MM-DD}/{assetId}.png
 *
 * Card dimensions: 1080 × 1920 px (9:16 portrait, optimised for Stories / Reels).
 * Compression: PNG quality 90.
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";

const OUTPUT_BASE = path.resolve("public/generated/share");

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
  return text.slice(0, maxLen - 1) + "…";
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

function buildScoreCardSvg(input: ScoreCardInput): string {
  const W = 1080;
  const H = 1920;
  const username = escapeXml(truncate(input.username || "Player", 20));
  const accuracy = input.totalQuestions > 0
    ? Math.round((input.correctCount / input.totalQuestions) * 100)
    : 0;
  const modeName = input.mode === "daily5" ? "DAILY 5 CHALLENGE"
    : input.mode === "1v1" ? "1v1 MATCH"
    : "SOLO MATCH";
  const dateStr = escapeXml(input.date);
  const setInfo = input.setName ? escapeXml(truncate(input.setName, 30)) : "";

  const streakSection = input.streak && input.streak > 0
    ? `<text x="${W / 2}" y="1160" font-family="sans-serif" font-weight="bold" font-size="56" fill="#FFD700" text-anchor="middle">${input.streak}-Day Streak</text>`
    : "";

  const rankSection = input.rank
    ? `<text x="${W / 2}" y="1240" font-family="sans-serif" font-weight="bold" font-size="48" fill="#B8B8FF" text-anchor="middle">#${input.rank} on the Leaderboard</text>`
    : "";

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0A0A2E"/>
      <stop offset="50%" stop-color="#1A1A4E"/>
      <stop offset="100%" stop-color="#0A0A2E"/>
    </linearGradient>
    <linearGradient id="scoreGlow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#00FF88"/>
      <stop offset="100%" stop-color="#00CC66"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FF6B35"/>
      <stop offset="100%" stop-color="#FFD700"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="40" fill="none" stroke="#333366" stroke-width="3"/>
  <rect x="60" y="60" width="${W - 120}" height="${H - 120}" rx="30" fill="none" stroke="#222244" stroke-width="1"/>

  <text x="${W / 2}" y="200" font-family="sans-serif" font-weight="bold" font-size="42" fill="#888899" text-anchor="middle" letter-spacing="8">${modeName}</text>
  <text x="${W / 2}" y="260" font-family="sans-serif" font-size="32" fill="#666688" text-anchor="middle">${dateStr}</text>
  ${setInfo ? `<text x="${W / 2}" y="310" font-family="sans-serif" font-size="28" fill="#555577" text-anchor="middle">${setInfo}</text>` : ""}

  <text x="${W / 2}" y="500" font-family="sans-serif" font-weight="bold" font-size="48" fill="#AAAACC" text-anchor="middle">@${username}</text>

  <text x="${W / 2}" y="750" font-family="sans-serif" font-weight="bold" font-size="220" fill="url(#scoreGlow)" text-anchor="middle">${input.score}</text>
  <text x="${W / 2}" y="830" font-family="sans-serif" font-weight="bold" font-size="42" fill="#88FFAA" text-anchor="middle">POINTS</text>

  <rect x="200" y="900" width="680" height="3" fill="#333355"/>

  <text x="${W / 2 - 150}" y="1000" font-family="sans-serif" font-weight="bold" font-size="72" fill="white" text-anchor="middle">${input.correctCount}/${input.totalQuestions}</text>
  <text x="${W / 2 - 150}" y="1050" font-family="sans-serif" font-size="30" fill="#888899" text-anchor="middle">CORRECT</text>

  <text x="${W / 2 + 150}" y="1000" font-family="sans-serif" font-weight="bold" font-size="72" fill="white" text-anchor="middle">${accuracy}%</text>
  <text x="${W / 2 + 150}" y="1050" font-family="sans-serif" font-size="30" fill="#888899" text-anchor="middle">ACCURACY</text>

  ${streakSection}
  ${rankSection}

  <rect x="140" y="1500" width="800" height="100" rx="50" fill="url(#accent)"/>
  <text x="${W / 2}" y="1565" font-family="sans-serif" font-weight="bold" font-size="40" fill="white" text-anchor="middle">Play at PackPTS.com</text>

  <text x="${W / 2}" y="1720" font-family="sans-serif" font-weight="bold" font-size="56" fill="url(#accent)" text-anchor="middle">PACKPTS</text>
  <text x="${W / 2}" y="1770" font-family="sans-serif" font-size="28" fill="#666688" text-anchor="middle">Can you beat this score?</text>

  <text x="${W / 2}" y="1850" font-family="sans-serif" font-size="22" fill="#444466" text-anchor="middle">packpts.com • The Baseball Card Challenge</text>
</svg>`;
}

function buildStreakBadgeSvg(username: string, streak: number, date: string): string {
  const W = 1080;
  const H = 1920;
  const un = escapeXml(truncate(username || "Player", 20));
  const milestoneColors: Record<number, string> = {
    3: "#00FF88", 7: "#FFD700", 14: "#FF6B35", 30: "#FF4444",
  };
  const color = milestoneColors[streak] || "#FFD700";
  const milestoneLabel = streak >= 30 ? "LEGENDARY" : streak >= 14 ? "ON FIRE" : streak >= 7 ? "HOT STREAK" : "WARMING UP";

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0A0A2E"/>
      <stop offset="50%" stop-color="#2A1A0E"/>
      <stop offset="100%" stop-color="#0A0A2E"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="40" fill="none" stroke="${color}" stroke-width="4" opacity="0.5"/>

  <text x="${W / 2}" y="300" font-family="sans-serif" font-weight="bold" font-size="42" fill="#888899" text-anchor="middle" letter-spacing="8">STREAK MILESTONE</text>
  <text x="${W / 2}" y="380" font-family="sans-serif" font-size="32" fill="#666688" text-anchor="middle">${escapeXml(date)}</text>

  <text x="${W / 2}" y="700" font-family="sans-serif" font-weight="bold" font-size="300" fill="${color}" text-anchor="middle">${streak}</text>
  <text x="${W / 2}" y="800" font-family="sans-serif" font-weight="bold" font-size="56" fill="${color}" text-anchor="middle">DAY STREAK</text>

  <text x="${W / 2}" y="950" font-family="sans-serif" font-weight="bold" font-size="64" fill="white" text-anchor="middle">${milestoneLabel}</text>

  <text x="${W / 2}" y="1100" font-family="sans-serif" font-weight="bold" font-size="48" fill="#AAAACC" text-anchor="middle">@${un}</text>

  <rect x="140" y="1500" width="800" height="100" rx="50" fill="${color}"/>
  <text x="${W / 2}" y="1565" font-family="sans-serif" font-weight="bold" font-size="40" fill="white" text-anchor="middle">Play at PackPTS.com</text>

  <text x="${W / 2}" y="1720" font-family="sans-serif" font-weight="bold" font-size="56" fill="${color}" text-anchor="middle">PACKPTS</text>
  <text x="${W / 2}" y="1850" font-family="sans-serif" font-size="22" fill="#444466" text-anchor="middle">packpts.com • The Baseball Card Challenge</text>
</svg>`;
}

function getOutputDir(date: string): string {
  const dir = path.join(OUTPUT_BASE, date);
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

  const imageUrl = `/generated/share/${input.date}/${filename}`;
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

  const imageUrl = `/generated/share/${date}/${filename}`;
  return { imagePath, imageUrl };
}
