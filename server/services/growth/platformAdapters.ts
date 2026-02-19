import { db } from "../../db";
import { growthContentItems } from "@shared/schema";
import { eq } from "drizzle-orm";
import { TwitterApi } from "twitter-api-v2";

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

export async function postToInstagram(contentItemId: string): Promise<PostResult> {
  const config = await getInstagramConfig();
  if (!config) {
    return { success: false, error: "Instagram credentials not configured (need INSTAGRAM_BUSINESS_ACCOUNT_ID, INSTAGRAM_ACCESS_TOKEN)" };
  }

  const [item] = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.id, contentItemId));
  if (!item) return { success: false, error: "Content item not found" };

  const metadata = item.metadata as { hashtags?: string[]; imageUrl?: string } | null;
  const hashtags = metadata?.hashtags || [];
  const hashtagStr = hashtags.map((t: string) => `#${t}`).join(" ");

  const imageUrl = metadata?.imageUrl || PACKPTS_LOGO_URL;

  const body = item.body || "";
  let caption = body;
  if (item.title) {
    caption = `${item.title}\n\n${body}`;
  }
  if (hashtagStr) {
    caption += `\n\n${hashtagStr}`;
  }
  caption = caption.slice(0, 2200);

  try {
    const createRes = await fetch(
      `${GRAPH_API_BASE}/${config.userId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          caption,
          access_token: config.accessToken,
        }),
      }
    );

    if (!createRes.ok) {
      const errBody = await createRes.text();
      return { success: false, error: `Instagram container creation failed (${createRes.status}): ${errBody.slice(0, 300)}` };
    }

    const createData = await createRes.json() as { id: string };
    const containerId = createData.id;

    const maxPolls = 10;
    for (let i = 0; i < maxPolls; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      try {
        const statusRes = await fetch(
          `${GRAPH_API_BASE}/${containerId}?fields=status_code&access_token=${config.accessToken}`
        );
        if (statusRes.ok) {
          const statusData = await statusRes.json() as { status_code?: string };
          if (statusData.status_code === "FINISHED") break;
          if (statusData.status_code === "ERROR") {
            return { success: false, error: "Instagram container processing failed" };
          }
        }
      } catch { /* continue polling */ }
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

    return { success: true, externalPostId: `ig-${publishData.id}` };
  } catch (err: any) {
    const errorMsg = err?.message || "Instagram post failed";
    console.error(`[InstagramAdapter] Error posting ${contentItemId}:`, errorMsg);
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
  const token = await getRedditToken();
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

export async function getAdapterForPlatform(platform: string): Promise<((id: string) => Promise<PostResult>) | null> {
  switch (platform) {
    case "discord":
      return postToDiscord;
    case "x":
      return postToTwitter;
    case "instagram":
      return postToInstagram;
    case "reddit":
      return postToReddit;
    default:
      return null;
  }
}
