import { db } from "../../db";
import { growthContentItems } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface PostResult {
  success: boolean;
  externalPostId?: string;
  error?: string;
}

export async function postToDiscord(contentItemId: string): Promise<PostResult> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return { success: false, error: "DISCORD_WEBHOOK_URL not configured" };
  }

  const [item] = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.id, contentItemId));
  if (!item) return { success: false, error: "Content item not found" };

  const metadata = item.metadata as { hashtags?: string[] } | null;
  const hashtags = metadata?.hashtags || [];
  const hashtagStr = hashtags.map((t: string) => `#${t}`).join(" ");
  const fullBody = item.body + (hashtagStr ? `\n\n${hashtagStr}` : "");

  const payload = {
    embeds: [{
      title: item.title || "PackPTS Update",
      description: fullBody.slice(0, 4096),
      color: 0x6366f1,
      footer: { text: "PackPTS" },
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Discord API error ${res.status}: ${text.slice(0, 200)}` };
    }

    await db.update(growthContentItems).set({
      status: "POSTED",
      postedAt: new Date(),
      externalPostId: "discord-webhook",
      updatedAt: new Date(),
    }).where(eq(growthContentItems.id, contentItemId));

    return { success: true, externalPostId: "discord-webhook" };
  } catch (err: any) {
    return { success: false, error: err?.message || "Discord post failed" };
  }
}

export async function getAdapterForPlatform(platform: string): Promise<((id: string) => Promise<PostResult>) | null> {
  switch (platform) {
    case "discord":
      return postToDiscord;
    default:
      return null;
  }
}
