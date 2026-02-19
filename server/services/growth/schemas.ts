import { z } from "zod";

export const ContentPieceSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  body: z.string().min(1, "Body is required").max(5000),
  hashtags: z.array(z.string().max(100)).max(30).default([]),
});
export type ContentPiece = z.infer<typeof ContentPieceSchema>;

export const PlanItemSchema = z.object({
  type: z.enum([
    "DISCORD_POST", "REDDIT_POST", "X_THREAD", "SHORT_VIDEO_SCRIPT",
    "INSTAGRAM_POST", "DAILY5_ANNOUNCEMENT", "DAILY5_RECAP", "LEADERBOARD_SPOTLIGHT",
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
    case "tiktok":
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
    case "tiktok":
    case "youtube":
      return '{"title": "string", "body": "string (HOOK: ...\\nBODY: ...\\nCTA: ...)", "hashtags": ["string"]}';
    default:
      return '{"title": "string", "body": "string", "hashtags": ["string"]}';
  }
}
