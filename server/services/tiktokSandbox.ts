/**
 * TikTok App Review sandbox helpers.
 *
 * Login Kit + Content Posting photo init for the review-only demo at
 * /review/tiktok-sandbox. Session-scoped tokens — not the growth-agent
 * TIKTOK_ACCESS_TOKEN path in publisher/tiktok.ts.
 */

export const TIKTOK_SANDBOX_SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
] as const;

export type TiktokSandboxScope = (typeof TIKTOK_SANDBOX_SCOPES)[number];
export type TiktokPostMode = "MEDIA_UPLOAD" | "DIRECT_POST";

export const TIKTOK_CALLBACK_URI = "https://packpts.com/auth/tiktok/callback";
export const TIKTOK_SANDBOX_PHOTO_URL = "https://packpts.com/og-image.png";
export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

export const TIKTOK_SANDBOX_TITLE = "Daily 5 — name the masked card";
export const TIKTOK_SANDBOX_DESCRIPTION =
  "Guess the player on a masked sports card. Same five cards for everyone, every day. Play free at packpts.com";

export const TERMINAL_SUCCESS_STATUSES = new Set([
  "PUBLISH_COMPLETE",
  "SEND_TO_USER_INBOX",
]);

export const TERMINAL_ERROR_STATUSES = new Set(["FAILED"]);

export interface TiktokSandboxTokens {
  accessToken: string;
  refreshToken?: string;
  openId?: string;
  scopes: string[];
  displayName?: string;
  expiresAt?: number;
}

export interface TiktokSoftFail {
  ok: false;
  error: string;
  message: string;
  missingEnv?: string[];
  missingScopes?: string[];
  requiredScope?: string;
  tiktokCode?: string;
  tiktokLogId?: string;
}

export function getTiktokClientCredentials(): { clientKey: string; clientSecret: string } {
  return {
    clientKey: (process.env.TIKTOK_CLIENT_KEY ?? "").trim(),
    clientSecret: (process.env.TIKTOK_CLIENT_SECRET ?? "").trim(),
  };
}

export function missingTiktokClientEnv(): string[] {
  const { clientKey, clientSecret } = getTiktokClientCredentials();
  const missing: string[] = [];
  if (!clientKey) missing.push("TIKTOK_CLIENT_KEY");
  if (!clientSecret) missing.push("TIKTOK_CLIENT_SECRET");
  return missing;
}

