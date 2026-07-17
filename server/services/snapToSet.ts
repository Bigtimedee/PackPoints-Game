import OpenAI from "openai";
import { classifyCard } from "./cardClassifier";

export interface IdentifiedCard {
  playerName: string;
  year: number;
  brand: string;
  sport: string;
  setName: string;
  confidence: "high" | "medium" | "low";
  rawText: string;
}

export type CardIdentificationResult =
  | { success: true; card: IdentifiedCard }
  | { success: false; reason: "not-a-card" | "unreadable" | "not-playable"; blockedReason?: string; rawText?: string };

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const IDENTIFICATION_PROMPT = `You are a sports card expert. Analyze this image and identify the trading card shown.

Return a JSON object with these exact fields:
{
  "playerName": "Full player name as printed on the card, or null if not a single-player card",
  "year": 1987,
  "brand": "Topps",
  "sport": "baseball",
  "setName": "1987 Topps Baseball",
  "confidence": "high",
  "rawText": "All text visible on the card"
}

Rules:
- confidence: "high" if you can clearly read the player name and year; "medium" if you can read one but not both; "low" if the image is blurry or a non-player card
- sport: one of "baseball", "basketball", "football", "hockey", "soccer", "other"
- year: integer, best estimate from the card design if not printed
- If this is not a sports card at all, set playerName to null and confidence to "low"
- Return only valid JSON, no markdown`;

export async function identifyCardFromPhoto(imageBase64: string): Promise<CardIdentificationResult> {
  const openai = getOpenAIClient();

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: IDENTIFICATION_PROMPT },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";

  let parsed: any;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? content);
  } catch {
    return { success: false, reason: "unreadable", rawText: content };
  }

  if (!parsed.playerName) {
    return { success: false, reason: "not-a-card", rawText: parsed.rawText ?? content };
  }

  const classification = classifyCard({
    player: parsed.playerName,
    description: parsed.setName,
  });

  if (!classification.isPlayable) {
    return {
      success: false,
      reason: "not-playable",
      blockedReason: classification.blockedReason ?? undefined,
      rawText: parsed.rawText ?? content,
    };
  }

  return {
    success: true,
    card: {
      playerName: String(parsed.playerName),
      year: Number(parsed.year) || new Date().getFullYear(),
      brand: String(parsed.brand || "Unknown"),
      sport: String(parsed.sport || "baseball"),
      setName: String(parsed.setName || `${parsed.year} ${parsed.brand}`),
      confidence: ["high", "medium", "low"].includes(parsed.confidence)
        ? parsed.confidence
        : "medium",
      rawText: String(parsed.rawText ?? ""),
    },
  };
}
