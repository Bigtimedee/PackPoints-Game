import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  DAILY5_NEXT_PLAY,
  PLAY_AGAIN_BUTTON_CLASS,
  replayCardCountFromSession,
  replaySetIdFromSession,
} from "../playAgain";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");
const matchSrc = readFileSync(new URL("../../pages/match.tsx", import.meta.url), "utf8");
const signupSrc = readFileSync(new URL("../../components/signup-modal.tsx", import.meta.url), "utf8");

describe("replay session helpers", () => {
  it("reads set id from the first question card", () => {
    expect(replaySetIdFromSession({
      questions: [{ card: { gameSetId: "set-1994-topps" } }],
    })).toBe("set-1994-topps");
  });

  it("returns null when the session has no set", () => {
    expect(replaySetIdFromSession(null)).toBeNull();
    expect(replaySetIdFromSession({ questions: [] })).toBeNull();
    expect(replaySetIdFromSession({ questions: [{ card: {} }] })).toBeNull();
  });

  it("keeps the dealt card count (not scored-after-skips)", () => {
    expect(replayCardCountFromSession({ totalQuestions: 10 })).toBe(10);
    expect(replayCardCountFromSession({ totalQuestions: 5 })).toBe(5);
    expect(replayCardCountFromSession({ totalQuestions: 4 })).toBeNull();
    expect(replayCardCountFromSession({ totalQuestions: 21 })).toBeNull();
  });

  it("uses a mobile-safe full-width tap target", () => {
    expect(PLAY_AGAIN_BUTTON_CLASS).toContain("min-h-11");
    expect(PLAY_AGAIN_BUTTON_CLASS).toContain("w-full");
  });
});

describe("Daily 5 next play is honest", () => {
  it("does not label the CTA Play Again (today's five cannot be re-run)", () => {
    expect(DAILY5_NEXT_PLAY.primary.label).toBe("Play Solo");
    expect(DAILY5_NEXT_PLAY.primary.href).toBe("/game/solo");
    expect(DAILY5_NEXT_PLAY.secondary.label).toBe("Browse Sets");
    expect(DAILY5_NEXT_PLAY.secondary.href).toBe("/sets");
    expect(DAILY5_NEXT_PLAY.doneNote).toMatch(/tomorrow/i);
    expect(DAILY5_NEXT_PLAY.primary.label).not.toMatch(/play again/i);
  });
});

describe("Game Complete surfaces", () => {
  it("solo Game Complete restarts the same session via Play Again", () => {
    expect(gameSrc).toContain('data-testid="button-play-again"');
    expect(gameSrc).toContain("handlePlayAgain");
    expect(gameSrc).toContain("replaySetIdFromSession");
    expect(gameSrc).toContain("replayCardCountFromSession");
    expect(gameSrc).toContain("startGameMutation.mutate");
    expect(gameSrc).toContain("PLAY_AGAIN_BUTTON_CLASS");
    expect(gameSrc).toMatch(/onPlayAgain=\{handlePlayAgain\}/);
  });

  it("solo Play Again is not gated on auth", () => {
    const playAgainBlock = gameSrc.slice(
      gameSrc.indexOf("if (isGameOver)"),
      gameSrc.indexOf("const currentQuestion = session.questions"),
    );
    expect(playAgainBlock).toContain('data-testid="button-play-again"');
    expect(playAgainBlock).not.toMatch(/isAuthenticated && \([^)]*button-play-again/);
  });

  it("Daily 5 Game Complete offers Play Solo / Browse Sets, not same-day Daily 5", () => {
    expect(daily5Src).toContain("DAILY5_NEXT_PLAY");
    expect(daily5Src).toContain("DAILY5_NEXT_PLAY.primary");
    expect(daily5Src).toContain("DAILY5_NEXT_PLAY.secondary");
    const resultsIdx = daily5Src.indexOf('if (gameState === "results")');
    const resultsBlock = resultsIdx >= 0 ? daily5Src.slice(resultsIdx, resultsIdx + 8000) : daily5Src;
    expect(resultsBlock).toContain("ShareResultCard");
    expect(resultsBlock).not.toMatch(/Play Again/);
  });

  it("1v1 complete keeps Play Again and falls back to Play Solo when rematch is declined", () => {
    expect(matchSrc).toContain('data-testid="button-play-again"');
    expect(matchSrc).toContain("MATCH_FALLBACK_PLAY");
  });

  it("guest signup modal can replay without creating an account", () => {
    expect(signupSrc).toContain("onPlayAgain");
    expect(signupSrc).toContain("button-modal-play-again");
    expect(signupSrc).toContain("Play Again");
  });
});
