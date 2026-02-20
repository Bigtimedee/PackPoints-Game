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

export const DIFFICULTY_LADDER: VideoTemplate = {
  templateId: "difficulty_ladder",
  name: "Difficulty Ladder",
  durationSec: 15,
  width: 1080,
  height: 1920,
  scenes: [
    {
      sceneId: "intro",
      startSec: 0,
      endSec: 2,
      layers: [
        { type: "text", content: "Can you name this player? 🤔", fontSizePx: 56, color: "white", position: "center", animation: "fade-in" },
      ],
    },
    {
      sceneId: "hint1",
      startSec: 2,
      endSec: 5,
      layers: [
        { type: "image", content: "card_masked", position: "center" },
        { type: "text", content: "Hint: {{hint1}}", fontSizePx: 44, color: "#FFD700", position: "bottom-third" },
      ],
    },
    {
      sceneId: "hint2",
      startSec: 5,
      endSec: 8,
      layers: [
        { type: "image", content: "card_masked", position: "center" },
        { type: "text", content: "Hint: {{hint2}}", fontSizePx: 44, color: "#FFD700", position: "bottom-third" },
      ],
    },
    {
      sceneId: "reveal",
      startSec: 8,
      endSec: 13,
      layers: [
        { type: "image", content: "card_masked", position: "center" },
        { type: "text", content: "Answer: {{answerText}}", fontSizePx: 56, color: "#00FF88", position: "bottom-third", animation: "pop" },
      ],
    },
    {
      sceneId: "cta",
      startSec: 13,
      endSec: 15,
      layers: [
        { type: "text", content: "{{ctaText}}", fontSizePx: 48, color: "white", position: "center", animation: "fade-in" },
      ],
    },
  ],
};

export const TEMPLATES: Record<string, VideoTemplate> = {
  classic_countdown: CLASSIC_COUNTDOWN,
  difficulty_ladder: DIFFICULTY_LADDER,
};

export function getTemplate(templateId: string): VideoTemplate | null {
  return TEMPLATES[templateId] || null;
}

export function getAvailableTemplates(): string[] {
  return Object.keys(TEMPLATES);
}
