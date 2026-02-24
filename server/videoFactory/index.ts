import { db } from "../db";
import { growthContentItems, publishingQueue } from "@shared/schema";
import { eq } from "drizzle-orm";
import { validateAndPrepareImage, isPlaceholderUrl } from "./validate";
import { renderClassicCountdown, type RenderInput, type RenderOutput } from "./render";
import { getRendererForTemplate, type MultiCardRenderInput, type RenderOutput as MultiRenderOutput } from "./renderFormats";
import { generateVoiceover, buildVoiceoverText, isTTSEnabled } from "./tts";
import { getTemplate, getAvailableTemplates } from "./templates";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { FFMPEG_PATH } from "./ffmpegPath";

const VIDEO_OUTPUT_BASE = path.resolve("public/generated/videos");

let ffmpegAvailable = false;
let ffmpegVersion = "unknown";

export function isVideoFactoryEnabled(): boolean {
  return process.env.VIDEO_FACTORY_ENABLED === "true";
}

export function isFFmpegAvailable(): boolean {
  return ffmpegAvailable;
}

export function getVideoFactoryConfig() {
  return {
    enabled: isVideoFactoryEnabled(),
    renderingAvailable: ffmpegAvailable,
    ffmpegVersion,
    ttsEnabled: isTTSEnabled(),
    availableTemplates: getAvailableTemplates(),
    outputDir: VIDEO_OUTPUT_BASE,
  };
}

export function verifyFFmpeg(): boolean {
  try {
    const result = execSync(`${FFMPEG_PATH} -version`, { encoding: "utf-8", timeout: 5000 });
    const version = result.split("\n")[0] || "unknown";
    console.log(`[VideoFactory] FFmpeg verified: ${version}`);
    ffmpegAvailable = true;
    ffmpegVersion = version;
    return true;
  } catch {
    console.error("[VideoFactory] FFmpeg not found in PATH");
    ffmpegAvailable = false;
    ffmpegVersion = "not installed";
    return false;
  }
}

