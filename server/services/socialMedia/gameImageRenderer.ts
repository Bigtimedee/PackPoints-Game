/**
 * Game Image Renderer
 *
 * Generates branded PNG images from live DB game data for all 7 social content types.
 * Card-based types (TRIVIA_CARD, MARKET_PRICE_SPOTLIGHT) composite a CardHedge image
 * with an SVG overlay. All other types render a pure SVG with game stats.
 *
 * Railway Alpine has no system fonts. Sharp/librsvg draws tofu for SVG <text>
 * that relies on fontconfig. Labels are outlined to Inter paths (same pipeline
 * as contentFactory score cards) so PNG output never asks fontconfig for a face.
 *
 * Call sites: `composePostImage` → social scheduler (`@PlayPackPTS` queue).
 * Daily 5 / Beat-me user share cards are `contentFactory/generateScoreCard.ts`.
 */

import sharp from "sharp";
import { sql } from "drizzle-orm";
import { cardSearchSorted } from "../../services/cardhedge/client";
import { buildEmbeddedFontCss, loadScoreCardFonts, textToPath } from "../../contentFactory/fonts";
import type { Font } from "opentype.js";
import { createLogger } from "./logger";

const logger = createLogger("GameImageRenderer");

export const GAME_IMAGE_COLORS = {
  bg: "#0a0a2e",
  panel: "#13133a",
  stripe: "#1a1a5e",
  gold: "#FFD700",
  white: "#FFFFFF",
  muted: "#AAAACC",
  orange: "#FF6B00",
  blue: "#4a9eff",
  green: "#66ff66",
  purple: "#cc88ff",
  bottomBar: "#050514",
} as const;

const C = GAME_IMAGE_COLORS;

export const DIMENSIONS = {
  TWITTER: { width: 1080, height: 1080 },
  TIKTOK: { width: 1080, height: 1920 },
  DISCORD: { width: 1080, height: 1080 },
};

export interface GameImageResult {
  buffer: Buffer;
  cardId?: string;
  cardImageUrl?: string;
  cardPlayer?: string;
  cardSet?: string;
  cardPrice?: number;
  cardSales7d?: number;
}

type PathFont = Font;
type AnchorOpts = { anchor?: "start" | "middle" | "end"; letterSpacing?: number };

function mid(
  font: PathFont,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  options: Omit<AnchorOpts, "anchor"> = {},
): string {
  return textToPath(font, text, x, y, size, fill, { anchor: "middle", ...options });
}

