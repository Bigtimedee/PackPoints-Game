import { agentConfig } from "../config";
import { createLogger } from "../logger";
import type { PostAnalytics } from "@shared/schema";

const logger = createLogger("DiscordPublisher");

interface DiscordWebhookPayload {
  content: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  image?: { url: string };
  footer?: { text: string };
  timestamp?: string;
}

// PackPTS brand color (deep blue)
const BRAND_COLOR = 0x1a56db;

/**
 * Post a message to the configured Discord webhook.
 * Returns the webhook message ID on success.
 */
export async function publishDiscordMessage(
  copy: string,
  hashtags: string[],
  imageUrl?: string,
  mediaRequired?: boolean,
): Promise<string> {
  const webhookUrl = agentConfig.discord.webhookUrl;
  if (!webhookUrl) {
    console.log("[SocialMedia] Discord disabled — DISCORD_WEBHOOK_URL not set");
    throw new Error("credentials_missing: DISCORD_WEBHOOK_URL not set");
  }

  if (mediaRequired && !imageUrl) {
    throw new Error("media_required: imageUrl must be provided when mediaRequired=true");
  }

  // Build embed for richer formatting
  const embeds: DiscordEmbed[] = [];
  if (imageUrl) {
    embeds.push({
      color: BRAND_COLOR,
      image: { url: imageUrl },
    });
  }

  const tagLine = hashtags.length > 0 ? `\n${hashtags.join(" ")}` : "";
  const fullText = `${copy}${tagLine}`;

  const payload: DiscordWebhookPayload = {
    content: fullText,
    username: "PackPTS",
    ...(embeds.length > 0 ? { embeds } : {}),
  };

  // Append ?wait=true to get the message object back (includes ID)
  const url = webhookUrl.includes("?")
    ? `${webhookUrl}&wait=true`
    : `${webhookUrl}?wait=true`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Discord webhook error ${resp.status}: ${body}`);
  }

  const data = (await resp.json()) as { id?: string };
  const messageId = data?.id ?? `discord-${Date.now()}`;
  logger.info("message_published", { messageId, hasEmbed: embeds.length > 0 });
  return messageId;
}

/**
 * Verify webhook URL is reachable. Returns true if valid.
 */
export async function verifyWebhook(): Promise<boolean> {
  const webhookUrl = agentConfig.discord.webhookUrl;
  if (!webhookUrl) return false;

  try {
    // GET the webhook to verify it exists (doesn't post anything)
    const resp = await fetch(webhookUrl, { method: "GET" });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { id?: string; name?: string };
    if (data?.id) {
      logger.info("webhook_verified", { name: data.name ?? "unknown" });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Discord webhooks don't provide post-hoc analytics.
 * Returns empty metrics — this keeps the analytics fetcher interface consistent.
 */
export async function fetchMetrics(_messageId: string): Promise<Partial<PostAnalytics>> {
  return {};
}
