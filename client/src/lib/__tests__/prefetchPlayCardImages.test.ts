import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { revealPlayUrl } from "@shared/playCardImage";
import {
  remainingPlayCardIds,
  prefetchMaskedPlayCards,
  prefetchRevealPlayCard,
} from "../prefetchPlayCardImages";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");
const matchSrc = readFileSync(new URL("../../pages/match.tsx", import.meta.url), "utf8");

describe("remainingPlayCardIds", () => {
  it("keeps the current card and every later id", () => {
    expect(remainingPlayCardIds(["a", "b", "c", "d"], 1)).toEqual(["b", "c", "d"]);
  });

  it("drops blanks", () => {
    expect(remainingPlayCardIds(["a", "", null, "d"], 0)).toEqual(["a", "d"]);
  });
});

describe("prefetchMaskedPlayCards", () => {
  it("returns current-bake masked URLs only", () => {
    const urls = prefetchMaskedPlayCards(["card-1", "card-2"]);
    expect(urls).toEqual([
      `/api/cards/card-1/masked-image?v=${CURRENT_MASK_VERSION}`,
      `/api/cards/card-2/masked-image?v=${CURRENT_MASK_VERSION}`,
    ]);
    expect(urls.every((url) => url.includes("masked-image"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/images/card/"))).toBe(false);
  });
});

describe("prefetchRevealPlayCard", () => {
  it("is the unmasked proxy and is not used for guessing prefetch", () => {
    expect(prefetchRevealPlayCard("card-1")).toBe(revealPlayUrl("card-1"));
    expect(revealPlayUrl("card-1")).not.toContain("masked-image");
  });
});

describe("play surfaces prefetch remaining masked cards", () => {
  it("solo prefetches remaining ids as soon as the session is known", () => {
    expect(gameSrc).toContain("prefetchMaskedPlayCards(remainingCardIds)");
    expect(gameSrc).toContain("remainingPlayCardIds");
    expect(gameSrc).toContain("prefetchRevealPlayCard(currentPlayCardId)");
  });

  it("solo Next paints the next known card before /api/game/next ACK", () => {
    const handleNext = gameSrc.slice(
      gameSrc.indexOf("const handleNextQuestion"),
      gameSrc.indexOf("const handlePlayAgain"),
    );
    expect(handleNext).toContain("currentQuestionIndex: nextIndex");
    expect(handleNext).toContain("setIsRevealed(false)");
    expect(handleNext).toContain("nextQuestionMutation.mutate");
  });

  it("Daily 5 prefetches remaining positions when the five are known", () => {
    expect(daily5Src).toContain("prefetchMaskedPlayCards(remaining)");
    expect(daily5Src).toContain("card.position >= currentPosition");
    expect(daily5Src).toContain("prefetchRevealPlayCard(currentCard.cardId)");
  });

  it("1v1 prefetches current + upcomingMaskedCardIds and does not cache-bust first paint", () => {
    expect(matchSrc).toContain("upcomingMaskedCardIds");
    expect(matchSrc).toContain("prefetchMaskedPlayCards");
    expect(matchSrc).toContain("imageRetryCount > 0");
    expect(matchSrc).not.toContain("t=${seedVersion}-${imageRetryCount}-${matchState.currentQuestionIndex}");
  });
});
