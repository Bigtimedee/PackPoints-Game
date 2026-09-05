import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TIKTOK_CALLBACK_URI,
  TIKTOK_SANDBOX_PHOTO_URL,
  TIKTOK_SANDBOX_SCOPES,
  buildAuthorizeUrl,
  buildPhotoInitBody,
  classifyPublishStatus,
  missingRequestedScopes,
  missingTiktokClientEnv,
  parseGrantedScopes,
  requiredScopeForPostMode,
  sandboxRedirectError,
} from "../services/tiktokSandbox";

describe("tiktok sandbox OAuth helpers", () => {
  afterEach(() => {
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
  });

  it("reports missing client env instead of treating the app as configured", () => {
    expect(missingTiktokClientEnv()).toEqual(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]);
    process.env.TIKTOK_CLIENT_KEY = "key";
    expect(missingTiktokClientEnv()).toEqual(["TIKTOK_CLIENT_SECRET"]);
  });

  it("builds Login Kit authorize URL with the three review scopes and portal callback", () => {
    process.env.TIKTOK_CLIENT_KEY = "sb_client_key";
    const url = new URL(buildAuthorizeUrl("csrf-state"));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("sb_client_key");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(TIKTOK_CALLBACK_URI);
    expect(url.searchParams.get("redirect_uri")).toBe("https://packpts.com/auth/tiktok/callback");
    expect(url.searchParams.get("state")).toBe("csrf-state");
    expect(url.searchParams.get("scope")?.split(",")).toEqual([...TIKTOK_SANDBOX_SCOPES]);
  });

  it("parses granted scopes and lists any missing requested scopes", () => {
    expect(parseGrantedScopes("user.info.basic,video.publish")).toEqual([
      "user.info.basic",
      "video.publish",
    ]);
    expect(missingRequestedScopes(["user.info.basic", "video.publish"])).toEqual(["video.upload"]);
    expect(missingRequestedScopes([...TIKTOK_SANDBOX_SCOPES])).toEqual([]);
  });

  it("maps post modes to the scope TikTok requires", () => {
    expect(requiredScopeForPostMode("MEDIA_UPLOAD")).toBe("video.upload");
    expect(requiredScopeForPostMode("DIRECT_POST")).toBe("video.publish");
  });

  it("keeps callback errors on the review page with a clear code", () => {
    expect(sandboxRedirectError("missing_token", "No session")).toBe(
      "/review/tiktok-sandbox?error=missing_token&detail=No+session",
    );
  });
});

describe("tiktok sandbox photo init payload", () => {
  it("builds MEDIA_UPLOAD photo init with PULL_FROM_URL og-image", () => {
    const body = buildPhotoInitBody("MEDIA_UPLOAD");
    expect(body.media_type).toBe("PHOTO");
    expect(body.post_mode).toBe("MEDIA_UPLOAD");
    expect(body.source_info).toEqual({
      source: "PULL_FROM_URL",
      photo_images: [TIKTOK_SANDBOX_PHOTO_URL],
      photo_cover_index: 0,
    });
    expect((body.post_info as { privacy_level?: string }).privacy_level).toBeUndefined();
  });

  it("builds DIRECT_POST with SELF_ONLY sandbox privacy and brand toggles off", () => {
    const body = buildPhotoInitBody("DIRECT_POST");
    expect(body.post_mode).toBe("DIRECT_POST");
    expect(body.post_info).toMatchObject({
      privacy_level: "SELF_ONLY",
      brand_content_toggle: false,
      brand_organic_toggle: false,
    });
  });
});

describe("tiktok sandbox status classification", () => {
  it("treats PUBLISH_COMPLETE and inbox upload as sandbox success", () => {
    expect(classifyPublishStatus("PUBLISH_COMPLETE")).toBe("success");
    expect(classifyPublishStatus("SEND_TO_USER_INBOX")).toBe("success");
  });

  it("treats FAILED as a clear error and other values as pending", () => {
    expect(classifyPublishStatus("FAILED")).toBe("error");
    expect(classifyPublishStatus("PROCESSING_UPLOAD")).toBe("pending");
    expect(classifyPublishStatus(undefined)).toBe("pending");
  });
});
