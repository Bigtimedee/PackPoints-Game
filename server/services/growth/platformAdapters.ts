import { db } from "../../db";
import { growthContentItems } from "@shared/schema";
import { eq } from "drizzle-orm";
import { TwitterApi } from "twitter-api-v2";
import { deepValidateImageUrl } from "../../videoFactory/validate";

export interface PostResult {
  success: boolean;
  externalPostId?: string;
  error?: string;
}

export interface CredentialCheckResult {
  platform: string;
  valid: boolean;
  error?: string;
}

const credentialCache = new Map<string, { valid: boolean; checkedAt: number; error?: string }>();
const CREDENTIAL_CACHE_TTL = 10 * 60 * 1000;

export async function validateTwitterCredentials(): Promise<CredentialCheckResult> {
  const cached = credentialCache.get("x");
  if (cached && Date.now() - cached.checkedAt < CREDENTIAL_CACHE_TTL) {
    return { platform: "x", valid: cached.valid, error: cached.error };
  }

  const client = getTwitterClient();
  if (!client) {
    const result = { valid: false, error: "Credentials not configured" };
    credentialCache.set("x", { ...result, checkedAt: Date.now() });
    return { platform: "x", ...result };
  }

  try {
    await client.v2.me();
    credentialCache.set("x", { valid: true, checkedAt: Date.now() });
    return { platform: "x", valid: true };
  } catch (err: any) {
    const error = err?.data?.detail || err?.message || "Authentication failed";
    console.error(`[TwitterAdapter] Credential validation failed: ${error}`);
    credentialCache.set("x", { valid: false, checkedAt: Date.now(), error });
    return { platform: "x", valid: false, error };
  }
}

export async function validateInstagramCredentials(): Promise<CredentialCheckResult> {
  const cached = credentialCache.get("instagram");
  if (cached && Date.now() - cached.checkedAt < CREDENTIAL_CACHE_TTL) {
    return { platform: "instagram", valid: cached.valid, error: cached.error };
  }

  const config = await getInstagramConfig();
  if (!config) {
    const result = { valid: false, error: "Credentials not configured" };
    credentialCache.set("instagram", { ...result, checkedAt: Date.now() });
    return { platform: "instagram", ...result };
  }

  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${config.userId}?fields=id,username&access_token=${config.accessToken}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as any;
      const error = body?.error?.message || `HTTP ${res.status}`;
      credentialCache.set("instagram", { valid: false, checkedAt: Date.now(), error });
      return { platform: "instagram", valid: false, error };
    }
    credentialCache.set("instagram", { valid: true, checkedAt: Date.now() });
    return { platform: "instagram", valid: true };
  } catch (err: any) {
    const error = err?.message || "Connection failed";
    credentialCache.set("instagram", { valid: false, checkedAt: Date.now(), error });
    return { platform: "instagram", valid: false, error };
  }
}

export async function validateFacebookCredentials(): Promise<CredentialCheckResult> {
  const cached = credentialCache.get("facebook");
  if (cached && Date.now() - cached.checkedAt < CREDENTIAL_CACHE_TTL) {
    return { platform: "facebook", valid: cached.valid, error: cached.error };
  }

  const config = await getFacebookConfig();
  if (!config) {
    const result = { valid: false, error: "Credentials not configured" };
    credentialCache.set("facebook", { ...result, checkedAt: Date.now() });
    return { platform: "facebook", ...result };
  }

  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${config.pageId}?fields=id,name&access_token=${config.accessToken}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as any;
      const error = body?.error?.message || `HTTP ${res.status}`;
      credentialCache.set("facebook", { valid: false, checkedAt: Date.now(), error });
      return { platform: "facebook", valid: false, error };
    }
    credentialCache.set("facebook", { valid: true, checkedAt: Date.now() });
    return { platform: "facebook", valid: true };
  } catch (err: any) {
    const error = err?.message || "Connection failed";
    credentialCache.set("facebook", { valid: false, checkedAt: Date.now(), error });
    return { platform: "facebook", valid: false, error };
  }
}

