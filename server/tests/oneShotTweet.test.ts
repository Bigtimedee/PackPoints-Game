import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const publishTweet = vi.fn();

vi.mock("../services/socialMedia/publisher/twitter", () => ({
  publishTweet: (...args: unknown[]) => publishTweet(...args),
}));

import {
  assertHttpsImageUrl,
  resetOneShotTweetStateForTests,
  runOneShotTweet,
  sanitizePublishFailedDetail,
} from "../services/socialMedia/oneShotTweet";

const TOKEN = "one-shot-test-token-32chars-min";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function jsonBody() {
  return {
    copy: "D5-2 media proof",
    imageUrl: "https://packpts.com/og.png",
    hashtags: ["#PackPTS"],
  };
}

describe("assertHttpsImageUrl", () => {
  it("accepts https packpts.com URLs", () => {
    expect(assertHttpsImageUrl("https://packpts.com/og.png").hostname).toBe("packpts.com");
  });

  it("rejects http", () => {
    expect(() => assertHttpsImageUrl("http://packpts.com/og.png")).toThrow("image_url_must_be_https");
  });

  it("rejects localhost", () => {
    expect(() => assertHttpsImageUrl("https://localhost/secret.png")).toThrow("image_url_host_not_allowed");
  });
});

describe("runOneShotTweet", () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ["ONE_SHOT_PUBLISH_TOKEN", "ONE_SHOT_PUBLISH_CONSUME"] as const;

  beforeEach(() => {
    resetOneShotTweetStateForTests();
    publishTweet.mockReset();
    publishTweet.mockResolvedValue("1234567890");
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(PNG, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    );
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
  });

  it("returns 503 when ONE_SHOT_PUBLISH_TOKEN is unset", async () => {
    const result = await runOneShotTweet({
      tokenHeader: TOKEN,
      ...jsonBody(),
    });
    expect(result).toEqual({ status: 503, body: { ok: false, error: "one_shot_disabled" } });
    expect(publishTweet).not.toHaveBeenCalled();
  });

  it("returns 401 when the header token does not match", async () => {
    process.env.ONE_SHOT_PUBLISH_TOKEN = TOKEN;
    const result = await runOneShotTweet({
      tokenHeader: "wrong-token-value-32chars-min!!",
      ...jsonBody(),
    });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ ok: false, error: "unauthorized" });
    expect(publishTweet).not.toHaveBeenCalled();
  });

  it("downloads https image and publishes with mediaRequired=true", async () => {
    process.env.ONE_SHOT_PUBLISH_TOKEN = TOKEN;
    const result = await runOneShotTweet({
      tokenHeader: TOKEN,
      ...jsonBody(),
    });
    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        tweetId: "1234567890",
        url: "https://x.com/i/web/status/1234567890",
      },
    });
    expect(publishTweet).toHaveBeenCalledTimes(1);
    const [copy, hashtags, buffer, mediaRequired] = publishTweet.mock.calls[0];
    expect(copy).toBe("D5-2 media proof");
    expect(hashtags).toEqual(["#PackPTS"]);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(mediaRequired).toBe(true);
  });

  it("rejects non-https imageUrl after auth", async () => {
    process.env.ONE_SHOT_PUBLISH_TOKEN = TOKEN;
    const result = await runOneShotTweet({
      tokenHeader: TOKEN,
      copy: "hi",
      imageUrl: "http://evil.example/x.png",
    });
    expect(result).toEqual({ status: 400, body: { ok: false, error: "image_url_must_be_https" } });
    expect(publishTweet).not.toHaveBeenCalled();
  });

  it("returns 502 publish_failed with sanitized detail when Twitter throws", async () => {
    process.env.ONE_SHOT_PUBLISH_TOKEN = TOKEN;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    publishTweet.mockRejectedValue(
      new Error("Request failed with code 403: You are not permitted to perform this action."),
    );
    const result = await runOneShotTweet({ tokenHeader: TOKEN, ...jsonBody() });
    expect(result.status).toBe(502);
    expect(result.body).toEqual({
      ok: false,
      error: "publish_failed",
      detail: "Request failed with code 403: You are not permitted to perform this action.",
    });
    expect(spy).toHaveBeenCalledWith(
      "[OneShotTweet] publish_failed",
      "Request failed with code 403: You are not permitted to perform this action.",
    );
    spy.mockRestore();
  });

  it("redacts token-like strings in publish_failed detail", async () => {
    process.env.ONE_SHOT_PUBLISH_TOKEN = TOKEN;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = "AAAA" + "b".repeat(40);
    publishTweet.mockRejectedValue(new Error(`OAuth failed Authorization: Bearer ${token}`));
    const result = await runOneShotTweet({ tokenHeader: TOKEN, ...jsonBody() });
    expect(result.status).toBe(502);
    expect(result.body).toEqual({
      ok: false,
      error: "publish_failed",
      detail: "OAuth failed Authorization: Bearer [redacted]",
    });
    expect(JSON.stringify(result.body)).not.toContain(token);
    expect(spy).toHaveBeenCalledWith(
      "[OneShotTweet] publish_failed",
      "OAuth failed Authorization: Bearer [redacted]",
    );
    spy.mockRestore();
  });

  it("no-ops subsequent calls when ONE_SHOT_PUBLISH_CONSUME=true", async () => {
    process.env.ONE_SHOT_PUBLISH_TOKEN = TOKEN;
    process.env.ONE_SHOT_PUBLISH_CONSUME = "true";
    const first = await runOneShotTweet({ tokenHeader: TOKEN, ...jsonBody() });
    const second = await runOneShotTweet({ tokenHeader: TOKEN, ...jsonBody() });
    expect(first.status).toBe(200);
    expect(second).toEqual({ status: 409, body: { ok: false, error: "already_consumed" } });
    expect(publishTweet).toHaveBeenCalledTimes(1);
  });
});

describe("sanitizePublishFailedDetail", () => {
  it("uses err.message and truncates to 240 chars", () => {
    const long = Array.from({ length: 80 }, (_, i) => `err-${i}`).join(" ");
    const detail = sanitizePublishFailedDetail(new Error(long));
    expect(detail.length).toBe(240);
    expect(long.startsWith(detail)).toBe(true);
  });

  it("falls back to String(err) for non-Error values", () => {
    expect(sanitizePublishFailedDetail("plain twitter 401")).toBe("plain twitter 401");
  });
});