export function parseGrantedScopes(scope: string | undefined | null): string[] {
  if (!scope) return [];
  return scope
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function missingRequestedScopes(granted: string[]): string[] {
  const set = new Set(granted);
  return TIKTOK_SANDBOX_SCOPES.filter((scope) => !set.has(scope));
}

export function requiredScopeForPostMode(postMode: TiktokPostMode): TiktokSandboxScope {
  return postMode === "DIRECT_POST" ? "video.publish" : "video.upload";
}

export function buildAuthorizeUrl(state: string): string {
  const { clientKey } = getTiktokClientCredentials();
  const params = new URLSearchParams({
    client_key: clientKey,
    scope: TIKTOK_SANDBOX_SCOPES.join(","),
    response_type: "code",
    redirect_uri: TIKTOK_CALLBACK_URI,
    state,
  });
  return `${TIKTOK_AUTHORIZE_URL}?${params.toString()}`;
}

export function buildPhotoInitBody(postMode: TiktokPostMode, privacyLevel?: string): Record<string, unknown> {
  const postInfo: Record<string, unknown> = {
    title: TIKTOK_SANDBOX_TITLE,
    description: TIKTOK_SANDBOX_DESCRIPTION,
  };

  if (postMode === "DIRECT_POST") {
    postInfo.privacy_level = privacyLevel ?? "SELF_ONLY";
    postInfo.disable_comment = false;
    postInfo.auto_add_music = true;
    postInfo.brand_content_toggle = false;
    postInfo.brand_organic_toggle = false;
  }

  return {
    media_type: "PHOTO",
    post_mode: postMode,
    post_info: postInfo,
    source_info: {
      source: "PULL_FROM_URL",
      photo_images: [TIKTOK_SANDBOX_PHOTO_URL],
      photo_cover_index: 0,
    },
  };
}

export type PublishStatusKind = "pending" | "success" | "error";

export function classifyPublishStatus(status: string | undefined | null): PublishStatusKind {
  const normalized = (status ?? "").toUpperCase();
  if (TERMINAL_SUCCESS_STATUSES.has(normalized)) return "success";
  if (TERMINAL_ERROR_STATUSES.has(normalized)) return "error";
  return "pending";
}

interface TiktokErrorShape {
  error?: string;
  error_description?: string;
  log_id?: string;
  data?: { publish_id?: string; status?: string; fail_reason?: string };
  error_object?: { code?: string; message?: string; log_id?: string };
}

function readTiktokEnvelope(json: unknown): {
  data: Record<string, unknown> | undefined;
  code: string | undefined;
  message: string | undefined;
  logId: string | undefined;
} {
  const body = (json ?? {}) as {
    data?: Record<string, unknown>;
    error?: string | { code?: string; message?: string; log_id?: string };
    error_description?: string;
    log_id?: string;
  };

  if (typeof body.error === "object" && body.error) {
    return {
      data: body.data,
      code: body.error.code,
      message: body.error.message,
      logId: body.error.log_id,
    };
  }

  return {
    data: body.data,
    code: typeof body.error === "string" ? body.error : undefined,
    message: body.error_description,
    logId: body.log_id,
  };
}

export function tiktokApiError(
  errorCode: string,
  json: unknown,
  fallback: string,
): TiktokSoftFail {
  const envelope = readTiktokEnvelope(json);
  return {
    ok: false,
    error: errorCode,
    message: envelope.message || fallback,
    tiktokCode: envelope.code,
    tiktokLogId: envelope.logId,
  };
}

export async function exchangeAuthorizationCode(code: string): Promise<
  { ok: true; tokens: TiktokSandboxTokens } | TiktokSoftFail
> {
  const missing = missingTiktokClientEnv();
  if (missing.length > 0) {
    return {
      ok: false,
      error: "missing_client_credentials",
      message: `TikTok sandbox OAuth is not configured. Missing: ${missing.join(", ")}.`,
      missingEnv: missing,
    };
  }

  const { clientKey, clientSecret } = getTiktokClientCredentials();
  const resp = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: TIKTOK_CALLBACK_URI,
    }),
  });

  const json = await resp.json().catch(() => ({}));
  const accessToken = (json as { access_token?: string }).access_token;
  if (!resp.ok || !accessToken) {
    return tiktokApiError(
      "token_exchange_failed",
      json,
      `TikTok token exchange failed (${resp.status}).`,
    );
  }

  const body = json as {
    access_token: string;
    refresh_token?: string;
    open_id?: string;
    scope?: string;
    expires_in?: number;
  };

  return {
    ok: true,
    tokens: {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      openId: body.open_id,
      scopes: parseGrantedScopes(body.scope),
      expiresAt: typeof body.expires_in === "number" ? Date.now() + body.expires_in * 1000 : undefined,
    },
  };
}

export async function refreshSandboxToken(
  refreshToken: string,
): Promise<{ ok: true; tokens: TiktokSandboxTokens } | TiktokSoftFail> {
  const missing = missingTiktokClientEnv();
  if (missing.length > 0) {
    return {
      ok: false,
      error: "missing_client_credentials",
      message: `TikTok sandbox OAuth is not configured. Missing: ${missing.join(", ")}.`,
      missingEnv: missing,
    };
  }

  const { clientKey, clientSecret } = getTiktokClientCredentials();
  const resp = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const json = await resp.json().catch(() => ({}));
  const accessToken = (json as { access_token?: string }).access_token;
  if (!resp.ok || !accessToken) {
    return tiktokApiError(
      "token_refresh_failed",
      json,
      `TikTok token refresh failed (${resp.status}).`,
    );
  }

  const body = json as {
    access_token: string;
    refresh_token?: string;
    open_id?: string;
    scope?: string;
    expires_in?: number;
  };

  return {
    ok: true,
    tokens: {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? refreshToken,
      openId: body.open_id,
      scopes: parseGrantedScopes(body.scope),
      expiresAt: typeof body.expires_in === "number" ? Date.now() + body.expires_in * 1000 : undefined,
    },
  };
}

