import { agentConfig } from "../config";
import { createLogger } from "../logger";
import type { PostAnalytics } from "@shared/schema";

const logger = createLogger("TikTokPublisher");

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

let currentAccessToken = "";

function getToken(): string {
  return currentAccessToken || agentConfig.tiktok.accessToken;
}

async function refreshAccessToken(): Promise<void> {
  const { clientKey, clientSecret, refreshToken } = agentConfig.tiktok;
  const resp = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!resp.ok) {
    throw new Error(`TikTok token refresh failed: ${resp.status}`);
  }
  const data = await resp.json() as { access_token?: string };
  if (data.access_token) {
    currentAccessToken = data.access_token;
    logger.info("token_refreshed");
  }
}

async function tiktokPost<T>(
  endpoint: string,
  body: Record<string, unknown>,
  retry = true,
): Promise<T> {
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getToken()}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  if (resp.status === 401 && retry) {
    await refreshAccessToken();
    return tiktokPost<T>(endpoint, body, false);
  }

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`TikTok API error ${resp.status}: ${err}`);
  }

  return resp.json() as Promise<T>;
}

export async function publishPhoto(
  title: string,
  imagePublicUrl: string,
): Promise<string> {
  // Platform health check: skip gracefully if credentials not configured
  if (!process.env.TIKTOK_ACCESS_TOKEN) {
    console.log('[SocialMedia] TikTok disabled — TIKTOK_ACCESS_TOKEN not set');
    return Promise.reject({ success: false, platform: 'tiktok', reason: 'credentials_missing' });
  }

  const data = await tiktokPost<{ data?: { publish_id?: string } }>(
    "/post/publish/content/init/",
    {
      post_info: {
        title,
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_comment: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_images: [imagePublicUrl],
        photo_cover_index: 0,
      },
      media_type: "PHOTO",
    },
  );

  const publishId = data?.data?.publish_id;
  if (!publishId) throw new Error("TikTok did not return a publish_id");
  logger.info("photo_published", { publishId });
  return publishId;
}

export async function verifyCreatorInfo(): Promise<boolean> {
  try {
    const resp = await fetch(`${TIKTOK_API_BASE}/user/info/`, {
      headers: { "Authorization": `Bearer ${getToken()}` },
    });
    return resp.ok;
  } catch { return false; }
}

export async function fetchMetrics(publishId: string): Promise<Partial<PostAnalytics>> {
  try {
    const resp = await fetch(
      `${TIKTOK_API_BASE}/video/query/?fields=like_count,comment_count,share_count,view_count`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filters: { video_ids: [publishId] } }),
      },
    );
    if (!resp.ok) return {};
    const data = await resp.json() as { data?: { videos?: Array<{
      like_count?: number;
      comment_count?: number;
      share_count?: number;
      view_count?: number;
    }> } };
    const video = data?.data?.videos?.[0];
    if (!video) return {};
    return {
      impressions: video.view_count ?? 0,
      likes: video.like_count ?? 0,
      shares: video.share_count ?? 0,
      comments: video.comment_count ?? 0,
    };
  } catch (err) {
    logger.warn("fetch_metrics_failed", { publishId, error: String(err) });
    return {};
  }
}
