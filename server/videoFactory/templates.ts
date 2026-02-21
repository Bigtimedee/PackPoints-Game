import { z } from "zod";

export const LayerTypeEnum = z.enum(["image", "text", "timer", "sfx"]);
export type LayerType = z.infer<typeof LayerTypeEnum>;

export const LayerSchema = z.object({
  type: LayerTypeEnum,
  content: z.string().optional(),
  fontSizePx: z.number().optional(),
  color: z.string().optional(),
  position: z.enum(["center", "top", "bottom", "top-third", "bottom-third"]).optional(),
  animation: z.enum(["fade-in", "pop", "none"]).optional(),
});

export const SceneSchema = z.object({
  sceneId: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  layers: z.array(LayerSchema),
});

export const TemplateSchema = z.object({
  templateId: z.string(),
  name: z.string(),
  durationSec: z.number(),
  width: z.number(),
  height: z.number(),
  scenes: z.array(SceneSchema),
});

export type VideoTemplate = z.infer<typeof TemplateSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Layer = z.infer<typeof LayerSchema>;

export const CLASSIC_COUNTDOWN: VideoTemplate = {
  templateId: "classic_countdown",
  name: "Classic Countdown",
  durationSec: 12,
  width: 1080,
  height: 1920,
  scenes: [
    {
      sceneId: "hook",
      startSec: 0,
      endSec: 2,
      layers: [
        { type: "image", content: "card_blurred", position: "center" },
        { type: "text", content: "{{hookText}}", fontSizePx: 64, color: "white", position: "top-third", animation: "fade-in" },
      ],
    },
    {
      sceneId: "countdown",
      startSec: 2,
      endSec: 6,
      layers: [
        { type: "image", content: "card_masked", position: "center" },
        { type: "text", content: "Who is this player?", fontSizePx: 52, color: "white", position: "top-third" },
        { type: "timer", content: "3-2-1", fontSizePx: 120, color: "#FFD700", position: "center", animation: "pop" },
      ],
    },
    {
      sceneId: "reveal",
      startSec: 6,
      endSec: 10,
      layers: [
        { type: "image", content: "card_masked", position: "center" },
        { type: "text", content: "Answer: {{answerText}}", fontSizePx: 56, color: "#00FF88", position: "bottom-third", animation: "pop" },
      ],
    },
    {
      sceneId: "cta",
      startSec: 10,
      endSec: 12,
      layers: [
        { type: "image", content: "card_masked", position: "center" },
        { type: "text", content: "{{ctaText}}", fontSizePx: 48, color: "white", position: "center", animation: "fade-in" },
      ],
    },
  ],
};

export const ONLY_REAL_FANS_TEMPLATE: VideoTemplate = {
  ...CLASSIC_COUNTDOWN,
  templateId: "only_real_fans",
  name: "Only Real Fans",
};

export const DIFFICULTY_LADDER_TEMPLATE: VideoTemplate = {
  templateId: "difficulty_ladder",
  name: "Difficulty Ladder",
  durationSec: 15,
  width: 1080,
  height: 1920,
  scenes: [
    {
      sceneId: "easy",
      startSec: 0,
      endSec: 3,
      layers: [
        { type: "image", content: "card_masked_0", position: "center" },
        { type: "text", content: "EASY", fontSizePx: 72, color: "#00FF88", position: "top-third", animation: "pop" },
      ],
    },
    {
      sceneId: "easy_reveal",
      startSec: 3,
      endSec: 6,
      layers: [
        { type: "image", content: "card_masked_0", position: "center" },
        { type: "text", content: "{{answer0}}", fontSizePx: 52, color: "#00FF88", position: "bottom-third", animation: "pop" },
      ],
    },
    {
      sceneId: "medium",
      startSec: 6,
      endSec: 9,
      layers: [
        { type: "image", content: "card_masked_1", position: "center" },
        { type: "text", content: "MEDIUM", fontSizePx: 72, color: "#FFD700", position: "top-third", animation: "pop" },
      ],
    },
    {
      sceneId: "medium_reveal",
      startSec: 9,
      endSec: 12,
      layers: [
        { type: "image", content: "card_masked_1", position: "center" },
        { type: "text", content: "{{answer1}}", fontSizePx: 52, color: "#FFD700", position: "bottom-third", animation: "pop" },
      ],
    },
    {
      sceneId: "impossible_cta",
      startSec: 12,
      endSec: 15,
      layers: [
        { type: "image", content: "card_masked_2", position: "center" },
        { type: "text", content: "IMPOSSIBLE", fontSizePx: 72, color: "#FF4444", position: "top-third", animation: "pop" },
        { type: "text", content: "{{ctaText}}", fontSizePx: 42, color: "white", position: "bottom-third" },
      ],
    },
  ],
};

