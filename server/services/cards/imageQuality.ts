import { db } from "../../db";
import { cardImageQuarantine } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const PLACEHOLDER_URL_MARKERS = [
  "example.jpg",
  "example.png",
  "placeholder",
  "stock",
  "appforest",
  "default",
  "noimage",
  "no-image",
  "/example",
  "silhouette",
  "fallback",
  "blank",
  "missing",
  "notfound",
  "not-found",
  "image-not",
  "unavailable",
];

const ALLOWED_IMAGE_HOSTS = [
  "s3.amazonaws.com",
  "s3.us-east-1.amazonaws.com",
  "s3.us-west-2.amazonaws.com",
  "cardhedger.com",
  "cdn.cardhedger.com",
  "images.cardhedger.com",
  "cloudfront.net",
  "d1",
  "d2",
  "d3",
  "psacard.com",
  "beckett.com",
  "ebayimg.com",
  "i.ebayimg.com",
  "images.collector-cdn.com",
  "cdn.bubble.io",
];

export function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string" || url.trim() === "") {
    return null;
  }

  let normalized = url.trim();

  if (normalized.startsWith("//")) {
    normalized = "https:" + normalized;
  }

  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }

  return normalized;
}

export interface PlaceholderCheckMeta {
  description?: string | null;
  set?: string | null;
  player?: string | null;
}

export function isPlaceholderImage(
  url: string | null | undefined,
  meta?: PlaceholderCheckMeta
): boolean {
  if (!url || typeof url !== "string") {
    return true;
  }

  const normalized = normalizeImageUrl(url);
  if (!normalized) {
    return true;
  }

  if (normalized.length < 20) {
    return true;
  }

  const lowerUrl = normalized.toLowerCase();
  for (const marker of PLACEHOLDER_URL_MARKERS) {
    if (lowerUrl.includes(marker)) {
      console.warn(`[ImageQuality] Placeholder detected via marker "${marker}" in URL: ${url}`);
      return true;
    }
  }

  if (meta?.description) {
    const lowerDesc = meta.description.toLowerCase();
    if (lowerDesc.includes("example") || lowerDesc.includes("placeholder")) {
      console.warn(`[ImageQuality] Placeholder detected in description: ${meta.description}`);
      return true;
    }
  }

  try {
    const urlObj = new URL(normalized);
    const host = urlObj.hostname.toLowerCase();
    
    const isAllowedHost = ALLOWED_IMAGE_HOSTS.some(
      (allowed) => host.includes(allowed) || host.endsWith("." + allowed)
    );
    
    if (!isAllowedHost && !host.includes("amazonaws") && !host.includes("cloudfront")) {
      console.warn(`[ImageQuality] Unknown image host: ${host} for URL: ${url}`);
    }
  } catch {
  }

  return false;
}

export interface CardForImageCheck {
  card_id?: string;
  cardId?: string;
  image?: string | null;
  imageUrl?: string | null;
  raw_image?: string | null;
  description?: string | null;
  set?: string | null;
  player?: string | null;
}

export function cardHasRealImage(card: CardForImageCheck): boolean {
  const cardId = card.card_id || card.cardId;
  const imageUrl = card.raw_image || card.image || card.imageUrl;

  if (!imageUrl) {
    console.warn(`[ImageQuality] Card ${cardId} has no image URL`);
    return false;
  }

  const normalized = normalizeImageUrl(imageUrl);
  if (!normalized) {
    console.warn(`[ImageQuality] Card ${cardId} has invalid image URL: ${imageUrl}`);
    return false;
  }

  const isPlaceholder = isPlaceholderImage(normalized, {
    description: card.description,
    set: card.set,
    player: card.player,
  });

  if (isPlaceholder) {
    console.warn(`[ImageQuality] Card ${cardId} has placeholder image: ${imageUrl}`);
    return false;
  }

  return true;
}

export async function quarantineCard(
  cardId: string,
  reason: string,
  imageUrl?: string | null
): Promise<void> {
  try {
    await db
      .insert(cardImageQuarantine)
      .values({
        cardId,
        reason,
        imageUrl: imageUrl || null,
      })
      .onConflictDoUpdate({
        target: cardImageQuarantine.cardId,
        set: {
          lastSeenAt: new Date(),
          seenCount: sql`${cardImageQuarantine.seenCount} + 1`,
          reason,
          imageUrl: imageUrl || null,
        },
      });

    console.warn(`[ImageQuality] Quarantined card ${cardId}: ${reason}`);
  } catch (error) {
    console.error(`[ImageQuality] Failed to quarantine card ${cardId}:`, error);
  }
}

export async function isCardQuarantined(cardId: string): Promise<boolean> {
  const [quarantined] = await db
    .select({ cardId: cardImageQuarantine.cardId })
    .from(cardImageQuarantine)
    .where(eq(cardImageQuarantine.cardId, cardId))
    .limit(1);

  return !!quarantined;
}

export async function getQuarantinedCardIds(): Promise<Set<string>> {
  const rows = await db
    .select({ cardId: cardImageQuarantine.cardId })
    .from(cardImageQuarantine);

  return new Set(rows.map((r) => r.cardId));
}

export async function removeFromQuarantine(cardId: string): Promise<void> {
  await db
    .delete(cardImageQuarantine)
    .where(eq(cardImageQuarantine.cardId, cardId));

  console.info(`[ImageQuality] Removed card ${cardId} from quarantine`);
}
