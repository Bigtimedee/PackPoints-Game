/**
 * Marketing SoR — FOMO preflight + Daily 5-only auto copy.
 * Reference: https://x.com/PlayPackPTS/status/2100232354249728403
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));

vi.mock("../services/socialMedia/promptEvolution", () => ({
  loadEvolvedVariants: async () => null,
}));

vi.mock("../services/socialMedia/factChecker", () => ({
  checkClaims: async (draft: { copyText: string }) => ({
    passed: true,
    cleanedCopyText: draft.copyText,
    log: [],
  }),
}));

import {
  detectFomoAcquisitionCopy,
  detectMarketingSorViolation,
  buildDaily5Copy,
  sparseHashtags,
  MAX_AUTO_HASHTAGS,
  collectHashtags,
} from "../services/socialMedia/marketingSor";
import { validatePostForPublishing } from "../services/socialMedia/preflight";
import {
  generateDraftPost,
  generateFallbackContent,
  type SocialContentType,
} from "../services/socialMedia/contentGenerator";

const DAILY5_CAPTIONS = `Daily 5. Guess who. Keep the streak.

Knowledge pays.

→ https://packpts.com/daily

#PackPTS #Daily5`;

describe("detectFomoAcquisitionCopy — signup bonus / 250 free / FOMO", () => {
  it("rejects 250 free PackPTS signup copy", () => {
    const r = detectFomoAcquisitionCopy(
      "New players get 250 free PackPTS on signup. No purchase needed. Start at packpts.com",
    );
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.reason).toMatch(/250_free|new_players_get|no_purchase_needed/);
  });

  it("rejects signup bonus + 250 free pts", () => {
    const r = detectFomoAcquisitionCopy(
      "Signup bonus. PackPTS pays you to play. Claim your 250 free pts today at packpts.com",
    );
    expect(r.matched).toBe(true);
  });

  it("rejects claim-yours acquisition FOMO", () => {
    const r = detectFomoAcquisitionCopy("250 free PackPTS when you join. Claim yours → packpts.com");
    expect(r.matched).toBe(true);
  });

  it("rejects expire-tonight FOMO", () => {
    const r = detectFomoAcquisitionCopy("Points on today's card expire tonight. Name it now.");
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.reason).toMatch(/expire_tonight/);
  });

  it("allows Daily 5 CAPTIONS ritual copy", () => {
    expect(detectFomoAcquisitionCopy(DAILY5_CAPTIONS).matched).toBe(false);
  });

  it("allows earned 250 points streak copy (not a signup bonus)", () => {
    expect(detectFomoAcquisitionCopy("Daily streak complete! You earned 250 points. Keep it going!").matched).toBe(false);
  });

  it("allows Sign up free without bonus FOMO", () => {
    expect(detectFomoAcquisitionCopy("PackPTS is the best way to earn rewards on your baseball cards. Sign up free!").matched).toBe(false);
  });
});

describe("detectMarketingSorViolation — hashtag dumps", () => {
  it("rejects dense hashtag dumps", () => {
    const r = detectMarketingSorViolation(
      "Play Daily 5",
      ["#PackPTS", "#SportsCards", "#TradingCards", "#MLB", "#CardCollector"],
    );
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.reason).toMatch(/hashtag_dump/);
  });

  it("allows sparse #PackPTS #Daily5", () => {
    const r = detectMarketingSorViolation("Daily 5. Guess who. Keep the streak.", ["#PackPTS", "#Daily5"]);
    expect(r.matched).toBe(false);
  });

  it("counts hashtags already in copy against the cap", () => {
    const r = detectMarketingSorViolation(
      "Daily 5 #PackPTS #Daily5 #SportsCards",
      ["#TradingCards"],
    );
    expect(r.matched).toBe(true);
  });
});

describe("validatePostForPublishing — SoR hard reject", () => {
  it("blocks signup-bonus FOMO even with media attached", () => {
    const result = validatePostForPublishing({
      copyText: "New players get 250 free PackPTS on signup. Join thousands of players.",
      contentType: "NEW_USER_ACQUISITION",
      composedImagePath: "/generated/social/spam.png",
      mediaRequired: false,
      hashtags: ["#PackPTS", "#SportsCards", "#TradingCards", "#MLB", "#CardCollector"],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/fomo_acquisition_copy|hashtag_dump/);
  });

  it("blocks 250 free pts copy as text-only CHALLENGE", () => {
    const result = validatePostForPublishing({
      copyText: "Claim your 250 free pts today at https://packpts.com",
      contentType: "CHALLENGE",
      composedImagePath: null,
      mediaRequired: false,
      hashtags: ["#PackPTS"],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/fomo_acquisition_copy/);
  });

  it("allows Marketing-approved Daily 5 ritual copy (manual or auto)", () => {
    const result = validatePostForPublishing({
      copyText: "Daily 5. Guess who. Keep the streak.\n\nKnowledge pays.\n\n→ https://packpts.com/daily",
      contentType: "CHALLENGE",
      composedImagePath: null,
      mediaRequired: false,
      hashtags: ["#PackPTS", "#Daily5"],
    });
    expect(result.blocked).toBe(false);
  });
});

describe("contentGenerator — no signup-bonus spam variants", () => {
  const types: SocialContentType[] = [
    "TRIVIA_CARD",
    "NEW_USER_ACQUISITION",
    "CHALLENGE",
    "LEADERBOARD_HIGHLIGHT",
    "MARKET_PRICE_SPOTLIGHT",
    "REWARD_ANNOUNCEMENT",
    "STREAK_MILESTONE",
  ];

  it("generateFallbackContent never emits 250-free / signup-bonus copy", () => {
    for (const type of types) {
      const copy = generateFallbackContent(type, "https://packpts.com");
      expect(detectFomoAcquisitionCopy(copy).matched).toBe(false);
      expect(copy).toMatch(/Daily 5/i);
    }
  });

  it("generateDraftPost remaps every requested type to Daily 5 SoR copy", async () => {
    for (const type of types) {
      const draft = await generateDraftPost("TWITTER", type, "A", undefined, "announcement");
      expect(draft.contentType).toBe("CHALLENGE");
      expect(detectMarketingSorViolation(draft.copyText, draft.hashtags).matched).toBe(false);
      expect(draft.copyText).toMatch(/Daily 5/i);
      expect(draft.hashtags.length).toBeLessThanOrEqual(MAX_AUTO_HASHTAGS);
      expect(draft.hashtags).toEqual(sparseHashtags());
      expect(draft.copyText.toLowerCase()).not.toContain("250 free");
      expect(draft.copyText.toLowerCase()).not.toContain("signup bonus");
    }
  });

  it("recap drafts stay SoR-clean", async () => {
    const draft = await generateDraftPost("TWITTER", "NEW_USER_ACQUISITION", "B", undefined, "recap");
    expect(draft.copyText).toMatch(/Daily 5/i);
    expect(draft.copyText.toLowerCase()).not.toContain("250 free");
    expect(validatePostForPublishing({
      copyText: draft.copyText,
      contentType: draft.contentType,
      composedImagePath: null,
      mediaRequired: false,
      hashtags: draft.hashtags,
    }).blocked).toBe(false);
  });
});

describe("buildDaily5Copy — CAPTIONS alignment", () => {
  it("announcement A matches post2 ritual lines", () => {
    const copy = buildDaily5Copy("announcement", "A", "https://packpts.com");
    expect(copy).toContain("Daily 5. Guess who. Keep the streak.");
    expect(copy).toContain("Knowledge pays.");
    expect(copy).toContain("https://packpts.com/daily");
  });

  it("sparse hashtags are exactly PackPTS + Daily5", () => {
    expect(sparseHashtags()).toEqual(["#PackPTS", "#Daily5"]);
    expect(collectHashtags("", sparseHashtags()).length).toBe(2);
  });
});
