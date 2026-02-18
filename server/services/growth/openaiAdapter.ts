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

const MAX_RETRIES = 3;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateContent(req: GenerateContentRequest): Promise<GenerateContentResponse> {
  const openai = getClient();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
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
    } catch (err: any) {
      const status = err?.status || err?.response?.status;
      const isRetryable = status === 429 || status === 500 || status === 502 || status === 503;

      if (isRetryable && attempt < MAX_RETRIES) {
        const retryAfter = err?.headers?.["retry-after"];
        const delayMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 60000)
          : Math.min(Math.pow(2, attempt + 1) * 1000, 30000);
        console.log(`[OpenAI] ${status} on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${delayMs}ms...`);
        await sleep(delayMs);
        continue;
      }

      throw err;
    }
  }

  throw new Error("OpenAI request failed after all retries");
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