export async function validateAllCredentials(): Promise<CredentialCheckResult[]> {
  const results = await Promise.allSettled([
    validateTwitterCredentials(),
    validateInstagramCredentials(),
    validateFacebookCredentials(),
  ]);
  const mapped = results.map((r, i) => {
    const platforms = ["x", "instagram", "facebook"];
    return r.status === "fulfilled"
      ? r.value
      : { platform: platforms[i], valid: false, error: "Check threw an exception" };
  });

  // Also include Discord and Reddit (env-var-only checks)
  const discordOk = !!process.env.DISCORD_WEBHOOK_URL;
  const redditOk = !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET &&
    process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD);
  mapped.push({ platform: "discord", valid: discordOk, error: discordOk ? undefined : "DISCORD_WEBHOOK_URL not set" });
  mapped.push({ platform: "reddit", valid: redditOk, error: redditOk ? undefined : "Credentials not configured" });

  return mapped;
}

export function clearCredentialCache(platform?: string): void {
  if (platform) {
    credentialCache.delete(platform);
  } else {
    credentialCache.clear();
  }
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

function getTwitterClient(): TwitterApi | null {
  const appKey = process.env.TWITTER_API_KEY;
  const appSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    return null;
  }

  return new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
}

export async function postToTwitter(contentItemId: string): Promise<PostResult> {
  const client = getTwitterClient();
  if (!client) {
    return { success: false, error: "Twitter API credentials not configured (need TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET)" };
  }

  const [item] = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.id, contentItemId));
  if (!item) return { success: false, error: "Content item not found" };

  const metadata = item.metadata as { hashtags?: string[] } | null;
  const hashtags = metadata?.hashtags || [];
  const hashtagStr = hashtags.map((t: string) => `#${t}`).join(" ");

  const body = item.body || "";

  try {
    if (item.type === "X_THREAD" && body.includes("\n---\n")) {
      const tweets = body.split("\n---\n").map(t => t.trim()).filter(Boolean);
      const tweetsWithHashtags = tweets.map((tweet, i) => {
        if (i === tweets.length - 1 && hashtagStr) {
          const withTags = `${tweet}\n\n${hashtagStr}`;
          return withTags.length <= 280 ? withTags : tweet;
        }
        return tweet;
      });

      const threadResult = await client.v2.tweetThread(
        tweetsWithHashtags.map(text => ({ text: text.slice(0, 280) }))
      );

      const firstTweetId = Array.isArray(threadResult) && threadResult.length > 0
        ? threadResult[0].data.id : "thread";

      await db.update(growthContentItems).set({
        status: "POSTED",
        postedAt: new Date(),
        externalPostId: `x-${firstTweetId}`,
        updatedAt: new Date(),
      }).where(eq(growthContentItems.id, contentItemId));

      return { success: true, externalPostId: `x-${firstTweetId}` };
    } else {
      let tweetText = body;
      if (hashtagStr) {
        const withTags = `${tweetText}\n\n${hashtagStr}`;
        tweetText = withTags.length <= 280 ? withTags : tweetText;
      }

      const { data } = await client.v2.tweet(tweetText.slice(0, 280));

      await db.update(growthContentItems).set({
        status: "POSTED",
        postedAt: new Date(),
        externalPostId: `x-${data.id}`,
        updatedAt: new Date(),
      }).where(eq(growthContentItems.id, contentItemId));

      return { success: true, externalPostId: `x-${data.id}` };
    }
  } catch (err: any) {
    const errorMsg = err?.data?.detail || err?.message || "Twitter post failed";
    console.error(`[TwitterAdapter] Error posting ${contentItemId}:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const PACKPTS_LOGO_URL = "https://packpts.com/logo-social.jpg";

async function getInstagramConfig(): Promise<{ userId: string; accessToken: string } | null> {
  const userId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!userId || !accessToken) return null;
  return { userId, accessToken };
}

function getAppBaseUrl(): string {
  return process.env.APP_URL || "https://packpts.com";
}

function resolveVideoUrl(contentItemId: string, metadata: any): string | null {
  const videoAsset = metadata?.video_asset;
  if (videoAsset?.url) {
    if (videoAsset.url.startsWith("http")) return videoAsset.url;
    return `${getAppBaseUrl()}${videoAsset.url}`;
  }

  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const localPath = `public/generated/videos/${date}/${contentItemId}/output.mp4`;
  try {
    const fs = require("fs");
    if (fs.existsSync(localPath)) {
      return `${getAppBaseUrl()}/generated/videos/${date}/${contentItemId}/output.mp4`;
    }
  } catch {}

  return null;
}

function isVideoContent(item: { type: string; metadata: any }): boolean {
  const type = item.type || "";
  if (type.startsWith("TIKTOK_")) return true;
  const meta = item.metadata as any;
  if (meta?.video_asset?.url) return true;
  if (meta?.format_id || meta?.render_template_id) return true;
  return false;
}

async function pollContainerStatus(containerId: string, accessToken: string, maxPolls = 30, intervalMs = 5000): Promise<{ ready: boolean; error?: string }> {
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    try {
      const statusRes = await fetch(
        `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${accessToken}`
      );
      if (statusRes.ok) {
        const statusData = await statusRes.json() as { status_code?: string; status?: string };
        if (statusData.status_code === "FINISHED") return { ready: true };
        if (statusData.status_code === "ERROR") {
          return { ready: false, error: `Container processing failed: ${statusData.status || "unknown"}` };
        }
      }
    } catch {}
  }
  return { ready: false, error: "Container processing timed out" };
}

export async function postToInstagram(contentItemId: string): Promise<PostResult> {
  const config = await getInstagramConfig();
  if (!config) {
    return { success: false, error: "Instagram credentials not configured (need INSTAGRAM_BUSINESS_ACCOUNT_ID, INSTAGRAM_ACCESS_TOKEN)" };
  }

  const [item] = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.id, contentItemId));
  if (!item) return { success: false, error: "Content item not found" };

  const metadata = item.metadata as { hashtags?: string[]; imageUrl?: string; video_asset?: { url?: string } } | null;
  const hashtags = metadata?.hashtags || [];
  const hashtagStr = hashtags.map((t: string) => `#${t}`).join(" ");

  const body = item.body || "";
  let caption = body;
  if (item.title) {
    caption = `${item.title}\n\n${body}`;
  }
  if (hashtagStr) {
    caption += `\n\n${hashtagStr}`;
  }
  caption = caption.slice(0, 2200);

  const hasVideo = isVideoContent(item);
  const videoUrl = hasVideo ? resolveVideoUrl(contentItemId, metadata) : null;

  try {
    let containerPayload: Record<string, any>;

    if (hasVideo && videoUrl) {
      if (!videoUrl.startsWith("https://")) {
        console.warn(`[InstagramAdapter] Video URL not publicly accessible for ${contentItemId}: ${videoUrl}`);
      }
      containerPayload = {
        media_type: "REELS",
        video_url: videoUrl,
        caption,
        share_to_feed: true,
        access_token: config.accessToken,
      };
      console.log(`[InstagramAdapter] Creating Reels container for ${contentItemId}`);
    } else {
      const rawImageUrl = metadata?.imageUrl;
      let imageUrl: string;

      if (rawImageUrl) {
        const imgCheck = await deepValidateImageUrl(rawImageUrl);
        if (imgCheck.valid) {
          imageUrl = rawImageUrl;
        } else {
          // Fall back to the brand logo rather than marking the item FAILED.
          // A post with the logo image is far better than a permanently failed post.
          console.warn(`[InstagramAdapter] Image validation failed for ${contentItemId}, falling back to logo: ${imgCheck.error}`);
          imageUrl = PACKPTS_LOGO_URL;
        }
      } else {
        imageUrl = PACKPTS_LOGO_URL;
      }

      containerPayload = {
        image_url: imageUrl,
        caption,
        access_token: config.accessToken,
      };
    }

    const createRes = await fetch(
      `${GRAPH_API_BASE}/${config.userId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(containerPayload),
      }
    );

    if (!createRes.ok) {
      const errBody = await createRes.text();
      return { success: false, error: `Instagram container creation failed (${createRes.status}): ${errBody.slice(0, 300)}` };
    }

    const createData = await createRes.json() as { id: string };
    const containerId = createData.id;

    const pollInterval = hasVideo ? 5000 : 3000;
    const pollCount = hasVideo ? 30 : 10;
    const pollResult = await pollContainerStatus(containerId, config.accessToken, pollCount, pollInterval);
    if (!pollResult.ready) {
      return { success: false, error: pollResult.error || "Container processing failed" };
    }

    const publishRes = await fetch(
      `${GRAPH_API_BASE}/${config.userId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: config.accessToken,
        }),
      }
    );

    if (!publishRes.ok) {
      const errBody = await publishRes.text();
      return { success: false, error: `Instagram publish failed (${publishRes.status}): ${errBody.slice(0, 300)}` };
    }

    const publishData = await publishRes.json() as { id: string };

    await db.update(growthContentItems).set({
      status: "POSTED",
      postedAt: new Date(),
      externalPostId: `ig-${publishData.id}`,
      updatedAt: new Date(),
    }).where(eq(growthContentItems.id, contentItemId));

    console.log(`[InstagramAdapter] Posted ${hasVideo ? "Reel" : "image"} to Instagram: ig-${publishData.id}`);
    return { success: true, externalPostId: `ig-${publishData.id}` };
  } catch (err: any) {
    const errorMsg = err?.message || "Instagram post failed";
    console.error(`[InstagramAdapter] Error posting ${contentItemId}:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

async function getFacebookConfig(): Promise<{ pageId: string; accessToken: string } | null> {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !accessToken) return null;
  return { pageId, accessToken };
}

export async function postToFacebook(contentItemId: string): Promise<PostResult> {
  const config = await getFacebookConfig();
  if (!config) {
    return { success: false, error: "Facebook credentials not configured (need FACEBOOK_PAGE_ID, FACEBOOK_PAGE_ACCESS_TOKEN)" };
  }

  const [item] = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.id, contentItemId));
  if (!item) return { success: false, error: "Content item not found" };

  const metadata = item.metadata as { hashtags?: string[]; imageUrl?: string; video_asset?: { url?: string } } | null;
  const hashtags = metadata?.hashtags || [];
  const hashtagStr = hashtags.map((t: string) => `#${t}`).join(" ");

  const body = item.body || "";
  let message = body;
  if (item.title) {
    message = `${item.title}\n\n${body}`;
  }
  if (hashtagStr) {
    message += `\n\n${hashtagStr}`;
  }

  const hasVideo = isVideoContent(item);
  const videoUrl = hasVideo ? resolveVideoUrl(contentItemId, metadata) : null;

  try {
    let postId: string;

    if (hasVideo && videoUrl) {
      console.log(`[FacebookAdapter] Posting video to Facebook for ${contentItemId}`);
      const res = await fetch(
        `${GRAPH_API_BASE}/${config.pageId}/videos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_url: videoUrl,
            description: message.slice(0, 8000),
            access_token: config.accessToken,
          }),
        }
      );

      if (!res.ok) {
        const errBody = await res.text();
        return { success: false, error: `Facebook video upload failed (${res.status}): ${errBody.slice(0, 300)}` };
      }

      const data = await res.json() as { id: string };
      postId = data.id;
    } else {
      const rawImageUrl = metadata?.imageUrl;
      let validImageUrl: string | null = null;

      if (rawImageUrl) {
        const imgCheck = await deepValidateImageUrl(rawImageUrl);
        if (imgCheck.valid) validImageUrl = rawImageUrl;
      }

      if (validImageUrl) {
        console.log(`[FacebookAdapter] Posting photo to Facebook for ${contentItemId}`);
        const res = await fetch(
          `${GRAPH_API_BASE}/${config.pageId}/photos`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: validImageUrl,
              message: message.slice(0, 8000),
              access_token: config.accessToken,
            }),
          }
        );

        if (!res.ok) {
          const errBody = await res.text();
          return { success: false, error: `Facebook photo post failed (${res.status}): ${errBody.slice(0, 300)}` };
        }

        const data = await res.json() as { id: string; post_id?: string };
        postId = data.post_id || data.id;
      } else {
        console.log(`[FacebookAdapter] Posting text to Facebook for ${contentItemId}`);
        const res = await fetch(
          `${GRAPH_API_BASE}/${config.pageId}/feed`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: message.slice(0, 8000),
              access_token: config.accessToken,
            }),
          }
        );

        if (!res.ok) {
          const errBody = await res.text();
          return { success: false, error: `Facebook post failed (${res.status}): ${errBody.slice(0, 300)}` };
        }

        const data = await res.json() as { id: string };
        postId = data.id;
      }
    }

    await db.update(growthContentItems).set({
      status: "POSTED",
      postedAt: new Date(),
      externalPostId: `fb-${postId}`,
      updatedAt: new Date(),
    }).where(eq(growthContentItems.id, contentItemId));

    console.log(`[FacebookAdapter] Posted to Facebook: fb-${postId}`);
    return { success: true, externalPostId: `fb-${postId}` };
  } catch (err: any) {
    const errorMsg = err?.message || "Facebook post failed";
    console.error(`[FacebookAdapter] Error posting ${contentItemId}:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

let redditAccessToken: string | null = null;
let redditTokenExpiry = 0;

async function getRedditToken(): Promise<string | null> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;

  if (!clientId || !clientSecret || !username || !password) return null;

  if (redditAccessToken && Date.now() < redditTokenExpiry) return redditAccessToken;

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const userAgent = process.env.REDDIT_USER_AGENT || "PackPTS Growth Agent/1.0";

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit auth failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  redditAccessToken = data.access_token;
  redditTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return redditAccessToken;
}

const redditPostTracker = new Map<string, number>();
const REDDIT_DAILY_LIMIT = 1;

function canPostToSubreddit(subreddit: string): boolean {
  const today = new Date().toLocaleDateString("en-CA");
  const key = `${subreddit}_${today}`;
  const count = redditPostTracker.get(key) || 0;
  return count < REDDIT_DAILY_LIMIT;
}

function recordRedditPost(subreddit: string): void {
  const today = new Date().toLocaleDateString("en-CA");
  const key = `${subreddit}_${today}`;
  redditPostTracker.set(key, (redditPostTracker.get(key) || 0) + 1);

  const keysToDelete: string[] = [];
  redditPostTracker.forEach((_, k) => {
    if (!k.endsWith(today)) keysToDelete.push(k);
  });
  keysToDelete.forEach(k => redditPostTracker.delete(k));
}

export async function postToReddit(contentItemId: string): Promise<PostResult> {
  let token: string | null;
  try {
    token = await getRedditToken();
  } catch (err: any) {
    return { success: false, error: `Reddit authentication failed: ${err?.message || "Unknown error"}` };
  }
  if (!token) {
    return { success: false, error: "Reddit credentials not configured (need REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD)" };
  }

  const [item] = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.id, contentItemId));
  if (!item) return { success: false, error: "Content item not found" };

  const subredditsStr = process.env.REDDIT_TARGET_SUBREDDITS || "baseballcards";
  const subreddits = subredditsStr.split(",").map(s => s.trim()).filter(Boolean);

  if (subreddits.length === 0) {
    return { success: false, error: "No target subreddits configured" };
  }

  const userAgent = process.env.REDDIT_USER_AGENT || "PackPTS Growth Agent/1.0";
  const metadata = item.metadata as { hashtags?: string[] } | null;
  const hashtags = metadata?.hashtags || [];

  let posted = 0;
  let lastError = "";
  const postIds: string[] = [];

  for (const sub of subreddits) {
    if (!canPostToSubreddit(sub)) {
      console.log(`[RedditAdapter] Rate limited: already posted to r/${sub} today`);
      continue;
    }

    const title = (item.title || "PackPTS Update").slice(0, 300);
    let body = item.body || "";
    if (hashtags.length > 0) {
      body += `\n\n${hashtags.map(t => `#${t}`).join(" ")}`;
    }

    try {
      const res = await fetch("https://oauth.reddit.com/api/submit", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": userAgent,
        },
        body: new URLSearchParams({
          sr: sub,
          kind: "self",
          title,
          text: body.slice(0, 40000),
          api_type: "json",
        }).toString(),
      });

      if (!res.ok) {
        const text = await res.text();
        lastError = `Reddit API error posting to r/${sub} (${res.status}): ${text.slice(0, 200)}`;
        console.error(`[RedditAdapter] ${lastError}`);
        continue;
      }

      const result = await res.json() as { json: { data?: { name?: string; url?: string }; errors?: string[][] } };
      if (result.json?.errors?.length) {
        lastError = `Reddit errors for r/${sub}: ${JSON.stringify(result.json.errors)}`;
        console.error(`[RedditAdapter] ${lastError}`);
        continue;
      }

      const postId = result.json?.data?.name || `reddit-${sub}`;
      postIds.push(postId);
      recordRedditPost(sub);
      posted++;
      console.log(`[RedditAdapter] Posted to r/${sub}: ${postId}`);
    } catch (err: any) {
      lastError = err?.message || "Reddit post failed";
      console.error(`[RedditAdapter] Error posting to r/${sub}:`, lastError);
    }
  }

  if (posted > 0) {
    await db.update(growthContentItems).set({
      status: "POSTED",
      postedAt: new Date(),
      externalPostId: postIds.join(","),
      updatedAt: new Date(),
    }).where(eq(growthContentItems.id, contentItemId));

    return { success: true, externalPostId: postIds.join(",") };
  }

  return { success: false, error: lastError || "No subreddits available (rate limited)" };
}

