import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { gameCardMountKey, nextGameCardImageState } from "../gameCardImageState";
import { maskIdentityFromPlayUrl, playImageReportRequest } from "../playImageReport";

const gameCardSrc = readFileSync(new URL("../../components/GameCard.tsx", import.meta.url), "utf8");
const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");

const SESSION = "b1a522c9-6e66-43c1-a9bb-b97d32f21fd7";
const ORIGINAL = `/api/play/m/solo/${SESSION}/1/hmac-landscape?v=${CURRENT_MASK_VERSION}`;
const REPLACEMENT = `/api/play/m/solo/${SESSION}/1/hmac-portrait?v=${CURRENT_MASK_VERSION}`;

describe("same-index replacement clears the failed image", () => {
  it("mount key changes with the masked URL and stays put across reveal", () => {
    const before = gameCardMountKey(SESSION, 1, ORIGINAL);
    const after = gameCardMountKey(SESSION, 1, REPLACEMENT);
    expect(before).not.toBe(after);
    expect(before).toContain(ORIGINAL);
    expect(after).toContain(REPLACEMENT);
    expect(gameCardMountKey(SESSION, 1, ORIGINAL)).toBe(before);
  });

  it("a loaded replacement clears imageError and shows the new image", () => {
    const failed = { imageError: true, imageLoaded: false };
    const cleared = nextGameCardImageState(REPLACEMENT, false);
    expect(failed.imageError).toBe(true);
    expect(cleared.imageError).toBe(false);
    expect(cleared.imageLoaded).toBe(false);

    const shown = nextGameCardImageState(REPLACEMENT, true);
    expect(shown.imageError).toBe(false);
    expect(shown.imageLoaded).toBe(true);
  });

  it("GameCard applies that reset when imageUrl changes and does not post a raw card id", () => {
    expect(gameCardSrc).toContain("if (imageUrl !== imageUrlSeen)");
    expect(gameCardSrc).toContain("nextGameCardImageState(imageUrl, isPlayCardImageReady(imageUrl))");
    expect(gameCardSrc).toContain("key={imageUrl}");
    expect(gameCardSrc).toContain("playImageReportRequest");
    expect(gameCardSrc).not.toContain("/api/cards/");
    expect(gameSrc).toContain("gameCardMountKey(session.id, session.currentQuestionIndex, currentQuestion.card.imageUrl)");
    expect(gameSrc).toContain('playScope="solo"');
  });
});

describe("bad-image report without a card id", () => {
  it("posts scope, session, index, and the mask token", () => {
    const request = playImageReportRequest({
      imageUrl: ORIGINAL,
      reason: "bad_image",
      autoDetected: true,
      detectionReason: "abnormal_aspect_ratio",
    });
    expect(request).not.toBeNull();
    expect(request!.url).toBe("/api/play/report");
    expect(request!.body).toMatchObject({
      scope: "solo",
      sessionId: SESSION,
      questionIndex: 1,
      reason: "bad_image",
      token: "hmac-landscape",
      autoDetected: true,
      detectionReason: "abnormal_aspect_ratio",
    });
    expect(request!.body).not.toHaveProperty("cardId");
    expect(JSON.stringify(request)).not.toContain("playableCardId");
  });

  it("uses session coordinates when the src is already the reveal URL", () => {
    const request = playImageReportRequest({
      imageUrl: `/api/play/r/solo/${SESSION}/1/999/reveal-token`,
      scope: "solo",
      sessionId: SESSION,
      questionIndex: 1,
      reason: "bad_image",
    });
    expect(maskIdentityFromPlayUrl(`/api/play/r/solo/${SESSION}/1/999/reveal-token`)).toBeNull();
    expect(request!.url).toBe("/api/play/report");
    expect(request!.body).not.toHaveProperty("cardId");
    expect(request!.body).not.toHaveProperty("token");
    expect(request!.body.questionIndex).toBe(1);
  });

  it("does nothing when there is no card id and no play coordinates", () => {
    expect(playImageReportRequest({ reason: "bad_image" })).toBeNull();
  });
});
