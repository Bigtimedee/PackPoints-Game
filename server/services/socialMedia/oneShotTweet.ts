import { timingSafeEqual } from "crypto";
import { publishTweet } from "./publisher/twitter";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

let consumed = false;

class OneShotError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "OneShotError";
  }
}

export function resetOneShotTweetStateForTests(): void {
  consumed = false;
}

export function isOneShotConsumed(): boolean {
  return consumed;
}

function tokensMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function assertHttpsImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OneShotError("invalid_image_url", 400);
  }
  if (url.protocol !== "https:") {
    throw new OneShotError("image_url_must_be_https", 400);
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new OneShotError("image_url_host_not_allowed", 400);
  }
  return url;
}

export async function downloadHttpsImage(imageUrl: string): Promise<Buffer> {
  const url = assertHttpsImageUrl(imageUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "PackPTS-OneShotTweet/1.0" },
    });
    if (!res.ok) {
      throw new OneShotError("image_download_failed", 502);
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith("image/")) {
      throw new OneShotError("image_url_not_image", 400);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      throw new OneShotError("image_empty", 400);
    }
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new OneShotError("image_too_large", 400);
    }
    return buf;
  } catch (err) {
    if (err instanceof OneShotError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OneShotError("image_download_timeout", 504);
    }
    throw new OneShotError("image_download_failed", 502);
  } finally {
    clearTimeout(timer);
  }
}

export type OneShotTweetOk = { ok: true; tweetId: string; url: string };
export type OneShotTweetErr = { ok: false; error: string; detail?: string };
export type OneShotTweetResult = { status: number; body: OneShotTweetOk | OneShotTweetErr };

const DETAIL_MAX = 240;

/** Redact long token-like runs (OAuth, JWT segments, hex secrets) then truncate. */
export function sanitizePublishFailedDetail(err: unknown): string {
  const raw = err instanceof Error && err.message ? err.message : String(err);
  const redacted = raw.replace(/[A-Za-z0-9_\-/=+]{24,}/g, "[redacted]");
  return redacted.length > DETAIL_MAX ? redacted.slice(0, DETAIL_MAX) : redacted;
}

function mapError(err: unknown): OneShotTweetResult {
  if (err instanceof OneShotError) {
    return { status: err.status, body: { ok: false, error: err.code } };
  }
  if (err instanceof Error) {
    if (err.message.startsWith("credentials_missing")) {
      return { status: 503, body: { ok: false, error: "credentials_missing" } };
    }
    if (err.message.startsWith("media_required")) {
      return { status: 400, body: { ok: false, error: "media_required" } };
    }
    if (/rate limit/i.test(err.message)) {
      return { status: 429, body: { ok: false, error: "rate_limited" } };
    }
  }
  const detail = sanitizePublishFailedDetail(err);
  console.error("[OneShotTweet] publish_failed", detail);
  return { status: 502, body: { ok: false, error: "publish_failed", detail } };
}

export async function runOneShotTweet(opts: {
  tokenHeader: string | undefined;
  copy: unknown;
  imageUrl: unknown;
  hashtags?: unknown;
}): Promise<OneShotTweetResult> {
  const expected = process.env.ONE_SHOT_PUBLISH_TOKEN;
  if (!expected) {
    return { status: 503, body: { ok: false, error: "one_shot_disabled" } };
  }
  if (!tokensMatch(opts.tokenHeader, expected)) {
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }
  if (process.env.ONE_SHOT_PUBLISH_CONSUME === "true" && consumed) {
    return { status: 409, body: { ok: false, error: "already_consumed" } };
  }
  if (typeof opts.copy !== "string" || opts.copy.trim().length === 0) {
    return { status: 400, body: { ok: false, error: "copy_required" } };
  }
  if (typeof opts.imageUrl !== "string" || opts.imageUrl.trim().length === 0) {
    return { status: 400, body: { ok: false, error: "imageUrl_required" } };
  }
  let hashtags: string[] = [];
  if (opts.hashtags !== undefined) {
    if (!Array.isArray(opts.hashtags) || opts.hashtags.some((tag) => typeof tag !== "string")) {
      return { status: 400, body: { ok: false, error: "hashtags_must_be_strings" } };
    }
    hashtags = opts.hashtags;
  }

  try {
    const imageBuffer = await downloadHttpsImage(opts.imageUrl.trim());
    const tweetId = await publishTweet(opts.copy.trim(), hashtags, imageBuffer, true);
    if (process.env.ONE_SHOT_PUBLISH_CONSUME === "true") {
      consumed = true;
    }
    return {
      status: 200,
      body: {
        ok: true,
        tweetId,
        url: `https://x.com/i/web/status/${tweetId}`,
      },
    };
  } catch (err) {
    return mapError(err);
  }
}
