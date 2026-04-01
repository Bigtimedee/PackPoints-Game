import sharp from "sharp";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { cardSearchSorted } from "../../services/cardhedge/client";
import { createLogger } from "./logger";
import { uploadImageToStorage } from "./imageStorage";

const logger = createLogger("ImageComposer");
const OUTPUT_BASE = path.resolve("public/generated/social");

export interface ImageComposeParams {
  platform: "TWITTER" | "TIKTOK";
  contentType: string;
  cardQuery?: { category?: string; player?: string; sortBy?: "sales_7day" | "gain" };
  overlayText?: string;
}

export interface ComposedImage {
  imagePath: string;
  cardId: string;
  cardImageUrl: string;
  cardPlayer: string;
  cardSet: string;
  cardPrice?: number;
  cardSales7d?: number;
}

const BADGE_LABELS: Record<string, string> = {
  TRIVIA_CARD: "TRENDING CARD",
  LEADERBOARD_HIGHLIGHT: "TOP PLAYER",
  STREAK_MILESTONE: "STREAK",
  MARKET_PRICE_SPOTLIGHT: "HOT MARKET",
  NEW_USER_ACQUISITION: "JOIN NOW",
  REWARD_ANNOUNCEMENT: "REWARD",
  CHALLENGE: "CHALLENGE",
};

async function getOutputDir(date: string): Promise<string> {
  const dir = path.join(OUTPUT_BASE, date);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function buildOverlaySvg(
  width: number,
  height: number,
  badgeLabel: string,
  overlayText?: string,
): Buffer {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <!-- Top badge -->
    <rect x="0" y="0" width="${width}" height="70" fill="rgba(10,10,46,0.85)"/>
    <text x="${width / 2}" y="45" font-family="sans-serif" font-weight="bold" font-size="28"
      fill="#FFD700" text-anchor="middle" letter-spacing="4">${escapeXml(badgeLabel)}</text>

    <!-- Bottom bar -->
    <rect x="0" y="${height - 120}" width="${width}" height="120" fill="rgba(5,5,30,0.92)"/>
    <text x="${width / 2}" y="${height - 70}" font-family="sans-serif" font-weight="bold" font-size="36"
      fill="#FFD700" text-anchor="middle">PackPTS.com</text>
    ${overlayText ? `<text x="${width / 2}" y="${height - 30}" font-family="sans-serif" font-size="22"
      fill="#AAAACC" text-anchor="middle">${escapeXml(truncate(overlayText, 50))}</text>` : ""}
  </svg>`;
  return Buffer.from(svg);
}

export async function composePostImage(params: ImageComposeParams): Promise<ComposedImage> {
  const { platform, contentType, cardQuery, overlayText } = params;

  const width = platform === "TWITTER" ? 1080 : 1080;
  const height = platform === "TWITTER" ? 1080 : 1920;
  const cardSize = platform === "TWITTER" ? 800 : 900;

  // Fetch card from CardHedge
  const searchResult = await cardSearchSorted({
    page: 1,
    page_size: 10,
    category: cardQuery?.category ?? "Baseball",
    player: cardQuery?.player,
    sort_by: cardQuery?.sortBy ?? "sales_7day",
    sort_order: "desc",
  });

  const cards = searchResult.cards.filter(c => c.image);
  if (cards.length === 0) {
    throw new Error("No cards with images found from CardHedge");
  }
  const card = cards[0];

  // Download card image
  const imageUrl = card.image!;
  const imgResponse = await fetch(imageUrl);
  if (!imgResponse.ok) throw new Error(`Failed to download card image: ${imgResponse.status}`);
  const imgBuf = Buffer.from(await imgResponse.arrayBuffer());

  // Resize card image
  const cardImg = await sharp(imgBuf)
    .resize(cardSize, cardSize, { fit: "inside", background: { r: 10, g: 10, b: 46, alpha: 0 } })
    .png()
    .toBuffer();

  const cardMeta = await sharp(cardImg).metadata();
  const cardW = cardMeta.width ?? cardSize;
  const cardH = cardMeta.height ?? cardSize;
  const cardLeft = Math.floor((width - cardW) / 2);
  const cardTop = Math.floor((height - cardH) / 2);

  // Build overlay SVG
  const badgeLabel = BADGE_LABELS[contentType] ?? contentType;
  const overlaySvg = buildOverlaySvg(width, height, badgeLabel, overlayText);

  // Compose with Sharp
  const background: sharp.Color = { r: 10, g: 10, b: 46, alpha: 1 };
  const composed = await sharp({
    create: { width, height, channels: 4, background },
  })
    .composite([
      { input: cardImg, left: cardLeft, top: cardTop },
      { input: overlaySvg, left: 0, top: 0 },
    ])
    .png({ quality: 90 })
    .toBuffer();

  // Save file locally (always — serves as fallback for dev and Twitter)
  const date = new Date().toISOString().slice(0, 10);
  const dir = await getOutputDir(date);
  const filename = `${randomUUID()}.png`;
  const localPath = path.join(dir, filename);
  await fs.promises.writeFile(localPath, composed);

  // Try uploading to R2 for a permanent public URL (required by TikTok PULL_FROM_URL)
  const r2Key = `social/${date}/${filename}`;
  const r2Url = await uploadImageToStorage(composed, r2Key);

  const imagePath = r2Url ?? `/generated/social/${date}/${filename}`;

  logger.info("image_composed", {
    platform,
    contentType,
    cardId: card.card_id ?? "unknown",
    imagePath,
    storage: r2Url ? "r2" : "local",
  });

  return {
    imagePath,
    cardId: card.card_id ?? "",
    cardImageUrl: imageUrl,
    cardPlayer: card.player ?? "",
    cardSet: card.set ?? "",
    cardPrice: (card.prices as any)?.[0]?.price ?? undefined,
    cardSales7d: (card as any)["7 Day Sales"] ?? (card as any).sales7d ?? undefined,
  };
}
