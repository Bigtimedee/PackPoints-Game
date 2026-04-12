/**
 * contentGenerator.ts
 *
 * Generates individual content items (captions, scripts, hooks, hashtags, etc.)
 * from a content plan. TikTok items are always manual-mode only (no direct posting).
 */
import OpenAI from "openai";
import type { ContentPlanOutput, PlatformTargets } from "./planGenerator";
import type { InsertGrowthContentItem } from "@shared/schema";

export type GrowthPlatform = "TIKTOK" | "INSTAGRAM" | "X" | "REDDIT";
export type GrowthContentType = "SCORE_HIGHLIGHT" | "STREAK_MILESTONE" | "CHALLENGE_RECAP" | "GENERAL";

export interface GeneratedItem {
  platform: GrowthPlatform;
  contentType: GrowthContentType;
  caption: string;
  hashtags: string[];
  hook: string;
  script?: string;
  overlayText?: string;
  cta: string;
  assetRefs: { label: string; description: string }[];
  metadata: Record<string, unknown>;
}

function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

const CONTENT_PAIRS: { platform: GrowthPlatform; contentType: GrowthContentType }[] = [
  { platform: "TIKTOK", contentType: "SCORE_HIGHLIGHT" },
  { platform: "TIKTOK", contentType: "STREAK_MILESTONE" },
  { platform: "TIKTOK", contentType: "CHALLENGE_RECAP" },
  { platform: "INSTAGRAM", contentType: "SCORE_HIGHLIGHT" },
  { platform: "INSTAGRAM", contentType: "GENERAL" },
  { platform: "X", contentType: "SCORE_HIGHLIGHT" },
  { platform: "X", contentType: "CHALLENGE_RECAP" },
  { platform: "REDDIT", contentType: "GENERAL" },
];

function platformPrompt(platform: GrowthPlatform, contentType: GrowthContentType, themes: string[]): string {
  const themeList = themes.slice(0, 3).join(", ");

  const platformInstructions: Record<GrowthPlatform, string> = {
    TIKTOK: `TikTok video content (MANUAL POSTING — provide script for human to record).
Format: short-form vertical video (15-60s). Include hook, script, overlay text for each scene, and CTA.`,
    INSTAGRAM: `Instagram post (image + caption). Include caption with line breaks, 5-10 hashtags, and a CTA in the caption.`,
    X: `X (Twitter) post. Max 280 characters for caption. Include 2-4 hashtags. Short, punchy, conversational.`,
    REDDIT: `Reddit post for r/baseballcards or r/sportscards. Include a title (caption field), body text (script field), no hashtags, community-first tone.`,
  };

  const contentTypeInstructions: Record<GrowthContentType, string> = {
    SCORE_HIGHLIGHT: "Celebrate an impressive score (e.g., 1200+ points, perfect accuracy) in a recent game.",
    STREAK_MILESTONE: "Celebrate a player hitting a streak milestone (7, 14, or 30 days).",
    CHALLENGE_RECAP: "Recap the latest Daily 5 challenge results, tease tomorrow's challenge.",
    GENERAL: "General brand awareness content about PackPTS and its baseball card trivia gameplay.",
  };

  return `You are a social media content creator for PackPTS, a baseball card trivia game app.

Platform: ${platform}
Content type: ${contentType}
Today's themes: ${themeList}

${platformInstructions[platform]}

Content focus: ${contentTypeInstructions[contentType]}

Return valid JSON matching this exact schema:
{
  "caption": "string",
  "hashtags": ["string"],
  "hook": "string",
  "script": "string or null",
  "overlayText": "string or null",
  "cta": "string",
  "assetRefs": [{ "label": "string", "description": "string" }],
  "metadata": {}
}

assetRefs: describe what visual assets should accompany this post (e.g., score card screenshot, streak badge).
For TikTok: script is a full spoken word script with scene directions in [brackets].
Be specific, engaging, and authentic.`;
}

export async function generateContentItems(
  planId: string,
  plan: ContentPlanOutput,
): Promise<Omit<InsertGrowthContentItem, "planId">[]> {
  const openai = getOpenAIClient();
  const platforms = plan.platformTargets as PlatformTargets;

  const activePairs = CONTENT_PAIRS.filter((p) => platforms[p.platform]);
  const results: Omit<InsertGrowthContentItem, "planId">[] = [];

  for (const { platform, contentType } of activePairs) {
    try {
      const prompt = platformPrompt(platform, contentType, plan.themes);
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.85,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      let parsed: Partial<GeneratedItem> = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }

      results.push({
        platform,
        contentType,
        status: "DRAFT",
        caption: parsed.caption ?? null,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
        hook: parsed.hook ?? null,
        script: parsed.script ?? null,
        overlayText: parsed.overlayText ?? null,
        cta: parsed.cta ?? null,
        assetRefs: Array.isArray(parsed.assetRefs) ? parsed.assetRefs : [],
        metadata: typeof parsed.metadata === "object" && parsed.metadata !== null ? parsed.metadata : {},
        errorMessage: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        platform,
        contentType,
        status: "FAILED",
        caption: null,
        hashtags: [],
        hook: null,
        script: null,
        overlayText: null,
        cta: null,
        assetRefs: [],
        metadata: {},
        errorMessage: message,
      });
    }
  }

  return results;
}
