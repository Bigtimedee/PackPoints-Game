import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI();
  }
  return client;
}

export interface GenerateContentRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateContentResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export async function generateContent(req: GenerateContentRequest): Promise<GenerateContentResponse> {
  const openai = getClient();
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: req.systemPrompt },
      { role: "user", content: req.userPrompt },
    ],
    max_tokens: req.maxTokens || 1000,
    temperature: req.temperature ?? 0.8,
  });

  const content = response.choices[0]?.message?.content || "";
  const usage = response.usage;
  return {
    content,
    usage: {
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
    },
  };
}

export async function generateStructuredContent<T>(
  req: GenerateContentRequest & { jsonSchema?: string }
): Promise<{ parsed: T; raw: string; usage: GenerateContentResponse["usage"] }> {
  const result = await generateContent({
    ...req,
    systemPrompt: req.systemPrompt + (req.jsonSchema
      ? `\n\nRespond ONLY with valid JSON matching this schema:\n${req.jsonSchema}`
      : "\n\nRespond ONLY with valid JSON."),
  });

  try {
    const parsed = JSON.parse(result.content) as T;
    return { parsed, raw: result.content, usage: result.usage };
  } catch {
    const jsonMatch = result.content.match(/```json?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]) as T;
      return { parsed, raw: result.content, usage: result.usage };
    }
    throw new Error(`Failed to parse AI response as JSON: ${result.content.slice(0, 200)}`);
  }
}
