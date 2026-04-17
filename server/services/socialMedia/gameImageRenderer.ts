/**
 * Game Image Renderer
 *
 * Generates branded PNG images from live DB game data for all 7 social content types.
 * Card-based types (TRIVIA_CARD, MARKET_PRICE_SPOTLIGHT) composite a CardHedge image
 * with an SVG overlay. All other types render a pure SVG with game stats.
 */

import sharp from "sharp";
import { sql } from "drizzle-orm";
import { cardSearchSorted } from "../../services/cardhedge/client";
import { createLogger } from "./logger";

const logger = createLogger("GameImageRenderer");

const C = {
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
};

const DIMENSIONS = {
  TWITTER: { width: 1080, height: 1080 },
  TIKTOK: { width: 1080, height: 1920 },
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

// ── Pure-SVG renderers ────────────────────────────────────────────────────────

function svgLeaderboard(w: number, h: number, username: string, score: number): string {
  const barH = Math.round(h * 0.13);
  const scoreStr = score > 0 ? score.toLocaleString() : "—";
  const cx = w / 2;
  const circleR = Math.round(Math.min(w, h) * 0.14);
  const circleY = Math.round(h * 0.38);
  const nameY = Math.round(h * 0.62);
  const scoreY = Math.round(h * 0.72);
  const tagY = Math.round(h * 0.82);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="${C.bg}"/>
    <!-- Subtle stripe -->
    <rect x="0" y="${Math.round(h * 0.5)}" width="${w}" height="4" fill="${C.stripe}" opacity="0.6"/>

    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="${C.panel}"/>
    <text x="${cx}" y="${Math.round(barH * 0.65)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.gold}" text-anchor="middle" letter-spacing="5">LEADERBOARD</text>

    <!-- #1 circle -->
    <circle cx="${cx}" cy="${circleY}" r="${circleR}" fill="${C.gold}" opacity="0.12"/>
    <circle cx="${cx}" cy="${circleY}" r="${circleR - 6}" fill="none" stroke="${C.gold}" stroke-width="4"/>
    <text x="${cx}" y="${circleY + Math.round(circleR * 0.38)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(circleR * 0.9)}"
      fill="${C.gold}" text-anchor="middle">#1</text>

    <!-- Player name -->
    <text x="${cx}" y="${nameY}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(w * 0.072)}"
      fill="${C.white}" text-anchor="middle">${esc(shorten(username, 18))}</text>

    <!-- Score -->
    <text x="${cx}" y="${scoreY}"
      font-family="sans-serif" font-size="${Math.round(w * 0.048)}"
      fill="${C.muted}" text-anchor="middle">${scoreStr} pts today</text>

    <!-- CTA -->
    <text x="${cx}" y="${tagY}"
      font-family="sans-serif" font-style="italic" font-size="${Math.round(w * 0.036)}"
      fill="${C.gold}" text-anchor="middle">Can you take the top spot?</text>

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${C.bottomBar}"/>
    <text x="${cx}" y="${h - Math.round(barH * 0.32)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.gold}" text-anchor="middle">PackPTS.com</text>
  </svg>`;
}

function svgStreak(w: number, h: number, streak: number): string {
  const barH = Math.round(h * 0.13);
  const cx = w / 2;
  const circleR = Math.round(Math.min(w, h) * 0.18);
  const circleY = Math.round(h * 0.42);
  const labelY = Math.round(h * 0.68);
  const subY = Math.round(h * 0.77);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="${C.bg}"/>

    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="${C.panel}"/>
    <text x="${cx}" y="${Math.round(barH * 0.65)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.orange}" text-anchor="middle" letter-spacing="5">STREAK</text>

    <!-- Fire-ring circle -->
    <circle cx="${cx}" cy="${circleY}" r="${circleR}" fill="${C.orange}" opacity="0.1"/>
    <circle cx="${cx}" cy="${circleY}" r="${circleR - 6}" fill="none" stroke="${C.orange}" stroke-width="5"/>
    <text x="${cx}" y="${circleY + Math.round(circleR * 0.28)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(circleR * 1.1)}"
      fill="${C.orange}" text-anchor="middle">${streak}</text>

    <!-- Label -->
    <text x="${cx}" y="${labelY}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(w * 0.064)}"
      fill="${C.white}" text-anchor="middle">DAY STREAK</text>

    <!-- Sub -->
    <text x="${cx}" y="${subY}"
      font-family="sans-serif" font-size="${Math.round(w * 0.038)}"
      fill="${C.muted}" text-anchor="middle">Daily play = bonus points</text>

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${C.bottomBar}"/>
    <text x="${cx}" y="${h - Math.round(barH * 0.32)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.gold}" text-anchor="middle">PackPTS.com</text>
  </svg>`;
}

function svgChallenge(w: number, h: number, topScore: number): string {
  const barH = Math.round(h * 0.13);
  const cx = w / 2;
  const scoreY = Math.round(h * 0.48);
  const labelY = Math.round(h * 0.6);
  const ctaY = Math.round(h * 0.72);
  const scoreStr = topScore > 0 ? topScore.toLocaleString() : "—";

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="${C.bg}"/>

    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="${C.panel}"/>
    <text x="${cx}" y="${Math.round(barH * 0.65)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.blue}" text-anchor="middle" letter-spacing="5">CHALLENGE</text>

    <!-- Score display -->
    <text x="${cx}" y="${scoreY}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(w * 0.18)}"
      fill="${C.blue}" text-anchor="middle">${esc(scoreStr)}</text>

    <!-- Label -->
    <text x="${cx}" y="${labelY}"
      font-family="sans-serif" font-size="${Math.round(w * 0.048)}"
      fill="${C.muted}" text-anchor="middle">points — the record to beat</text>

    <!-- CTA -->
    <text x="${cx}" y="${ctaY}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(w * 0.042)}"
      fill="${C.white}" text-anchor="middle">Card experts only.</text>

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${C.bottomBar}"/>
    <text x="${cx}" y="${h - Math.round(barH * 0.32)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.gold}" text-anchor="middle">PackPTS.com</text>
  </svg>`;
}

function svgNewUser(w: number, h: number, userCount: number): string {
  const barH = Math.round(h * 0.13);
  const cx = w / 2;
  const countStr = userCount > 0 ? userCount.toLocaleString() : "Thousands";
  const countY = Math.round(h * 0.46);
  const labelY = Math.round(h * 0.58);
  const ctaY = Math.round(h * 0.69);
  const subY = Math.round(h * 0.79);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="${C.bg}"/>

    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="${C.panel}"/>
    <text x="${cx}" y="${Math.round(barH * 0.65)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.green}" text-anchor="middle" letter-spacing="4">JOIN NOW</text>

    <!-- Count -->
    <text x="${cx}" y="${countY}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(w * 0.14)}"
      fill="${C.green}" text-anchor="middle">${esc(countStr)}</text>

    <!-- Label -->
    <text x="${cx}" y="${labelY}"
      font-family="sans-serif" font-size="${Math.round(w * 0.044)}"
      fill="${C.muted}" text-anchor="middle">players already competing</text>

    <!-- CTA -->
    <text x="${cx}" y="${ctaY}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(w * 0.05)}"
      fill="${C.white}" text-anchor="middle">Free to play. Real rewards.</text>

    <!-- Sub -->
    <text x="${cx}" y="${subY}"
      font-family="sans-serif" font-size="${Math.round(w * 0.036)}"
      fill="${C.muted}" text-anchor="middle">Your card knowledge pays off.</text>

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${C.bottomBar}"/>
    <text x="${cx}" y="${h - Math.round(barH * 0.32)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.gold}" text-anchor="middle">PackPTS.com</text>
  </svg>`;
}

function svgReward(w: number, h: number, rewardValue: string): string {
  const barH = Math.round(h * 0.13);
  const cx = w / 2;
  const valueY = Math.round(h * 0.46);
  const labelY = Math.round(h * 0.58);
  const ctaY = Math.round(h * 0.69);
  const subY = Math.round(h * 0.79);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="${C.bg}"/>

    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="${C.panel}"/>
    <text x="${cx}" y="${Math.round(barH * 0.65)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.purple}" text-anchor="middle" letter-spacing="4">REWARD</text>

    <!-- Value -->
    <text x="${cx}" y="${valueY}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(w * 0.16)}"
      fill="${C.purple}" text-anchor="middle">${esc(rewardValue)}</text>

    <!-- Label -->
    <text x="${cx}" y="${labelY}"
      font-family="sans-serif" font-size="${Math.round(w * 0.044)}"
      fill="${C.muted}" text-anchor="middle">bonus points on signup</text>

    <!-- CTA -->
    <text x="${cx}" y="${ctaY}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(w * 0.05)}"
      fill="${C.white}" text-anchor="middle">Streak rewards. Referral points.</text>

    <!-- Sub -->
    <text x="${cx}" y="${subY}"
      font-family="sans-serif" font-size="${Math.round(w * 0.036)}"
      fill="${C.muted}" text-anchor="middle">PackPTS pays you to play.</text>

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${C.bottomBar}"/>
    <text x="${cx}" y="${h - Math.round(barH * 0.32)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.gold}" text-anchor="middle">PackPTS.com</text>
  </svg>`;
}

// ── Card-image overlay SVGs ───────────────────────────────────────────────────

function svgCardOverlay(
  w: number,
  h: number,
  badgeLabel: string,
  accentColor: string,
  overlayText?: string,
): string {
  const barH = Math.round(h * 0.13);
  const cx = w / 2;
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <!-- Top badge bar -->
    <rect x="0" y="0" width="${w}" height="${barH}" fill="rgba(10,10,46,0.88)"/>
    <text x="${cx}" y="${Math.round(barH * 0.65)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${accentColor}" text-anchor="middle" letter-spacing="5">${esc(badgeLabel)}</text>

    <!-- Bottom bar -->
    <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="rgba(5,5,20,0.92)"/>
    <text x="${cx}" y="${h - Math.round(barH * 0.52)}"
      font-family="sans-serif" font-weight="bold" font-size="${Math.round(barH * 0.42)}"
      fill="${C.gold}" text-anchor="middle">PackPTS.com</text>
    ${overlayText ? `<text x="${cx}" y="${h - Math.round(barH * 0.15)}"
      font-family="sans-serif" font-size="${Math.round(barH * 0.26)}"
      fill="${C.muted}" text-anchor="middle">${esc(shorten(overlayText, 50))}</text>` : ""}
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

  const overlaySvg = svgCardOverlay(w, h, badgeLabel, accentColor, overlayText);

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
  platform: "TWITTER" | "TIKTOK",
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
      const svg = svgLeaderboard(w, h, username, score);
      const buffer = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
      return { buffer };
    }

    case "STREAK_MILESTONE": {
      logger.info("render_start", { contentType, platform });
      const streak = await queryStreak();
      const svg = svgStreak(w, h, streak);
      const buffer = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
      return { buffer };
    }

    case "CHALLENGE": {
      logger.info("render_start", { contentType, platform });
      const topScore = await queryChallengeScore();
      const svg = svgChallenge(w, h, topScore);
      const buffer = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
      return { buffer };
    }

    case "NEW_USER_ACQUISITION": {
      logger.info("render_start", { contentType, platform });
      const userCount = await queryUserCount();
      const svg = svgNewUser(w, h, userCount);
      const buffer = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
      return { buffer };
    }

    case "REWARD_ANNOUNCEMENT": {
      logger.info("render_start", { contentType, platform });
      const rewardValue = await queryRewardValue();
      const svg = svgReward(w, h, rewardValue);
      const buffer = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
      return { buffer };
    }

    default: {
      logger.warn("unknown_content_type", { contentType, platform });
      const svg = svgNewUser(w, h, 0);
      const buffer = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
      return { buffer };
    }
  }
}