function fontCss(): string {
  return `<defs><style type="text/css">${buildEmbeddedFontCss()}</style></defs>`;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getDb() {
  const { db } = await import("../../db");
  return db;
}

async function queryLeaderboard(): Promise<{ username: string; score: number }> {
  try {
    const db = await getDb();
    const r = await db.execute(sql`
      SELECT u.username, SUM(ma.points_earned) as score
      FROM match_answers ma
      JOIN matches m ON m.id = ma.match_id
      JOIN users u ON u.id = ma.user_id
      WHERE m.status = 'COMPLETED' AND m.created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY u.username ORDER BY score DESC LIMIT 1
    `);
    if (r.rows.length > 0) {
      const row = r.rows[0] as any;
      return { username: String(row.username ?? "Champion"), score: parseInt(String(row.score ?? "0")) || 0 };
    }
  } catch { /* use default */ }
  return { username: "Champion", score: 0 };
}

async function queryStreak(): Promise<number> {
  try {
    const db = await getDb();
    const r = await db.execute(sql`SELECT MAX(current_days) as mx FROM streak_state`);
    return parseInt(String((r.rows[0] as any)?.mx ?? "7")) || 7;
  } catch { return 7; }
}

async function queryChallengeScore(): Promise<number> {
  try {
    const db = await getDb();
    const r = await db.execute(sql`
      SELECT MAX(score) as top FROM (
        SELECT SUM(points_earned) as score FROM match_answers GROUP BY match_id
      ) sub
    `);
    return parseInt(String((r.rows[0] as any)?.top ?? "0")) || 0;
  } catch { return 0; }
}

async function queryUserCount(): Promise<number> {
  try {
    const db = await getDb();
    const r = await db.execute(sql`SELECT COUNT(*) as cnt FROM users WHERE status = 'ACTIVE'`);
    return parseInt(String((r.rows[0] as any)?.cnt ?? "0")) || 0;
  } catch { return 0; }
}

async function queryRewardValue(): Promise<string> {
  try {
    const db = await getDb();
    const r = await db.execute(sql`SELECT reward_value FROM campaign_rewards WHERE is_active = TRUE LIMIT 1`);
    if (r.rows.length > 0) return String((r.rows[0] as any)?.reward_value ?? "500");
  } catch { /* use default */ }
  return "500";
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export async function renderSocialSvgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
}

// ── Pure-SVG renderers ────────────────────────────────────────────────────────

export function buildLeaderboardSvg(w: number, h: number, username: string, score: number): string {
  const fonts = loadScoreCardFonts();
  const barH = Math.round(h * 0.13);
  const hasScore = score > 0;
  const scoreStr = hasScore ? score.toLocaleString() : "";
  const name = shorten(username, 18);
  const cx = w / 2;
  const circleR = Math.round(Math.min(w, h) * 0.14);
  const circleY = Math.round(h * 0.38);
  const nameY = Math.round(h * 0.62);
  const scoreY = Math.round(h * 0.72);
  const tagY = hasScore ? Math.round(h * 0.82) : scoreY;
  const desc = ["LEADERBOARD", "#1", name, ...(hasScore ? [`${scoreStr} pts today`] : []), "Can you take the top spot?", "PackPTS.com"].join(" | ");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    ${fontCss()}
    <desc>${esc(desc)}</desc>
    <rect width="${w}" height="${h}" fill="${C.bg}"/>
    <!-- Subtle stripe -->
    <rect x="0" y="${Math.round(h * 0.5)}" width="${w}" height="4" fill="${C.stripe}" opacity="0.6"/>

    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="${C.panel}"/>
    ${mid(fonts.bold, "LEADERBOARD", cx, Math.round(barH * 0.65), Math.round(barH * 0.42), C.gold, { letterSpacing: 5 })}

    <!-- #1 circle -->
    <circle cx="${cx}" cy="${circleY}" r="${circleR}" fill="${C.gold}" opacity="0.12"/>
    <circle cx="${cx}" cy="${circleY}" r="${circleR - 6}" fill="none" stroke="${C.gold}" stroke-width="4"/>
    ${mid(fonts.bold, "#1", cx, circleY + Math.round(circleR * 0.38), Math.round(circleR * 0.9), C.gold)}

    <!-- Player name -->
    ${mid(fonts.bold, name, cx, nameY, Math.round(w * 0.072), C.white)}

    <!-- Score (omitted when there is no value) -->
    ${hasScore ? mid(fonts.regular, `${scoreStr} pts today`, cx, scoreY, Math.round(w * 0.048), C.muted) : ""}

    <!-- CTA (regular — no italic Inter face ships) -->
    ${mid(fonts.regular, "Can you take the top spot?", cx, tagY, Math.round(w * 0.036), C.gold)}

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${C.bottomBar}"/>
    ${mid(fonts.bold, "PackPTS.com", cx, h - Math.round(barH * 0.32), Math.round(barH * 0.42), C.gold)}
  </svg>`;
}

export function buildStreakSvg(w: number, h: number, streak: number): string {
  const fonts = loadScoreCardFonts();
  const barH = Math.round(h * 0.13);
  const cx = w / 2;
  const circleR = Math.round(Math.min(w, h) * 0.18);
  const circleY = Math.round(h * 0.42);
  const labelY = Math.round(h * 0.68);
  const subY = Math.round(h * 0.77);
  const streakStr = String(streak);
  const desc = ["STREAK", streakStr, "DAY STREAK", "Daily play = bonus points", "PackPTS.com"].join(" | ");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    ${fontCss()}
    <desc>${esc(desc)}</desc>
    <rect width="${w}" height="${h}" fill="${C.bg}"/>

    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="${C.panel}"/>
    ${mid(fonts.bold, "STREAK", cx, Math.round(barH * 0.65), Math.round(barH * 0.42), C.orange, { letterSpacing: 5 })}

    <!-- Fire-ring circle -->
    <circle cx="${cx}" cy="${circleY}" r="${circleR}" fill="${C.orange}" opacity="0.1"/>
    <circle cx="${cx}" cy="${circleY}" r="${circleR - 6}" fill="none" stroke="${C.orange}" stroke-width="5"/>
    ${mid(fonts.bold, streakStr, cx, circleY + Math.round(circleR * 0.28), Math.round(circleR * 1.1), C.orange)}

    <!-- Label -->
    ${mid(fonts.bold, "DAY STREAK", cx, labelY, Math.round(w * 0.064), C.white)}

    <!-- Sub -->
    ${mid(fonts.regular, "Daily play = bonus points", cx, subY, Math.round(w * 0.038), C.muted)}

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${C.bottomBar}"/>
    ${mid(fonts.bold, "PackPTS.com", cx, h - Math.round(barH * 0.32), Math.round(barH * 0.42), C.gold)}
  </svg>`;
}

export function buildChallengeSvg(w: number, h: number, topScore: number): string {
  const fonts = loadScoreCardFonts();
  const barH = Math.round(h * 0.13);
  const cx = w / 2;
  const scoreY = Math.round(h * 0.48);
  const labelY = Math.round(h * 0.6);
  const ctaY = Math.round(h * 0.72);
  const hasScore = topScore > 0;
  const scoreStr = hasScore ? topScore.toLocaleString() : "";
  const recordLine = "points: the record to beat";
  const labelYDrawn = hasScore ? labelY : scoreY;
  const ctaYDrawn = hasScore ? ctaY : labelY;
  const desc = ["CHALLENGE", ...(hasScore ? [scoreStr] : []), recordLine, "Card experts only.", "PackPTS.com"].join(" | ");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    ${fontCss()}
    <desc>${esc(desc)}</desc>
    <rect width="${w}" height="${h}" fill="${C.bg}"/>

    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="${C.panel}"/>
    ${mid(fonts.bold, "CHALLENGE", cx, Math.round(barH * 0.65), Math.round(barH * 0.42), C.blue, { letterSpacing: 5 })}

    <!-- Score display (omitted when there is no value) -->
    ${hasScore ? mid(fonts.bold, scoreStr, cx, scoreY, Math.round(w * 0.18), C.blue) : ""}

    <!-- Label -->
    ${mid(fonts.regular, recordLine, cx, labelYDrawn, Math.round(w * 0.048), C.muted)}

    <!-- CTA -->
    ${mid(fonts.bold, "Card experts only.", cx, ctaYDrawn, Math.round(w * 0.042), C.white)}

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${C.bottomBar}"/>
    ${mid(fonts.bold, "PackPTS.com", cx, h - Math.round(barH * 0.32), Math.round(barH * 0.42), C.gold)}
  </svg>`;
}

export function buildNewUserSvg(w: number, h: number, userCount: number): string {
  const fonts = loadScoreCardFonts();
  const barH = Math.round(h * 0.13);
  const cx = w / 2;
  const countStr = userCount > 0 ? userCount.toLocaleString() : "Thousands";
  const countY = Math.round(h * 0.46);
  const labelY = Math.round(h * 0.58);
  const ctaY = Math.round(h * 0.69);
  const subY = Math.round(h * 0.79);
  const desc = ["JOIN NOW", countStr, "players already competing", "Free to play. Real rewards.", "Your card knowledge pays off.", "PackPTS.com"].join(" | ");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    ${fontCss()}
    <desc>${esc(desc)}</desc>
    <rect width="${w}" height="${h}" fill="${C.bg}"/>

    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="${C.panel}"/>
    ${mid(fonts.bold, "JOIN NOW", cx, Math.round(barH * 0.65), Math.round(barH * 0.42), C.green, { letterSpacing: 4 })}

    <!-- Count -->
    ${mid(fonts.bold, countStr, cx, countY, Math.round(w * 0.14), C.green)}

    <!-- Label -->
    ${mid(fonts.regular, "players already competing", cx, labelY, Math.round(w * 0.044), C.muted)}

    <!-- CTA -->
    ${mid(fonts.bold, "Free to play. Real rewards.", cx, ctaY, Math.round(w * 0.05), C.white)}

    <!-- Sub -->
    ${mid(fonts.regular, "Your card knowledge pays off.", cx, subY, Math.round(w * 0.036), C.muted)}

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${C.bottomBar}"/>
    ${mid(fonts.bold, "PackPTS.com", cx, h - Math.round(barH * 0.32), Math.round(barH * 0.42), C.gold)}
  </svg>`;
}

export function buildRewardSvg(w: number, h: number, rewardValue: string): string {
  const fonts = loadScoreCardFonts();
  const barH = Math.round(h * 0.13);
  const cx = w / 2;
  const valueY = Math.round(h * 0.46);
  const labelY = Math.round(h * 0.58);
  const ctaY = Math.round(h * 0.69);
  const subY = Math.round(h * 0.79);
  const desc = ["REWARD", rewardValue, "bonus points on signup", "Streak rewards. Referral points.", "PackPTS pays you to play.", "PackPTS.com"].join(" | ");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    ${fontCss()}
    <desc>${esc(desc)}</desc>
    <rect width="${w}" height="${h}" fill="${C.bg}"/>

    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="${C.panel}"/>
    ${mid(fonts.bold, "REWARD", cx, Math.round(barH * 0.65), Math.round(barH * 0.42), C.purple, { letterSpacing: 4 })}

    <!-- Value -->
    ${mid(fonts.bold, rewardValue, cx, valueY, Math.round(w * 0.16), C.purple)}

    <!-- Label -->
    ${mid(fonts.regular, "bonus points on signup", cx, labelY, Math.round(w * 0.044), C.muted)}

    <!-- CTA -->
    ${mid(fonts.bold, "Streak rewards. Referral points.", cx, ctaY, Math.round(w * 0.05), C.white)}

    <!-- Sub -->
    ${mid(fonts.regular, "PackPTS pays you to play.", cx, subY, Math.round(w * 0.036), C.muted)}

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${C.bottomBar}"/>
    ${mid(fonts.bold, "PackPTS.com", cx, h - Math.round(barH * 0.32), Math.round(barH * 0.42), C.gold)}
  </svg>`;
}

// ── Card-image overlay SVGs ───────────────────────────────────────────────────

export function buildCardOverlaySvg(
  w: number,
  h: number,
  badgeLabel: string,
  accentColor: string,
  overlayText?: string,
): string {
  const fonts = loadScoreCardFonts();
  const barH = Math.round(h * 0.13);
  const cx = w / 2;
  const overlay = overlayText ? shorten(overlayText, 50) : "";
  const desc = [badgeLabel, "PackPTS.com", overlay].filter(Boolean).join(" | ");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    ${fontCss()}
    <desc>${esc(desc)}</desc>
    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="rgba(10,10,46,0.88)"/>
    ${mid(fonts.bold, badgeLabel, cx, Math.round(barH * 0.65), Math.round(barH * 0.42), accentColor, { letterSpacing: 5 })}

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="rgba(5,5,20,0.92)"/>
    ${mid(fonts.bold, "PackPTS.com", cx, h - Math.round(barH * 0.52), Math.round(barH * 0.42), C.gold)}
    ${overlay ? mid(fonts.regular, overlay, cx, h - Math.round(barH * 0.15), Math.round(barH * 0.26), C.muted) : ""}
  </svg>`;
}

// ── Card-based compositor ─────────────────────────────────────────────────────

async function renderCardImage(
  w: number,
  h: number,
  cardSize: number,
  badgeLabel: string,
  accentColor: string,
  cardQuery?: { category?: string; player?: string; sortBy?: "sales_7day" | "gain" },
  overlayText?: string,
): Promise<GameImageResult> {
  const searchResult = await cardSearchSorted({
    page: 1,
    page_size: 10,
    category: cardQuery?.category ?? "Baseball",
    player: cardQuery?.player,
    sort_by: cardQuery?.sortBy ?? "sales_7day",
    sort_order: "desc",
  });

  const cards = searchResult.cards.filter(c => c.image);
  if (cards.length === 0) throw new Error("No cards with images found from CardHedge");
  const card = cards[0];

  const imgResponse = await fetch(card.image!);
  if (!imgResponse.ok) throw new Error(`Failed to download card image: ${imgResponse.status}`);
  const imgBuf = Buffer.from(await imgResponse.arrayBuffer());

  const cardImg = await sharp(imgBuf)
    .resize(cardSize, cardSize, { fit: "inside", background: { r: 10, g: 10, b: 46, alpha: 0 } })
    .png()
    .toBuffer();

  const cardMeta = await sharp(cardImg).metadata();
  const cardW = cardMeta.width ?? cardSize;
  const cardH = cardMeta.height ?? cardSize;
  const cardLeft = Math.floor((w - cardW) / 2);
  const cardTop = Math.floor((h - cardH) / 2);

  const overlaySvg = buildCardOverlaySvg(w, h, badgeLabel, accentColor, overlayText);

  const buffer = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 10, g: 10, b: 46, alpha: 1 } },
  })
    .composite([
      { input: cardImg, left: cardLeft, top: cardTop },
      { input: Buffer.from(overlaySvg), left: 0, top: 0 },
    ])
    .png({ quality: 90 })
    .toBuffer();

  return {
    buffer,
    cardId: card.card_id ?? "",
    cardImageUrl: card.image!,
    cardPlayer: card.player ?? "",
    cardSet: card.set ?? "",
    cardPrice: (card.prices as any)?.[0]?.price ?? undefined,
    cardSales7d: (card as any)["7 Day Sales"] ?? (card as any).sales7d ?? undefined,
  };
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function renderGameImage(
  contentType: string,
  platform: "TWITTER" | "TIKTOK" | "DISCORD",
  cardQuery?: { category?: string; player?: string; sortBy?: "sales_7day" | "gain" },
  overlayText?: string,
): Promise<GameImageResult> {
  const { width: w, height: h } = DIMENSIONS[platform];
  const cardSize = platform === "TWITTER" ? 800 : 900;

  switch (contentType) {
    case "TRIVIA_CARD": {
      logger.info("render_start", { contentType, platform });
      return renderCardImage(w, h, cardSize, "TRIVIA CARD", C.gold, cardQuery, overlayText);
    }

    case "MARKET_PRICE_SPOTLIGHT": {
      logger.info("render_start", { contentType, platform });
      return renderCardImage(w, h, cardSize, "HOT MARKET", C.orange, cardQuery, overlayText);
    }

    case "LEADERBOARD_HIGHLIGHT": {
      logger.info("render_start", { contentType, platform });
      const { username, score } = await queryLeaderboard();
      const svg = buildLeaderboardSvg(w, h, username, score);
      const buffer = await renderSocialSvgToPng(svg);
      return { buffer };
    }

    case "STREAK_MILESTONE": {
      logger.info("render_start", { contentType, platform });
      const streak = await queryStreak();
      const svg = buildStreakSvg(w, h, streak);
      const buffer = await renderSocialSvgToPng(svg);
      return { buffer };
    }

    case "CHALLENGE": {
      logger.info("render_start", { contentType, platform });
      const topScore = await queryChallengeScore();
      const svg = buildChallengeSvg(w, h, topScore);
      const buffer = await renderSocialSvgToPng(svg);
      return { buffer };
    }

    case "NEW_USER_ACQUISITION": {
      logger.info("render_start", { contentType, platform });
      const userCount = await queryUserCount();
      const svg = buildNewUserSvg(w, h, userCount);
      const buffer = await renderSocialSvgToPng(svg);
      return { buffer };
    }

    case "REWARD_ANNOUNCEMENT": {
      logger.info("render_start", { contentType, platform });
      const rewardValue = await queryRewardValue();
      const svg = buildRewardSvg(w, h, rewardValue);
      const buffer = await renderSocialSvgToPng(svg);
      return { buffer };
    }

    default: {
      logger.warn("unknown_content_type", { contentType, platform });
      const svg = buildNewUserSvg(w, h, 0);
      const buffer = await renderSocialSvgToPng(svg);
      return { buffer };
    }
  }
}
