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
  "TIKTOK_ONLY_REAL_FANS",
  "TIKTOK_DIFFICULTY_LADDER",
  "TIKTOK_MEMORY_SHOCK",
  "TIKTOK_PACK_PULL_DRAMA",
  "TIKTOK_LEADERBOARD_FLEX",
  "TIKTOK_ERA_WARS",
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
    "INSTAGRAM_POST", "FACEBOOK_POST", "DAILY5_ANNOUNCEMENT", "DAILY5_RECAP", "LEADERBOARD_SPOTLIGHT",
    "TIKTOK_DAILY5_ANNOUNCEMENT", "TIKTOK_TRIVIA_CHALLENGE",
    "TIKTOK_LEADERBOARD_SPOTLIGHT", "TIKTOK_STREAK_REMINDER",
  ]),
  platform: z.enum(["discord", "reddit", "x", "tiktok", "instagram", "facebook", "youtube"]),
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

export const ViralSceneSchema = z.object({
  sceneId: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  overlayText: z.string(),
  overlayColor: z.string().default("#FFFFFF"),
});

export const ViralCardRefSchema = z.object({
  cardId: z.string(),
  player: z.string(),
  set: z.string(),
  year: z.number(),
  imageUrl: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  era: z.string().optional(),
});

export const ViralSafetyFlagsSchema = z.object({
  no_gambling_language: z.boolean().default(true),
  no_prize_guarantees: z.boolean().default(true),
});

export const ViralTikTokPackageSchema = TikTokPackageSchema.extend({
  format_id: z.enum([
    "only_real_fans", "difficulty_ladder", "memory_shock",
    "pack_pull_drama", "leaderboard_flex", "era_wars",
  ]),
  scenes: z.array(ViralSceneSchema).optional(),
  render_template_id: z.string(),
  cards: z.array(ViralCardRefSchema).optional(),
  engagement_goal: z.enum(["comments", "shares", "replays", "conversion"]).optional(),
  safety_flags: ViralSafetyFlagsSchema.default({ no_gambling_language: true, no_prize_guarantees: true }),
});
export type ViralTikTokPackage = z.infer<typeof ViralTikTokPackageSchema>;

export function validateViralTikTokPackage(data: unknown, label: string): ViralTikTokPackage {
  const result = ViralTikTokPackageSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`[${label}] Viral TikTok package validation failed: ${errors}`);
  }
  return result.data;
}

const COMPLIANCE_BANNED_PHRASES = [
  /\bguaranteed?\b/i, /\bfree money\b/i, /\bwin big\b/i,
  /\bjackpot\b/i, /\bcash out\b/i, /\bbet\b/i, /\bgambl/i,
  /\bprize\s+(money|cash)\b/i, /\bmake\s+money\b/i,
  /\bget\s+rich\b/i, /\bno\s+risk\b/i,
];

export function checkTikTokCompliance(pkg: TikTokPackage | ViralTikTokPackage): { pass: boolean; issues: string[] } {
  const issues: string[] = [];
  const textsToCheck = [pkg.hook, pkg.script, pkg.caption, pkg.cta, ...(pkg.on_screen_text || [])];

  for (const text of textsToCheck) {
    for (const pattern of COMPLIANCE_BANNED_PHRASES) {
      if (pattern.test(text)) {
        issues.push(`Banned phrase found: "${pattern.source}" in text: "${text.slice(0, 60)}..."`);
      }
    }
  }

  if (pkg.caption && pkg.caption.length > 200) {
    issues.push(`Caption exceeds preferred 200 chars (${pkg.caption.length} chars)`);
  }

  if (!pkg.cta || pkg.cta.length < 5) {
    issues.push("Missing or too-short CTA");
  }

  const safetyFlags = (pkg as any).safety_flags || pkg.legal_safe;
  if (safetyFlags && !safetyFlags.no_gambling_language) {
    issues.push("safety_flags.no_gambling_language must be true");
  }
  if (safetyFlags && !safetyFlags.no_prize_guarantees) {
    issues.push("safety_flags.no_prize_guarantees must be true");
  }

  return { pass: issues.length === 0, issues };
}

export const VIRAL_TIKTOK_PACKAGE_JSON_HINT = `{
  "hook": "string (1-line attention grabber)",
  "script": "string (voiceover script)",
  "on_screen_text": ["overlay line 1", "overlay line 2"],
  "caption": "string (max 200 chars preferred)",
  "hashtags": ["#packpts", "#baseballcards", ...],
  "cta": "string (call to action)",
  "thumbnail_text": "string (max 6 words)",
  "format_notes": "string",
  "audio_notes": "string",
  "asset_refs": [],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "string",
  "format_id": "string (the format id)",
  "scenes": [{ "sceneId": "string", "startSec": 0, "endSec": 2, "overlayText": "string", "overlayColor": "#FFFFFF" }],
  "render_template_id": "string (template id for video factory)",
  "cards": [{ "cardId": "string", "player": "string", "set": "string", "year": 2024, "imageUrl": "string", "difficulty": "easy|medium|hard", "era": "string" }],
  "engagement_goal": "comments|shares|replays|conversion",
  "safety_flags": { "no_gambling_language": true, "no_prize_guarantees": true }
}`;
