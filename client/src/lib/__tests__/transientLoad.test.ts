import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { SOLO_REPLACE_HARD_CAP_MS } from "../soloImageReplace";
import {
  isUnmaskedCardUrl,
  maskedImageRetrySrc,
  shouldRetryMaskedImageLoad,
  TRANSIENT_RETRY_MS,
} from "../transientLoad";

const prefetchSrc = readFileSync(new URL("../prefetchPlayCardImages.ts", import.meta.url), "utf8");
const gameCardSrc = readFileSync(new URL("../../components/GameCard.tsx", import.meta.url), "utf8");

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
