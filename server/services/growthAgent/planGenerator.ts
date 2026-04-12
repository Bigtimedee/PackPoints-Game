/**
 * planGenerator.ts
 *
 * Generates a daily content plan for PackPTS growth using OpenAI.
 * Returns platform targets, themes, and a natural-language summary.
 */
import OpenAI from "openai";

export interface PlatformTargets {
  TIKTOK: boolean;
  INSTAGRAM: boolean;
  X: boolean;
  REDDIT: boolean;
}

export interface ContentPlanOutput {
  platformTargets: PlatformTargets;
  themes: string[];
  goals: string;
  summary: string;
}

function buildEnabledPlatforms(): PlatformTargets {
  return {
    TIKTOK: process.env.GROWTH_TIKTOK_ENABLED !== "false",
    INSTAGRAM: process.env.GROWTH_INSTAGRAM_ENABLED === "true",
    X: process.env.GROWTH_X_ENABLED === "true",
    REDDIT: process.env.GROWTH_REDDIT_ENABLED === "true",
  };
}

function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

export async function generateDailyPlan(date: string): Promise<ContentPlanOutput> {
  const platforms = buildEnabledPlatforms();
  const enabledPlatformNames = (Object.keys(platforms) as (keyof PlatformTargets)[])
    .filter((k) => platforms[k])
    .join(", ");

  const openai = getOpenAIClient();

  const prompt = `You are a growth strategist for PackPTS, a baseball card trivia game app.
Today's date is ${date}. Active platforms: ${enabledPlatformNames || "TikTok"}.

Generate a daily social media content plan. Return valid JSON matching this exact schema:
{
  "themes": ["string", "..."],      // 2-4 content themes for today
  "goals": "string",                // one-sentence goal for today's posts
  "summary": "string"               // 2-3 sentence overview of the plan
}

Focus on themes like:
- Viral score highlights (big scores, perfect games)
- Daily 5 challenge recaps
- Streak milestone celebrations
- Player shoutouts
- Fun baseball card trivia facts
- Call-to-action to play

Keep it energetic, targeted at sports fans aged 18-35.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.8,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  let parsed: { themes?: string[]; goals?: string; summary?: string } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  return {
    platformTargets: platforms,
    themes: Array.isArray(parsed.themes) ? parsed.themes : ["score highlights", "daily challenge"],
    goals: typeof parsed.goals === "string" ? parsed.goals : "Drive app installs and engagement through compelling content.",
    summary: typeof parsed.summary === "string" ? parsed.summary : "Daily content plan generated.",
  };
}
