/**
 * videoFactory/index.ts
 *
 * Public entry point for the Video Factory service.
 *
 * Workflow:
 *  1. Load the growthContentItem from the DB (via contentItemId).
 *  2. Select the correct SVG template based on contentType.
 *  3. Build the VideoFrame array.
 *  4. Call compositeVideo() → MP4.
 *  5. Call captureThumbnail() → JPEG.
 *  6. Persist videoUrl / thumbnailUrl / renderStatus into metadata JSONB.
 *  7. Return the render result.
 *
 * Storage paths (served statically):
 *   MP4:       public/generated/videos/{itemId}.mp4
 *   Thumbnail: public/generated/videos/{itemId}-thumb.jpg
 *   URL prefix: /generated/videos/
 */
import path from "path";
import { db } from "../../db";
import { growthContentItems } from "@shared/schema";
import { eq } from "drizzle-orm";
import { compositeVideo, captureThumbnail, type VideoFrame } from "./compositor";
import { buildFrames as buildOnlyRealFans } from "./templates/onlyRealFans";
import { buildFrames as buildDifficultyLadder } from "./templates/difficultyLadder";
import { buildFrames as buildMemoryShock } from "./templates/memoryShock";
import { buildFrames as buildLeaderboardFlex } from "./templates/leaderboardFlex";

// ── Constants ──────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve(process.cwd(), "public", "generated", "videos");
const URL_PREFIX = "/generated/videos";

// ── Types ──────────────────────────────────────────────────────────────────

export type RenderStatus = "PENDING" | "RENDERING" | "DONE" | "ERROR";

export interface VideoMetadata {
  videoUrl?: string;
  thumbnailUrl?: string;
  renderStatus: RenderStatus;
  renderError?: string;
  template?: string;
  renderedAt?: string;
}

export interface RenderResult {
  contentItemId: string;
  videoUrl: string;
  thumbnailUrl: string;
  template: string;
}

// ── Template selection ─────────────────────────────────────────────────────

type ContentItemInput = {
  hook: string;
  script: string;
  overlayText: string;
  cta: string;
  caption: string;
};

type TemplateName =
  | "only-real-fans"
  | "difficulty-ladder"
  | "memory-shock"
  | "leaderboard-flex";

function selectTemplate(contentType: string): {
  name: TemplateName;
  buildFrames: (item: ContentItemInput) => VideoFrame[];
} {
  switch (contentType) {
    case "SCORE_HIGHLIGHT":
      return { name: "only-real-fans", buildFrames: buildOnlyRealFans };
    case "CHALLENGE_RECAP":
      return { name: "difficulty-ladder", buildFrames: buildDifficultyLadder };
    case "STREAK_MILESTONE":
      return { name: "memory-shock", buildFrames: buildMemoryShock };
    default:
      return { name: "leaderboard-flex", buildFrames: buildLeaderboardFlex };
  }
}

// ── Metadata helpers ───────────────────────────────────────────────────────

function currentMetadata(raw: unknown): VideoMetadata {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as VideoMetadata;
  }
  return { renderStatus: "PENDING" };
}

async function setMetadata(
  itemId: string,
  patch: Partial<VideoMetadata>,
  existing: VideoMetadata,
): Promise<void> {
  const updated: VideoMetadata = { ...existing, ...patch };
  await db
    .update(growthContentItems)
    .set({ metadata: updated as Record<string, unknown> })
    .where(eq(growthContentItems.id, itemId));
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Render (or re-render) the MP4 for a growth content item.
 * Sets renderStatus=RENDERING on DB before starting, DONE or ERROR on finish.
 * Throws if the content item is not found.
 */
export async function renderVideo(contentItemId: string): Promise<RenderResult> {
  // 1. Fetch the content item
  const [item] = await db
    .select()
    .from(growthContentItems)
    .where(eq(growthContentItems.id, contentItemId));

  if (!item) {
    throw new Error(`renderVideo: content item ${contentItemId} not found`);
  }

  const existingMeta = currentMetadata(item.metadata);

  // 2. Mark as rendering
  await setMetadata(contentItemId, { renderStatus: "RENDERING" }, existingMeta);

  const videoPath = path.join(OUTPUT_DIR, `${contentItemId}.mp4`);
  const thumbPath = path.join(OUTPUT_DIR, `${contentItemId}-thumb.jpg`);

  const inputData: ContentItemInput = {
    hook: item.hook ?? "",
    script: item.script ?? "",
    overlayText: item.overlayText ?? "",
    cta: item.cta ?? "",
    caption: item.caption ?? "",
  };

  try {
    // 3. Select template and build frames
    const { name: templateName, buildFrames } = selectTemplate(item.contentType ?? "GENERAL");
    const frames: VideoFrame[] = buildFrames(inputData);

    if (frames.length === 0) {
      throw new Error("Template produced zero frames");
    }

    // 4. Render MP4 and thumbnail
    await compositeVideo(frames, videoPath);
    await captureThumbnail(frames[0], thumbPath);

    // 5. Persist success metadata
    const videoUrl = `${URL_PREFIX}/${contentItemId}.mp4`;
    const thumbnailUrl = `${URL_PREFIX}/${contentItemId}-thumb.jpg`;

    await setMetadata(
      contentItemId,
      {
        videoUrl,
        thumbnailUrl,
        renderStatus: "DONE",
        renderError: undefined,
        template: templateName,
        renderedAt: new Date().toISOString(),
      },
      existingMeta,
    );

    return { contentItemId, videoUrl, thumbnailUrl, template: templateName };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    await setMetadata(
      contentItemId,
      {
        renderStatus: "ERROR",
        renderError: message,
      },
      existingMeta,
    ).catch(() => {});

    throw new Error(`renderVideo failed for ${contentItemId}: ${message}`);
  }
}
