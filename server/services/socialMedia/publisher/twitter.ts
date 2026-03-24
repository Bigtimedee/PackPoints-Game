import { TwitterApi } from "twitter-api-v2";
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

export async function publishTweet(
  copy: string,
  hashtags: string[],
  imageBuffer?: Buffer,
): Promise<string> {
  // Platform health check: skip gracefully if credentials not configured
  if (!process.env.TWITTER_API_KEY) {
    console.log('[SocialMedia] Twitter disabled — TWITTER_API_KEY not set');
    throw new Error("credentials_missing: TWITTER_API_KEY not set");
  }

  if (rateLimitRemaining < 5) {
    throw new Error("Twitter rate limit too low — skipping publish");
  }

  const client = getClient();
  const fullText = `${copy}\n${hashtags.join(" ")}`;

  // TODO: Upgrade to Elevated API access for media uploads
  // imageBuffer is accepted but media upload is not attempted without Elevated access
  const response = await client.v2.tweet({
    text: fullText,
  });

  const tweetId = response.data.id;
  logger.info("tweet_published", { tweetId });
  return tweetId;
}

export async function fetchMetrics(tweetId: string): Promise<Partial<PostAnalytics>> {
  const client = getClient();
  try {
    const response = await client.v2.singleTweet(tweetId, {
      "tweet.fields": ["public_metrics", "non_public_metrics"],
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