export async function postToTikTok(contentItemId: string): Promise<PostResult> {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;

  if (!accessToken) {
    return { success: false, error: "TikTok credentials not configured (need TIKTOK_ACCESS_TOKEN)" };
  }

  const [item] = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.id, contentItemId));
  if (!item) return { success: false, error: "Content item not found" };

  const metadata = item.metadata as { hashtags?: string[]; video_asset?: { url?: string }; caption?: string } | null;
  const videoUrl = resolveVideoUrl(contentItemId, metadata);

  if (!videoUrl) {
    return { success: false, error: "No video URL found for TikTok post" };
  }

  const caption = metadata?.caption || item.body || "";
  const hashtags = metadata?.hashtags || [];
  const fullCaption = caption + (hashtags.length > 0 ? '\n\n' + hashtags.map(t => `#${t}`).join(' ') : '');

  try {
    // TikTok Content Posting API - Share video to TikTok
    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        post_info: {
          title: fullCaption.slice(0, 150),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: "FILE_URL",
          video_url: videoUrl,
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { success: false, error: `TikTok API error (${res.status}): ${errBody.slice(0, 300)}` };
    }

    const data = await res.json() as { data?: { publish_id?: string } };
    const publishId = data?.data?.publish_id || "tiktok-upload";

    await db.update(growthContentItems).set({
      status: "POSTED",
      postedAt: new Date(),
      externalPostId: `tiktok-${publishId}`,
      updatedAt: new Date(),
    }).where(eq(growthContentItems.id, contentItemId));

    console.log(`[TikTokAdapter] Posted to TikTok: tiktok-${publishId}`);
    return { success: true, externalPostId: `tiktok-${publishId}` };
  } catch (err: any) {
    const errorMsg = err?.message || "TikTok post failed";
    console.error(`[TikTokAdapter] Error posting ${contentItemId}:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

export interface TwitterFollower {
  id: string;
  username: string;
}

export async function getNewTwitterFollowers(knownFollowerIds: Set<string>): Promise<TwitterFollower[]> {
  const client = getTwitterClient();
  if (!client) return [];

  try {
    const me = await client.v2.me();
    const userId = me.data.id;

    const newFollowers: TwitterFollower[] = [];
    let paginationToken: string | undefined;

    do {
      const response = await client.v2.followers(userId, {
        max_results: 100,
        "user.fields": ["id", "username"],
        ...(paginationToken ? { pagination_token: paginationToken } : {}),
      } as any);

      const users = response.data ?? [];
      let hitKnown = false;

      for (const user of users) {
        if (knownFollowerIds.has(user.id)) {
          hitKnown = true;
          break;
        }
        newFollowers.push({ id: user.id, username: user.username });
      }

      if (hitKnown) break;
      paginationToken = (response.meta as any)?.next_token;
    } while (paginationToken);

    return newFollowers;
  } catch (err: any) {
    console.error("[TwitterAdapter] getNewTwitterFollowers error:", err?.message || err);
    return [];
  }
}

export async function sendTwitterWelcomeDM(
  followerId: string,
  followerUsername: string,
): Promise<{ success: boolean; error?: string }> {
  const client = getTwitterClient();
  if (!client) return { success: false, error: "Twitter client not configured" };

  const message = `Hey @${followerUsername}! 👋 Thanks for following PackPTS! We challenge you to play 1 match on PackPTS — the ultimate sports card trivia game. Think you can handle it? 🏆 https://packpts.com`;

  try {
    await client.v2.sendDmToParticipant(followerId, { text: message });
    return { success: true };
  } catch (err: any) {
    const error = err?.data?.detail || err?.message || "DM send failed";
    return { success: false, error };
  }
}

export async function getAdapterForPlatform(platform: string): Promise<((id: string) => Promise<PostResult>) | null> {
  switch (platform) {
    case "discord":
      return postToDiscord;
    case "x":
      return postToTwitter;
    case "instagram":
      return postToInstagram;
    case "facebook":
      return postToFacebook;
    case "reddit":
      return postToReddit;
    case "tiktok":
      return postToTikTok;
    default:
      return null;
  }
}
