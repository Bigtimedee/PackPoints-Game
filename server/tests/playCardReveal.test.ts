import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { DEFAULT_MASK_REGIONS } from "@shared/schema";

const replaceSrc = readFileSync(new URL("../services/matches/replaceQuestion.ts", import.meta.url), "utf8");
const websocketSrc = readFileSync(new URL("../websocket.ts", import.meta.url), "utf8");
const matchServiceSrc = readFileSync(new URL("../services/matchService.ts", import.meta.url), "utf8");

describe("1v1 replace stays masked during guessing", () => {
  it("replacement imageUrl uses maskedCardImageUrl, not the original proxy", () => {
    expect(replaceSrc).toContain("maskedCardImageUrl(availableCard.id)");
    expect(replaceSrc).not.toContain("`/api/images/card/${availableCard.id}`");
    expect(replaceSrc).not.toContain('"/api/images/card/${availableCard.id}"');
    expect((replaceSrc.match(/maskedCardImageUrl\(availableCard\.id\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("v4.x localization floor is unchanged", () => {
    expect(CURRENT_MASK_VERSION).toBe("v4.3");
    expect(DEFAULT_MASK_REGIONS[0]?.hPct).toBe(46);
  });
});

describe("1v1 overlay setKey: gameSetId on the wire", () => {
  it("sanitizeMatchStateForClient passes gameSetId through", () => {
    expect(websocketSrc).toContain("gameSetId: matchState.gameSetId");
  });

  it("sanitizeMatchStateForClient sends upcoming card ids for masked prefetch, not names", () => {
    expect(websocketSrc).toContain("upcomingMaskedCardIds");
    expect(websocketSrc).toContain(".slice(matchState.currentQuestionIndex + 1)");
    expect(websocketSrc).not.toContain("upcomingMaskedCardIds: matchState.questions.map");
  });

  it("match create persists lobby gameSetId as cardSetId", () => {
    expect(matchServiceSrc).toContain("cardSetId: lobby.gameSetId || null");
    expect(matchServiceSrc).toContain("gameSetId: lobby.gameSetId || undefined");
    expect(matchServiceSrc).toContain("gameSetId: match.cardSetId || undefined");
  });
});
