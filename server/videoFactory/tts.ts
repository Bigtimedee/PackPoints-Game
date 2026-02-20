import fs from "fs";
import path from "path";
import os from "os";

export function isTTSEnabled(): boolean {
  return process.env.VIDEO_TTS_ENABLED === "true";
}

function getOpenAIKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

export async function generateVoiceover(
  text: string,
  outputPath?: string
): Promise<string | null> {
  if (!isTTSEnabled()) {
    console.log("[VideoFactory/TTS] TTS disabled (VIDEO_TTS_ENABLED != true)");
    return null;
  }

  const apiKey = getOpenAIKey();
  if (!apiKey) {
    console.log("[VideoFactory/TTS] No OPENAI_API_KEY available, skipping TTS");
    return null;
  }

  const outPath = outputPath || path.join(os.tmpdir(), `vf_voice_${Date.now()}.mp3`);

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: "nova",
        response_format: "mp3",
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[VideoFactory/TTS] OpenAI TTS error ${response.status}: ${errText}`);
      return null;
    }

    const arrayBuf = await response.arrayBuffer();
    fs.writeFileSync(outPath, Buffer.from(arrayBuf));
    console.log(`[VideoFactory/TTS] Generated voiceover: ${outPath} (${Math.round(arrayBuf.byteLength / 1024)}KB)`);
    return outPath;
  } catch (err: any) {
    console.error(`[VideoFactory/TTS] Failed: ${err?.message}`);
    return null;
  }
}

export function buildVoiceoverText(params: {
  hookText: string;
  answerText: string;
  ctaText?: string;
}): string {
  const { hookText, answerText, ctaText } = params;
  const cta = ctaText || "Play PackPTS dot com";
  return `${hookText}. Three... two... one... Answer: ${answerText}. ${cta}.`;
}
