import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { SOLO_REPLACE_HARD_CAP_MS } from "../soloImageReplace";
import {
  answerRetryDelayMs,
  isUnmaskedCardUrl,
  maskedImageRetrySrc,
  postGameAnswer,
  shouldRetryMaskedImageLoad,
  TRANSIENT_RETRY_MS,
} from "../transientLoad";

const prefetchSrc = readFileSync(new URL("../prefetchPlayCardImages.ts", import.meta.url), "utf8");
const gameCardSrc = readFileSync(new URL("../../components/GameCard.tsx", import.meta.url), "utf8");
const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");

describe("masked image deploy retry", () => {
  it("retries /api/play/m once on 502, 503, or a network error", () => {
    const url = "/api/play/m/solo/sess/1/hmac?v=v4.4";
    expect(TRANSIENT_RETRY_MS).toBe(2_000);
    expect(TRANSIENT_RETRY_MS).toBeLessThan(SOLO_REPLACE_HARD_CAP_MS);
    expect(shouldRetryMaskedImageLoad({ url, status: 502, alreadyRetried: false })).toBe(true);
    expect(shouldRetryMaskedImageLoad({ url, status: 503, alreadyRetried: false })).toBe(true);
    expect(shouldRetryMaskedImageLoad({ url, status: null, alreadyRetried: false })).toBe(true);
    expect(shouldRetryMaskedImageLoad({ url, status: 503, alreadyRetried: true })).toBe(false);
    expect(shouldRetryMaskedImageLoad({ url, status: 404, alreadyRetried: false })).toBe(false);
    expect(maskedImageRetrySrc(url, 1)).toContain("boot=1");
  });

  it("never retries or prefetches an unmasked card before submit", () => {
    for (const url of ["/api/images/card/abc", "/api/play/r/solo/sess/1/hmac"]) {
      expect(isUnmaskedCardUrl(url)).toBe(true);
      expect(shouldRetryMaskedImageLoad({ url, status: 503, alreadyRetried: false })).toBe(false);
      expect(shouldRetryMaskedImageLoad({ url, status: null, alreadyRetried: false })).toBe(false);
    }
    expect(prefetchSrc).toContain('!url.includes("/api/images/card/")');
    expect(prefetchSrc).toContain('!url.includes("/api/play/r/")');
    expect(gameCardSrc).toContain("shouldRetryMaskedImageLoad");
    expect(gameCardSrc).toContain("if (revealUrl) return;");
  });
});

describe("solo answer deploy retry", () => {
  it("retries POST /api/game/answer once after Retry-After on 503", async () => {
    expect(answerRetryDelayMs({ status: 503, retryAfter: "2", alreadyRetried: false })).toBe(2_000);
    expect(answerRetryDelayMs({ status: 502, retryAfter: null, alreadyRetried: false })).toBe(TRANSIENT_RETRY_MS);
    expect(answerRetryDelayMs({ status: 400, retryAfter: "2", alreadyRetried: false })).toBeNull();
    expect(answerRetryDelayMs({ status: 503, retryAfter: "2", alreadyRetried: true })).toBeNull();
    const waits: number[] = [];
    let calls = 0;
    const body = await postGameAnswer(
      { sessionId: "s", questionIndex: 0, selectedAnswer: "Ken Phelps" },
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return new Response(JSON.stringify({ message: "Starting up" }), {
              status: 503,
              headers: { "retry-after": "2" },
            });
          }
          return new Response(JSON.stringify({ correct: true, correctAnswer: "Ken Phelps", pointsEarned: 40 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    );
    expect(calls).toBe(2);
    expect(waits).toEqual([2_000]);
    expect(body.correct).toBe(true);
    expect(body.pointsEarned).toBe(40);
    expect(gameSrc).toContain("postGameAnswer");
  });
});
