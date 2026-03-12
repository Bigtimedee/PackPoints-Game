import { TwitterApi } from "twitter-api-v2";
import fs from "fs";
import path from "path";
import { agentConfig } from "../config";
import { createLogger } from "../logger";
import type { PostAnalytics } from "@shared/schema";

const logger = createLogger("TwitterPublisher");

let rateLimitRemaining = 100;

function getClient(): TwitterApi {
  const { apiKey, apiSecret, accessToken, accessTokenSecret } = agentConfig.twitter;
  return new TwitterApi({
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken,
    accessSecret: accessTokenSecret,
  });
}

export async function uploadMedia(imagePath: string): Promise<string> {
  const client = getClient();
  const relativePath = imagePath.replace(/^\//, "");
  const absPath = path.resolve(process.cwd(), "public", relativePath);
  logger.info("media_upload_path", { imagePath, absPath, cwd: process.cwd() });
  const mediaBuffer = fs.readFileSync(absPath);
  const mediaId = await client.v1.uploadMedia(mediaBuffer, { mimeType: "image/png" });
  logger.info("media_uploaded", { mediaId, imagePath });
  return mediaId;
}

export async function publishTweet(
  copy: string,
  hashtags: string[],
  mediaId: string,
): Promise<string> {
  // Platform health check: skip gracefully if credentials not configured
  if (!process.env.TWITTER_API_KEY) {
    console.log('[SocialMedia] Twitter disabled — TWITTER_API_KEY not set');
    return Promise.reject({ success: false, platform: 'twitter', reason: 'credentials_missing' });
  }

  if (rateLimitRemaining < 5) {
    throw new Error("Twitter rate limit too low — skipping publish");
  }

  const client = getClient();
  const fullText = `${copy}\n${hashtags.join(" ")}`;

  const response = await client.v2.tweet({
    text: fullText,
    media: { media_ids: [mediaId] },
  });

  const tweetId = response.data.id;
  logger.info("tweet_published", { tweetId });
  return tweetId;
}

export async function fetchMetrics(tweetId: string): Promise<Partial<PostAnalytics>> {
  const client = getClient();
  try {
    const response = await client.v2.singleTweet(tweetId, {
      "tweet.fields": ["public_metrics"],
    });
    const metrics = response.data.public_metrics;
    if (!metrics) return {};
    return {
      impressions: metrics.impression_count ?? 0,
      likes: metrics.like_count ?? 0,
      shares: metrics.retweet_count ?? 0,
      comments: metrics.reply_count ?? 0,
    };
  } catch (err) {
    logger.warn("fetch_metrics_failed", { tweetId, error: String(err) });
    return {};
  }
}

export function updateRateLimitState(remaining: number): void {
  rateLimitRemaining = remaining;
}
