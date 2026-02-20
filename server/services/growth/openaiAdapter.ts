import OpenAI from "openai";

let client: OpenAI | null = null;
let clientSource: string = "";
let lastHealthCheck: { ok: boolean; error?: string; checkedAt: string } | null = null;

function getClient(): OpenAI {
  if (!client) {
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

    if (baseURL && apiKey) {
      console.log("[OpenAI/Growth] Using Replit AI Integration credentials");
      client = new OpenAI({ apiKey, baseURL });
      clientSource = "replit_ai_integration";
    } else if (process.env.OPENAI_API_KEY) {
      console.log("[OpenAI/Growth] Using user-provided OPENAI_API_KEY");
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      clientSource = "user_openai_key";
    } else {
      throw new Error("No OpenAI credentials configured. Set up AI Integration or provide OPENAI_API_KEY.");
    }
  }
  return client;
}

export function resetClient(): void {
  client = null;
  clientSource = "";
}

export async function checkOpenAIConnectivity(): Promise<{ ok: boolean; source: string; error?: string }> {
  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Reply with OK" }],
      max_tokens: 5,
      temperature: 0,
    });
    const content = response.choices[0]?.message?.content || "";
    lastHealthCheck = { ok: true, checkedAt: new Date().toISOString() };
    console.log(`[OpenAI/Growth] Connectivity check PASSED (source: ${clientSource}, response: ${content.slice(0, 20)})`);
    return { ok: true, source: clientSource };
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const errorMsg = err?.message || String(err);
    lastHealthCheck = { ok: false, error: `${status || "unknown"}: ${errorMsg.slice(0, 200)}`, checkedAt: new Date().toISOString() };
    console.error(`[OpenAI/Growth] Connectivity check FAILED (source: ${clientSource}): ${status} ${errorMsg.slice(0, 200)}`);

    if (clientSource === "replit_ai_integration" && process.env.OPENAI_API_KEY) {
      console.log("[OpenAI/Growth] Replit AI Integration failed, trying fallback to user OPENAI_API_KEY...");
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
      clientSource = "user_openai_key_fallback";
      try {
        const fallbackResponse = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Reply with OK" }],
          max_tokens: 5,
          temperature: 0,
        });
        lastHealthCheck = { ok: true, checkedAt: new Date().toISOString() };
        console.log(`[OpenAI/Growth] Fallback connectivity check PASSED (source: ${clientSource})`);
        return { ok: true, source: clientSource };
      } catch (fallbackErr: any) {
        const fbMsg = fallbackErr?.message || String(fallbackErr);
        console.error(`[OpenAI/Growth] Fallback also FAILED: ${fbMsg.slice(0, 200)}`);
        client = null;
        clientSource = "";
        lastHealthCheck = { ok: false, error: `Both sources failed. Primary: ${errorMsg.slice(0, 100)}. Fallback: ${fbMsg.slice(0, 100)}`, checkedAt: new Date().toISOString() };
        return { ok: false, source: "none", error: lastHealthCheck.error };
      }
    }

    return { ok: false, source: clientSource, error: `${status || "unknown"}: ${errorMsg.slice(0, 200)}` };
  }
}

export function getOpenAIHealthStatus(): { ok: boolean; source: string; lastCheck: typeof lastHealthCheck } {
  return { ok: lastHealthCheck?.ok ?? false, source: clientSource, lastCheck: lastHealthCheck };
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
