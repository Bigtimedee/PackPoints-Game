import { randomUUID } from "crypto";
import OpenAI from "openai";
import { z } from "zod";
import type { InsertGrowthContentItem } from "@shared/schema";
import type { RankedGrowthSignal } from "./listen";
import type { CreativePerformance } from "./learn";

export type MandatePlatform = "TIKTOK" | "INSTAGRAM" | "X" | "REDDIT" | "YOUTUBE";

const GeneratedCopySchema = z.object({
  caption: z.string().min(1).max(1800),
  hashtags: z.array(z.string()).max(10).default([]),
  hook: z.string().min(1).max(180),
  script: z.string().max(4000).nullable().optional(),
  overlayText: z.string().max(800).nullable().optional(),
  cta: z.string().min(1).max(240),
});

export type MandateGeneratedItem = Omit<InsertGrowthContentItem, "planId"> & {
  id: string;
};

export function buildTrackedUrl(input: {
  siteUrl: string;
  destinationPath: string;
  platform: string;
  creativeId: string;
}): string {
  const base = input.siteUrl.replace(/\/$/, "");
  const path = input.destinationPath.startsWith("/")
    ? input.destinationPath
    : `/${input.destinationPath}`;
  const url = new URL(base + path);
  url.searchParams.set("utm_source", input.platform.toLowerCase());
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "growth_agent");
  url.searchParams.set("utm_content", input.creativeId);
  return url.toString();
}

export function isApprovedPackptsAsset(assetPath?: string | null): boolean {
  if (!assetPath) return false;
  const value = assetPath.replace(/\\/g, "/");
  return (
    value.startsWith("/generated/share/") ||
    value.includes("/generated/share/") ||
    value.startsWith("/generated/videos/") ||
    value.includes("/generated/videos/") ||
    value.startsWith("/daily5-") ||
    value.includes("/client/public/daily5-") ||
    value.includes("/client/public/assets/brand/") ||
    value.includes("/client/public/assets/play-sets/")
  );
}

function enabledPlatforms(): MandatePlatform[] {
  const platforms: MandatePlatform[] = [];
  if (process.env.GROWTH_TIKTOK_ENABLED !== "false") platforms.push("TIKTOK");
  if (process.env.GROWTH_X_ENABLED === "true") platforms.push("X");
  if (process.env.GROWTH_INSTAGRAM_ENABLED === "true") platforms.push("INSTAGRAM");
  if (process.env.GROWTH_REDDIT_ENABLED === "true") platforms.push("REDDIT");
  if (process.env.GROWTH_YOUTUBE_ENABLED === "true") platforms.push("YOUTUBE");
  return platforms.length > 0 ? platforms : ["TIKTOK"];
}

function contentTypeForSignal(signal: RankedGrowthSignal): string {
  switch (signal.signalType) {
    case "STREAK_MILESTONE":
      return "STREAK_MILESTONE";
    case "DAILY5_MOMENT":
    case "LEADERBOARD_MOMENT":
      return "CHALLENGE_RECAP";
    case "SHAREABLE_ASSET":
      return "SCORE_HIGHLIGHT";
    default:
      return "GENERAL";
  }
}

function destinationForSignal(signal: RankedGrowthSignal): string {
  switch (signal.signalType) {
    case "DAILY5_MOMENT":
    case "LEADERBOARD_MOMENT":
      return "/daily5";
    default:
      return "/game/solo";
  }
}

function platformDirection(platform: MandatePlatform): string {
  switch (platform) {
    case "TIKTOK":
      return "Create a concise vertical video concept with a 1 to 2 second hook, short overlay text, and a direct play CTA.";
    case "YOUTUBE":
      return "Create a YouTube Shorts concept with a fast hook, visual payoff, and direct play CTA.";
    case "INSTAGRAM":
      return "Create an Instagram Reel or image caption that is concise, visual, and challenge oriented.";
    case "X":
      return "Create an X post under 250 characters before the URL. The real PackPTS image or video is mandatory.";
    case "REDDIT":
      return "Create community first copy. Do not sound like an advertisement. The real PackPTS asset is still mandatory.";
  }
}

function fallbackCopy(
  signal: RankedGrowthSignal,
  platform: MandatePlatform,
  trackedUrl: string,
) {
  const hook =
    signal.signalType === "STREAK_MILESTONE"
      ? "How long could you keep your PackPTS streak alive?"
      : signal.signalType === "DAILY5_MOMENT" || signal.signalType === "LEADERBOARD_MOMENT"
      ? "Today's Daily 5 is live."
      : "How well do you know these cards?";

  return {
    caption: `${hook} Play it on PackPTS. ${trackedUrl}`,
    hashtags: platform === "REDDIT" ? [] : ["#PackPTS", "#SportsCards"],
    hook,
    script: platform === "TIKTOK" || platform === "YOUTUBE"
      ? `[Show the attached real PackPTS asset] ${hook} [CTA] Play at PackPTS.com.`
      : null,
    overlayText: hook,
    cta: trackedUrl,
  };
}

