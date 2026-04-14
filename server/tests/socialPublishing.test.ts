/**
 * Social publishing reliability tests (Part 11)
 *
 * Five scenarios:
 *  1. Visual copy without media → blocked
 *  2. Non-visual text-only copy → allowed
 *  3. TRIVIA_CARD content type always blocked without media
 *  4. publishTweet throws when mediaRequired=true and no buffer
 *  5. detectsVisualReference / isVisualContentType unit coverage
 */

import { describe, it, expect, vi } from "vitest";

// Mock db before any module that imports it is loaded
vi.mock("../db", () => ({ db: {} }));

import {
  detectsVisualReference,
  isVisualContentType,
  validatePostForPublishing,
} from "../services/socialMedia/preflight";

// ---------------------------------------------------------------------------
// Scenario 1: visual copy blocked when no media attached
// ---------------------------------------------------------------------------
describe("validatePostForPublishing — visual copy without media", () => {
  it("blocks a post that references a card image but has no composedImagePath", () => {
    const result = validatePostForPublishing({
      copyText: "Can you name the card in this photo? 🔥 #PackPTS",
      contentType: "NEW_USER_ACQUISITION",
      composedImagePath: null,
      mediaRequired: false,
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/visual/i);
  });

  it("allows the same copy when a composed image is present", () => {
    const result = validatePostForPublishing({
      copyText: "Can you name the card in this photo? 🔥 #PackPTS",
      contentType: "NEW_USER_ACQUISITION",
      composedImagePath: "/generated/social/2025-01-01/test.png",
      mediaRequired: false,
    });
    expect(result.blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: non-visual text-only copy allowed without media
// ---------------------------------------------------------------------------
describe("validatePostForPublishing — text-only copy", () => {
  it("allows a generic text post with no media", () => {
    const result = validatePostForPublishing({
      copyText: "PackPTS is the best way to earn rewards on your baseball cards. Sign up free!",
      contentType: "NEW_USER_ACQUISITION",
      composedImagePath: null,
      mediaRequired: false,
    });
    expect(result.blocked).toBe(false);
  });

  it("allows a text post with mediaRequired explicitly false", () => {
    const result = validatePostForPublishing({
      copyText: "Daily streak complete! You earned 250 points. Keep it going!",
      contentType: "STREAK_MILESTONE",
      composedImagePath: null,
      mediaRequired: false,
    });
    expect(result.blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: TRIVIA_CARD content type always blocked without media
// ---------------------------------------------------------------------------
describe("validatePostForPublishing — TRIVIA_CARD always requires media", () => {
  it("blocks TRIVIA_CARD with no image even when copy has no visual phrases", () => {
    const result = validatePostForPublishing({
      copyText: "Who is this legendary player? #PackPTS #Baseball",
      contentType: "TRIVIA_CARD",
      composedImagePath: null,
      mediaRequired: false,
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("TRIVIA_CARD");
  });

  it("blocks TRIVIA_CARD with no image even with completely neutral copy", () => {
    const result = validatePostForPublishing({
      copyText: "Play free today at packpts.com",
      contentType: "TRIVIA_CARD",
      composedImagePath: null,
      mediaRequired: false,
    });
    expect(result.blocked).toBe(true);
  });

  it("allows TRIVIA_CARD when a composed image is present", () => {
    const result = validatePostForPublishing({
      copyText: "Who is this legendary player? #PackPTS #Baseball",
      contentType: "TRIVIA_CARD",
      composedImagePath: "https://cdn.packpts.com/social/test.png",
      mediaRequired: false,
    });
    expect(result.blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: publishTweet throws when mediaRequired=true but no buffer given
// ---------------------------------------------------------------------------
describe("publishTweet — throws when mediaRequired but imageBuffer missing", () => {
  it("throws credentials_missing when TWITTER_API_KEY not set", async () => {
    const origKey = process.env.TWITTER_API_KEY;
    delete process.env.TWITTER_API_KEY;

    const { publishTweet } = await import("../services/socialMedia/publisher/twitter");
    await expect(
      publishTweet("Test copy", ["#PackPTS"], undefined, true),
    ).rejects.toThrow("credentials_missing");

    if (origKey !== undefined) process.env.TWITTER_API_KEY = origKey;
  });

  it("throws media_required when TWITTER_API_KEY set but imageBuffer missing", async () => {
    process.env.TWITTER_API_KEY = "test-key";
    process.env.TWITTER_API_SECRET = "test-secret";
    process.env.TWITTER_ACCESS_TOKEN = "test-token";
    process.env.TWITTER_ACCESS_TOKEN_SECRET = "test-secret";

    // We expect the function to throw before making any network call
    const { publishTweet } = await import("../services/socialMedia/publisher/twitter");
    await expect(
      publishTweet("Test copy", ["#PackPTS"], undefined, true),
    ).rejects.toThrow("media_required");

    delete process.env.TWITTER_API_KEY;
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: auditBlockedPosts marks correct posts (logic layer only)
// ---------------------------------------------------------------------------
describe("detectsVisualReference and isVisualContentType — unit coverage", () => {
  it("detects 'card' keyword in copy", () => {
    expect(detectsVisualReference("Look at this card!")).toBe(true);
  });

  it("detects 'can you name' phrase", () => {
    expect(detectsVisualReference("Can you name this player?")).toBe(true);
  });

  it("detects 'check this out' phrase", () => {
    expect(detectsVisualReference("Check this out — hottest card of the week!")).toBe(true);
  });

  it("returns false for purely neutral copy", () => {
    expect(detectsVisualReference("Sign up today and earn rewards!")).toBe(false);
  });

  it("TRIVIA_CARD is a visual content type", () => {
    expect(isVisualContentType("TRIVIA_CARD")).toBe(true);
  });

  it("MARKET_PRICE_SPOTLIGHT is a visual content type", () => {
    expect(isVisualContentType("MARKET_PRICE_SPOTLIGHT")).toBe(true);
  });

  it("NEW_USER_ACQUISITION is not a visual content type", () => {
    expect(isVisualContentType("NEW_USER_ACQUISITION")).toBe(false);
  });

  it("validatePostForPublishing respects explicit mediaRequired=true even without visual copy or type", () => {
    const result = validatePostForPublishing({
      copyText: "Sign up today!",
      contentType: "NEW_USER_ACQUISITION",
      composedImagePath: null,
      mediaRequired: true,
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("media_required=true");
  });
});
