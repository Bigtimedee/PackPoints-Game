import { z } from "zod";

export const ContentPieceSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  body: z.string().min(1, "Body is required").max(5000),
  hashtags: z.array(z.string().max(100)).max(30).default([]),
});
export type ContentPiece = z.infer<typeof ContentPieceSchema>;

export const TIKTOK_CONTENT_TYPES = [
  "TIKTOK_DAILY5_ANNOUNCEMENT",
  "TIKTOK_TRIVIA_CHALLENGE",
  "TIKTOK_LEADERBOARD_SPOTLIGHT",
  "TIKTOK_STREAK_REMINDER",
] as const;
export type TikTokContentType = typeof TIKTOK_CONTENT_TYPES[number];

export const TikTokAssetRefSchema = z.object({
  type: z.enum(["card_image", "screenshot", "gif"]),
  card_id: z.string().optional(),
  url: z.string().optional(),
  path: z.string().optional(),
});

export const TikTokLegalSafeSchema = z.object({
  no_gambling_language: z.boolean().default(true),
  no_prize_guarantees: z.boolean().default(true),
});

export const TikTokPackageSchema = z.object({
  hook: z.string().min(1, "Hook is required").max(500),
  script: z.string().min(1, "Script is required").max(3000),
  on_screen_text: z.array(z.string().max(200)).max(10).default([]),
  caption: z.string().min(1, "Caption is required").max(2200),
  hashtags: z.array(z.string().max(100)).min(1).max(20),
  cta: z.string().min(1, "CTA is required").max(500),
  thumbnail_text: z.string().max(50).default(""),
  format_notes: z.string().max(2000).default(""),
  audio_notes: z.string().max(1000).default(""),
  asset_refs: z.array(TikTokAssetRefSchema).max(10).default([]),
  legal_safe: TikTokLegalSafeSchema.default({ no_gambling_language: true, no_prize_guarantees: true }),
  dedupe_key: z.string().min(1, "Dedupe key is required"),
});
export type TikTokPackage = z.infer<typeof TikTokPackageSchema>;

export const PlanItemSchema = z.object({
  type: z.enum([
    "DISCORD_POST", "REDDIT_POST", "X_THREAD", "SHORT_VIDEO_SCRIPT",
    "INSTAGRAM_POST", "DAILY5_ANNOUNCEMENT", "DAILY5_RECAP", "LEADERBOARD_SPOTLIGHT",
    "TIKTOK_DAILY5_ANNOUNCEMENT", "TIKTOK_TRIVIA_CHALLENGE",
    "TIKTOK_LEADERBOARD_SPOTLIGHT", "TIKTOK_STREAK_REMINDER",
  ]),
  platform: z.enum(["discord", "reddit", "x", "tiktok", "instagram", "youtube"]),
  brief: z.string().min(1),
  postingMode: z.enum(["AUTO", "MANUAL_QUEUE"]),
});

export const PlanOutputSchema = z.object({
  theme: z.string().min(1, "Theme is required").max(200),
  items: z.array(PlanItemSchema).min(1, "At least one content item required").max(10),
});
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

export const VideoScriptSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(3000),
  hashtags: z.array(z.string().max(100)).max(30).default([]),
});
export type VideoScript = z.infer<typeof VideoScriptSchema>;

export const XThreadSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  hashtags: z.array(z.string().max(100)).max(10).default([]),
});
export type XThread = z.infer<typeof XThreadSchema>;

export function validateWithSchema<T>(schema: z.ZodSchema<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    console.warn(`[GrowthSchemaValidation] ${label} validation issues: ${errors}`);
    const coerced = schema.safeParse({
      ...((data && typeof data === "object") ? data : {}),
      title: (data as any)?.title || "Untitled",
      body: (data as any)?.body || (data as any)?.text || (data as any)?.content || "",
      hashtags: Array.isArray((data as any)?.hashtags) ? (data as any).hashtags : [],
    });
    if (coerced.success) return coerced.data;
    throw new Error(`[${label}] AI response failed validation: ${errors}`);
  }
  return result.data;
}

export function getSchemaForPlatform(platform: string): z.ZodSchema {
  switch (platform) {
    case "x":
      return XThreadSchema;
    case "youtube":
      return VideoScriptSchema;
    default:
      return ContentPieceSchema;
  }
}

export function getSchemaJsonHint(platform: string): string {
  switch (platform) {
    case "x":
      return '{"title": "string", "body": "string (tweets separated by \\n---\\n)", "hashtags": ["string"]}';
    case "youtube":
      return '{"title": "string", "body": "string (HOOK: ...\\nBODY: ...\\nCTA: ...)", "hashtags": ["string"]}';
    default:
      return '{"title": "string", "body": "string", "hashtags": ["string"]}';
  }
}

export const TIKTOK_PACKAGE_JSON_HINT = `{
  "hook": "string (1-line attention grabber)",
  "script": "string (voiceover script, 15-35 seconds)",
  "on_screen_text": ["overlay line 1", "overlay line 2"],
  "caption": "string (max 2200 chars, prefer under 200)",
  "hashtags": ["#packpts", "#baseballcards", ...],
  "cta": "string (call to action)",
  "thumbnail_text": "string (max 6 words)",
  "format_notes": "string (shot list, timing, transitions)",
  "audio_notes": "string (background music / sound effects)",
  "asset_refs": [],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "string"
}`;

export function validateTikTokPackage(data: unknown, label: string): TikTokPackage {
  const result = TikTokPackageSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`[${label}] TikTok package validation failed: ${errors}`);
  }
  return result.data;
}
