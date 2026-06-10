import { db } from "../../db";
import { socialPosts } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { createLogger } from "./logger";

const logger = createLogger("Preflight");

// Phrases that signal the copy references a visual stimulus
const VISUAL_REFERENCE_PATTERNS = [
  /\bcard\b/i,
  /\bphoto\b/i,
  /\bpicture\b/i,
  /\bscreenshot\b/i,
  /\bcan you (name|guess|identify)\b/i,
  /\bdo you know (this|who)\b/i,
  /\bspot (is|the)\b/i,
  /\bhottest\b/i,
  /\bcheck (this|it) out\b/i,
  /\blook at (this|that)\b/i,
];

// Only content types that require a card image to make sense — all others publish as text-only tweets.
const VISUAL_CONTENT_TYPES = new Set([
  "TRIVIA_CARD",
  "MARKET_PRICE_SPOTLIGHT",
]);

export function detectsVisualReference(copyText: string): boolean {
  return VISUAL_REFERENCE_PATTERNS.some((re) => re.test(copyText));
}

export function isVisualContentType(contentType: string): boolean {
  return VISUAL_CONTENT_TYPES.has(contentType);
}

interface PreflightResult {
  blocked: boolean;
  reason?: string;
}

export function validatePostForPublishing(post: {
  copyText: string;
  contentType: string;
  composedImagePath?: string | null;
  mediaRequired?: boolean | null;
}): PreflightResult {
  const visualType = isVisualContentType(post.contentType);
  const visualCopy = detectsVisualReference(post.copyText);
  const needsMedia = post.mediaRequired || visualType || visualCopy;
  const hasMedia = !!post.composedImagePath;

  if (needsMedia && !hasMedia) {
    const reason = post.mediaRequired
      ? "media_required=true but no composed image"
      : visualType
      ? `content_type ${post.contentType} requires media`
      : "copy references visual content but no media attached";
    return { blocked: true, reason };
  }

  return { blocked: false };
}

/**
 * Finds all QUEUED posts that reference visual content without an attached image
 * and marks them BLOCKED. Run on startup or as an admin action.
 */
export async function auditBlockedPosts(): Promise<{ blocked: number }> {
  const queued = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.status, "QUEUED"));

  let blocked = 0;
  for (const post of queued) {
    const result = validatePostForPublishing({
      copyText: post.copyText,
      contentType: post.contentType,
      composedImagePath: post.composedImagePath,
      mediaRequired: post.mediaRequired,
    });

    if (result.blocked) {
      await db
        .update(socialPosts)
        .set({
          status: "BLOCKED",
          publishBlockReason: result.reason,
          preflightPassed: false,
          updatedAt: new Date(),
        })
        .where(and(eq(socialPosts.id, post.id), eq(socialPosts.status, "QUEUED")));
      blocked++;
      logger.warn("post_blocked_by_audit", { postId: post.id, reason: result.reason });
    }
  }

  logger.info("audit_complete", { scanned: queued.length, blocked });
  return { blocked };
}