export async function fetchSandboxDisplayName(accessToken: string): Promise<string | undefined> {
  try {
    const resp = await fetch(
      `${TIKTOK_API_BASE}/user/info/?fields=open_id,display_name,avatar_url`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!resp.ok) return undefined;
    const json = (await resp.json()) as {
      data?: { user?: { display_name?: string } };
    };
    return json.data?.user?.display_name;
  } catch {
    return undefined;
  }
}

async function tiktokAuthedPost<T>(
  accessToken: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; json: T } | TiktokSoftFail> {
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  const json = (await resp.json().catch(() => ({}))) as T & TiktokErrorShape;
  const envelope = readTiktokEnvelope(json);
  if (!resp.ok || (envelope.code && envelope.code !== "ok")) {
    return tiktokApiError(
      "tiktok_api_error",
      json,
      `TikTok API ${endpoint} failed (${resp.status}).`,
    );
  }
  return { ok: true, json };
}

export async function queryCreatorPrivacyOptions(
  accessToken: string,
): Promise<{ ok: true; options: string[]; nickname?: string } | TiktokSoftFail> {
  const result = await tiktokAuthedPost<{
    data?: { privacy_level_options?: string[]; creator_nickname?: string };
  }>(accessToken, "/post/publish/creator_info/query/", {});

  if (!result.ok) return result;
  return {
    ok: true,
    options: result.json.data?.privacy_level_options ?? [],
    nickname: result.json.data?.creator_nickname,
  };
}

export async function initSandboxPhotoPost(
  accessToken: string,
  postMode: TiktokPostMode,
): Promise<{ ok: true; publishId: string } | TiktokSoftFail> {
  let privacyLevel: string | undefined;
  if (postMode === "DIRECT_POST") {
    const creator = await queryCreatorPrivacyOptions(accessToken);
    if (!creator.ok) return creator;
    privacyLevel = creator.options.includes("SELF_ONLY")
      ? "SELF_ONLY"
      : creator.options[0];
    if (!privacyLevel) {
      return {
        ok: false,
        error: "privacy_level_unavailable",
        message:
          "TikTok creator_info/query returned no privacy_level_options. Sandbox Direct Post cannot start.",
      };
    }
  }

  const result = await tiktokAuthedPost<{ data?: { publish_id?: string } }>(
    accessToken,
    "/post/publish/content/init/",
    buildPhotoInitBody(postMode, privacyLevel),
  );
  if (!result.ok) return result;

  const publishId = result.json.data?.publish_id;
  if (!publishId) {
    return {
      ok: false,
      error: "missing_publish_id",
      message: "TikTok content init succeeded but did not return a publish_id.",
    };
  }
  return { ok: true, publishId };
}

export async function querySandboxPublishStatus(
  accessToken: string,
  publishId: string,
): Promise<
  | { ok: true; status: string; kind: PublishStatusKind; failReason?: string }
  | TiktokSoftFail
> {
  const result = await tiktokAuthedPost<{
    data?: { status?: string; fail_reason?: string };
  }>(accessToken, "/post/publish/status/query/", { publish_id: publishId });

  if (!result.ok) return result;
  const status = result.json.data?.status ?? "UNKNOWN";
  return {
    ok: true,
    status,
    kind: classifyPublishStatus(status),
    failReason: result.json.data?.fail_reason,
  };
}

export function sandboxRedirectError(code: string, detail?: string): string {
  const params = new URLSearchParams({ error: code });
  if (detail) params.set("detail", detail.slice(0, 280));
  return `/review/tiktok-sandbox?${params.toString()}`;
}