export const MEMORY_SHOCK_TEMPLATE: VideoTemplate = {
  templateId: "memory_shock",
  name: "Memory Shock",
  durationSec: 12,
  width: 1080,
  height: 1920,
  scenes: [
    {
      sceneId: "hook",
      startSec: 0,
      endSec: 3,
      layers: [
        { type: "image", content: "card_blurred", position: "center" },
        { type: "text", content: "REMEMBER THIS GUY?", fontSizePx: 64, color: "white", position: "top-third", animation: "fade-in" },
      ],
    },
    {
      sceneId: "prompt",
      startSec: 3,
      endSec: 7,
      layers: [
        { type: "image", content: "card_masked", position: "center" },
        { type: "text", content: "Where did he play?", fontSizePx: 48, color: "#FFD700", position: "top-third" },
      ],
    },
    {
      sceneId: "reveal",
      startSec: 7,
      endSec: 10,
      layers: [
        { type: "image", content: "card_masked", position: "center" },
        { type: "text", content: "Answer: {{answerText}}", fontSizePx: 56, color: "#00FF88", position: "bottom-third", animation: "pop" },
      ],
    },
    {
      sceneId: "cta",
      startSec: 10,
      endSec: 12,
      layers: [
        { type: "image", content: "card_masked", position: "center" },
        { type: "text", content: "{{ctaText}}", fontSizePx: 42, color: "white", position: "center", animation: "fade-in" },
      ],
    },
  ],
};

export const PACK_PULL_DRAMA_TEMPLATE: VideoTemplate = {
  templateId: "pack_pull_drama",
  name: "Pack Pull Drama",
  durationSec: 15,
  width: 1080,
  height: 1920,
  scenes: [
    {
      sceneId: "pack_open",
      startSec: 0,
      endSec: 5,
      layers: [
        { type: "image", content: "card_blurred", position: "center" },
        { type: "text", content: "PACK PULL TIME 🔥", fontSizePx: 64, color: "#FF6B35", position: "top-third", animation: "pop" },
        { type: "timer", content: "suspense-3-2-1", fontSizePx: 120, color: "#FFD700", position: "center" },
      ],
    },
    {
      sceneId: "reveal",
      startSec: 5,
      endSec: 12,
      layers: [
        { type: "image", content: "card_masked", position: "center" },
        { type: "text", content: "{{answerText}}", fontSizePx: 56, color: "#00FF88", position: "bottom-third", animation: "pop" },
      ],
    },
    {
      sceneId: "cta",
      startSec: 12,
      endSec: 15,
      layers: [
        { type: "text", content: "{{ctaText}}", fontSizePx: 48, color: "white", position: "center", animation: "fade-in" },
      ],
    },
  ],
};

export const LEADERBOARD_FLEX_TEMPLATE: VideoTemplate = {
  templateId: "leaderboard_flex",
  name: "Leaderboard Flex",
  durationSec: 12,
  width: 1080,
  height: 1920,
  scenes: [
    {
      sceneId: "intro",
      startSec: 0,
      endSec: 3,
      layers: [
        { type: "text", content: "DAILY 5 TOP PLAYERS 🏆", fontSizePx: 64, color: "#FFD700", position: "center", animation: "pop" },
      ],
    },
    {
      sceneId: "players",
      startSec: 3,
      endSec: 9,
      layers: [
        { type: "text", content: "{{leaderboardText}}", fontSizePx: 44, color: "white", position: "center" },
      ],
    },
    {
      sceneId: "cta",
      startSec: 9,
      endSec: 12,
      layers: [
        { type: "text", content: "{{ctaText}}", fontSizePx: 48, color: "#00FF88", position: "center", animation: "fade-in" },
      ],
    },
  ],
};

export const ERA_WARS_TEMPLATE: VideoTemplate = {
  templateId: "era_wars",
  name: "Era Wars",
  durationSec: 12,
  width: 1080,
  height: 1920,
  scenes: [
    {
      sceneId: "intro",
      startSec: 0,
      endSec: 3,
      layers: [
        { type: "text", content: "ERA WARS", fontSizePx: 72, color: "#FF4444", position: "top-third", animation: "pop" },
        { type: "text", content: "{{eraLabel}}", fontSizePx: 56, color: "#FFD700", position: "center" },
      ],
    },
    {
      sceneId: "matchup",
      startSec: 3,
      endSec: 9,
      layers: [
        { type: "image", content: "card_masked_0", position: "center" },
        { type: "image", content: "card_masked_1", position: "center" },
        { type: "text", content: "Which era wins?", fontSizePx: 48, color: "#FFD700", position: "bottom-third" },
      ],
    },
    {
      sceneId: "cta",
      startSec: 9,
      endSec: 12,
      layers: [
        { type: "text", content: "{{ctaText}}", fontSizePx: 48, color: "white", position: "center", animation: "fade-in" },
      ],
    },
  ],
};

export const TEMPLATES: Record<string, VideoTemplate> = {
  classic_countdown: CLASSIC_COUNTDOWN,
  only_real_fans: ONLY_REAL_FANS_TEMPLATE,
  difficulty_ladder: DIFFICULTY_LADDER_TEMPLATE,
  memory_shock: MEMORY_SHOCK_TEMPLATE,
  pack_pull_drama: PACK_PULL_DRAMA_TEMPLATE,
  leaderboard_flex: LEADERBOARD_FLEX_TEMPLATE,
  era_wars: ERA_WARS_TEMPLATE,
};

export function getTemplate(templateId: string): VideoTemplate | null {
  return TEMPLATES[templateId] || null;
}

export function getAvailableTemplates(): string[] {
  return Object.keys(TEMPLATES);
}