function getOutputDir(date: string, contentItemId: string): string {
  const dir = path.join(VIDEO_OUTPUT_BASE, date, contentItemId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function resolveCardImageUrl(contentItem: any): string | null {
  const metadata = contentItem.metadata as Record<string, any> | null;
  if (!metadata) return null;

  if (metadata.asset_refs && Array.isArray(metadata.asset_refs)) {
    for (const ref of metadata.asset_refs) {
      if (ref.url && ref.type === "card_image") {
        return ref.url;
      }
    }
    for (const ref of metadata.asset_refs) {
      if (ref.url) return ref.url;
    }
  }

  if (metadata.cardImageUrl) return metadata.cardImageUrl;
  if (metadata.imageUrl) return metadata.imageUrl;

  return null;
}

export interface GenerateVideoResult {
  success: boolean;
  videoPath?: string;
  thumbnailPath?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  sizeBytes?: number;
  error?: string;
}

export async function generateVideoForContentItem(
  contentItemId: string,
  options?: {
    templateId?: string;
    forceRerender?: boolean;
    cardImageUrl?: string;
  }
): Promise<GenerateVideoResult> {
  if (!isVideoFactoryEnabled()) {
    return { success: false, error: "Video Factory is disabled (set VIDEO_FACTORY_ENABLED=true)" };
  }

  if (!ffmpegAvailable) {
    return { success: false, error: "FFmpeg is not available in this environment. Video rendering is disabled." };
  }

  const [contentItem] = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.id, contentItemId))
    .limit(1);

  if (!contentItem) {
    return { success: false, error: `Content item ${contentItemId} not found` };
  }

  const metadata = (contentItem.metadata as Record<string, any>) || {};

  if (metadata.video_asset && !options?.forceRerender) {
    return {
      success: true,
      videoPath: metadata.video_asset.path,
      thumbnailPath: metadata.video_asset.thumbnailPath,
      videoUrl: metadata.video_asset.url,
      thumbnailUrl: metadata.video_asset.thumbnailUrl,
      durationSec: metadata.video_asset.durationSec,
      sizeBytes: metadata.video_asset.sizeBytes,
    };
  }

  const templateId = options?.templateId || metadata.render_template_id || metadata.format_id || "classic_countdown";
  const viralRenderer = getRendererForTemplate(templateId);

  const cardImageUrls = resolveAllCardImageUrls(contentItem, options?.cardImageUrl);

  if (cardImageUrls.length === 0) {
    const { url: fallbackUrl } = await findFallbackCardImage();
    if (!fallbackUrl) {
      return { success: false, error: "No card image URL found in content item metadata or fallback" };
    }
    cardImageUrls.push(fallbackUrl);
  }

  const date = new Date().toISOString().slice(0, 10);
  const outputDir = getOutputDir(date, contentItemId);

  try {
    console.log(`[VideoFactory] Starting video generation for ${contentItemId} (template: ${templateId})`);

    const maskedPaths: string[] = [];
    const tempPaths: string[] = [];

    for (let i = 0; i < cardImageUrls.length; i++) {
      const imgUrl = cardImageUrls[i];
      console.log(`[VideoFactory] Preparing card image ${i + 1}/${cardImageUrls.length}: ${imgUrl}`);
      const imageResult = await validateAndPrepareImage(imgUrl, outputDir);
      maskedPaths.push(imageResult.maskedImagePath);
      tempPaths.push(imageResult.originalPath, imageResult.maskedImagePath);
    }

    const hookText = metadata.hook || contentItem.title || "Can you name this player?";
    const answerTexts = extractAnswerTexts(metadata);
    const ctaText = metadata.cta || "Play PackPTS.com \u2022 Daily 5 Challenge";

    let voiceAudioPath: string | null = null;
    if (isTTSEnabled()) {
      const voiceText = buildVoiceoverText({ hookText, answerText: answerTexts[0] || "???", ctaText });
      voiceAudioPath = await generateVoiceover(voiceText, path.join(outputDir, "voice.mp3"));
    }

    const template = getTemplate(templateId);
    const durationSec = template?.durationSec || 12;

    let renderOutput: RenderOutput;

    if (viralRenderer) {
      const multiInput: MultiCardRenderInput = {
        cardImagePaths: maskedPaths,
        templateId,
        hookText,
        answerTexts,
        ctaText,
        outputDir,
        durationSec,
        voiceAudioPath,
        leaderboardLines: metadata.leaderboard_lines || undefined,
        eraLabel: metadata.era_label || undefined,
        extraOverlays: metadata.extra_overlays || undefined,
        width: 1080,
        height: 1920,
      };
      renderOutput = await viralRenderer(multiInput);
    } else {
      const renderInput: RenderInput = {
        cardImagePath: maskedPaths[0],
        hookText,
        answerText: answerTexts[0] || "???",
        ctaText,
        outputDir,
        templateId,
        durationSec,
        voiceAudioPath,
        width: 1080,
        height: 1920,
      };
      renderOutput = await renderClassicCountdown(renderInput);
    }

    console.log(`[VideoFactory] Render complete: ${renderOutput.videoPath} (${Math.round(renderOutput.sizeBytes / 1024)}KB)`);

    const videoUrl = `/generated/videos/${date}/${contentItemId}/output.mp4`;
    const thumbnailUrl = `/generated/videos/${date}/${contentItemId}/thumbnail.jpg`;

    const videoAsset = {
      path: renderOutput.videoPath,
      thumbnailPath: renderOutput.thumbnailPath,
      url: videoUrl,
      thumbnailUrl: thumbnailUrl,
      durationSec: renderOutput.durationSec,
      sizeBytes: renderOutput.sizeBytes,
      width: renderOutput.width,
      height: renderOutput.height,
      templateId: templateId,
      createdAt: new Date().toISOString(),
    };

    await db.update(growthContentItems).set({
      metadata: { ...metadata, video_asset: videoAsset },
      updatedAt: new Date(),
    }).where(eq(growthContentItems.id, contentItemId));

    const [queueItem] = await db.select().from(publishingQueue)
      .where(eq(publishingQueue.contentItemId, contentItemId))
      .limit(1);

    if (queueItem) {
      const queueAssets = (queueItem.assets as Record<string, any>) || {};
      await db.update(publishingQueue).set({
        assets: {
          ...queueAssets,
          video_asset: videoAsset,
        },
      }).where(eq(publishingQueue.id, queueItem.id));
    }

    try {
      for (const tp of tempPaths) {
        if (fs.existsSync(tp)) fs.unlinkSync(tp);
      }
    } catch {}

    return {
      success: true,
      videoPath: renderOutput.videoPath,
      thumbnailPath: renderOutput.thumbnailPath,
      videoUrl,
      thumbnailUrl,
      durationSec: renderOutput.durationSec,
      sizeBytes: renderOutput.sizeBytes,
    };
  } catch (err: any) {
    console.error(`[VideoFactory] Generation failed for ${contentItemId}:`, err?.message);

    const prevRetryCount = (metadata.video_error?.retry_count as number) || 0;

    await db.update(growthContentItems).set({
      metadata: {
        ...metadata,
        video_error: {
          message: err?.message,
          at: new Date().toISOString(),
          retry_count: prevRetryCount + (options?.forceRerender ? 1 : 0),
        },
      },
      updatedAt: new Date(),
    }).where(eq(growthContentItems.id, contentItemId));

    return { success: false, error: err?.message };
  }
}

function extractPlayerName(metadata: Record<string, any>): string | null {
  if (metadata.player_name) return metadata.player_name;
  if (metadata.answerText) return metadata.answerText;
  if (metadata.answer) return metadata.answer;
  return null;
}

function extractAnswerTexts(metadata: Record<string, any>): string[] {
  if (metadata.cards && Array.isArray(metadata.cards)) {
    return metadata.cards.map((c: any) => c.player || c.answer || "???");
  }
  const single = metadata.answer || extractPlayerName(metadata) || "???";
  return [single];
}

function resolveAllCardImageUrls(contentItem: any, overrideUrl?: string): string[] {
  const metadata = (contentItem.metadata as Record<string, any>) || {};

  if (overrideUrl) return [overrideUrl];

  if (metadata.cards && Array.isArray(metadata.cards)) {
    const urls = metadata.cards
      .map((c: any) => c.imageUrl || c.image_url || c.url)
      .filter((u: string) => u && !isPlaceholderUrl(u));
    if (urls.length > 0) return urls;
  }

  const singleUrl = resolveCardImageUrl(contentItem);
  if (singleUrl) return [singleUrl];

  return [];
}

async function findFallbackCardImage(): Promise<{ url: string } | { url: null }> {
  try {
    const { playableCards } = await import("@shared/schema");
    const cards = await db.select({
      id: playableCards.id,
      imageUrl: playableCards.imageUrl,
    })
      .from(playableCards)
      .where(eq(playableCards.isPlayable, true))
      .limit(10);

    for (const card of cards) {
      if (card.imageUrl && !isPlaceholderUrl(card.imageUrl)) {
        return { url: card.imageUrl };
      }
    }
  } catch {}
  return { url: null };
}
