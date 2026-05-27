import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { createLogger } from "./logger";
import { uploadImageToStorage } from "./imageStorage";
import { renderGameImage } from "./gameImageRenderer";

const logger = createLogger("ImageComposer");
// Use /tmp so Railway containers (read-only app/) can write generated images
const OUTPUT_BASE = path.join(os.tmpdir(), "packpts-social");

export interface ImageComposeParams {
  platform: "TWITTER" | "TIKTOK" | "DISCORD";
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

async function getOutputDir(date: string): Promise<string> {
  const dir = path.join(OUTPUT_BASE, date);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

export async function composePostImage(params: ImageComposeParams): Promise<ComposedImage> {
  const { platform, contentType, cardQuery, overlayText } = params;

  const result = await renderGameImage(contentType, platform, cardQuery, overlayText);

  const date = new Date().toISOString().slice(0, 10);
  const dir = await getOutputDir(date);
  const filename = `${randomUUID()}.png`;
  const localPath = path.join(dir, filename);
  await fs.promises.writeFile(localPath, result.buffer);

  const r2Key = `social/${date}/${filename}`;
  const r2Url = await uploadImageToStorage(result.buffer, r2Key);

  const imagePath = r2Url ?? localPath;

  logger.info("image_composed", {
    platform,
    contentType,
    cardId: result.cardId ?? "none",
    imagePath,
    storage: r2Url ? "r2" : "local",
  });

  return {
    imagePath,
    cardId: result.cardId ?? "",
    cardImageUrl: result.cardImageUrl ?? "",
    cardPlayer: result.cardPlayer ?? "",
    cardSet: result.cardSet ?? "",
    cardPrice: result.cardPrice,
    cardSales7d: result.cardSales7d,
  };
}