async function generateCopy(input: {
  signal: RankedGrowthSignal;
  platform: MandatePlatform;
  trackedUrl: string;
  winnerPatterns: CreativePerformance[];
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallbackCopy(input.signal, input.platform, input.trackedUrl);
  }

  const winnerContext = input.winnerPatterns.slice(0, 3).map((winner) => ({
    platform: winner.platform,
    contentType: winner.contentType,
    qdauPerThousand: winner.qdauPerThousand,
    activations: winner.activations,
    d1Retained: winner.d1Retained,
    d7Retained: winner.d7Retained,
  }));

  const client = new OpenAI({ apiKey });
  const prompt = `You create social content for PackPTS, a sports card knowledge game.

NON NEGOTIABLE RULES
- Use only the factual signal supplied below.
- Never invent a score, player, card, result, streak, leaderboard fact, prize, or user claim.
- A real PackPTS screenshot or video is attached. Write copy that matches that real asset.
- Do not refer to any visual that is not actually attached.
- Do not use gambling language.
- Do not guarantee prizes or financial outcomes.
- The objective is qualified gameplay, not vanity impressions.
- Prefer a playable challenge over generic brand awareness.
- Learn from winning creative patterns but do not copy them verbatim.

PLATFORM
${input.platform}

PLATFORM DIRECTION
${platformDirection(input.platform)}

REAL PRODUCT SIGNAL
${JSON.stringify({
    type: input.signal.signalType,
    title: input.signal.title,
    payload: input.signal.payload ?? {},
  })}

RECENT WINNING PERFORMANCE PATTERNS
${JSON.stringify(winnerContext)}

TRACKED CTA URL
${input.trackedUrl}

Return JSON only:
{
  "caption": "string",
  "hashtags": ["#tag"],
  "hook": "string",
  "script": "string or null",
  "overlayText": "string or null",
  "cta": "string"
}`;

  const response = await client.chat.completions.create({
    model: process.env.GROWTH_AGENT_MODEL || "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.65,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = GeneratedCopySchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    return fallbackCopy(input.signal, input.platform, input.trackedUrl);
  }

  return parsed.data;
}

/**
 * CREATE
 *
 * Generate content from ranked real product signals. Every generated item gets
 * a creative ID and a tracked CTA. Items without an approved real PackPTS
 * asset are excluded rather than allowed to degrade into text that implies a
 * missing visual.
 */
export async function generateMandateItems(input: {
  planId: string;
  signals: RankedGrowthSignal[];
  winnerPatterns: CreativePerformance[];
  maxItems: number;
}): Promise<MandateGeneratedItem[]> {
  const platforms = enabledPlatforms();
  const assetBacked = input.signals.filter((signal) =>
    isApprovedPackptsAsset(signal.assetPath),
  );

  const results: MandateGeneratedItem[] = [];
  if (assetBacked.length === 0) return results;

  for (let index = 0; index < assetBacked.length && results.length < input.maxItems; index++) {
    const signal = assetBacked[index];
    const platform = platforms[index % platforms.length];
    const creativeId = randomUUID();
    const trackedUrl = buildTrackedUrl({
      siteUrl: process.env.PACKPTS_SITE_URL || "https://packpts.com",
      destinationPath: destinationForSignal(signal),
      platform,
      creativeId,
    });
    const copy = await generateCopy({
      signal,
      platform,
      trackedUrl,
      winnerPatterns: input.winnerPatterns,
    });

    results.push({
      id: creativeId,
      platform,
      contentType: contentTypeForSignal(signal),
      status: "DRAFT",
      caption: copy.caption,
      hashtags: copy.hashtags,
      hook: copy.hook,
      script: copy.script ?? null,
      overlayText: copy.overlayText ?? null,
      cta: copy.cta,
      assetRefs: [
        {
          type: "PACKPTS_REAL_ASSET",
          path: signal.assetPath,
          signalKey: signal.signalKey,
        },
      ],
      metadata: {
        creativeId,
        mandateVersion: "listen-create-distribute-learn-v1",
        signalId: signal.id ?? null,
        signalKey: signal.signalKey,
        signalType: signal.signalType,
        signalScore: signal.score,
        attributionUrl: trackedUrl,
        optimizationMetric: "qualified_daus_per_1000_impressions",
      },
      errorMessage: null,
      mediaRequired: true,
      mediaStatus: "GENERATED",
      mediaAssetCount: 1,
      publishBlockReason: null,
      preflightPassed: true,
    });
  }

  return results;
}
