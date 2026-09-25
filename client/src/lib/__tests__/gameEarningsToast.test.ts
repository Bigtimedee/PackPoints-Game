/**
 * In-game earnings toasts are gone. Crossing a score (500 and the other
 * thresholds) must not toast in solo or Daily 5. The quiet +N row is gone
 * too: points show on Game Complete only. Submit/network errors still toast,
 * and on play routes that toast sits in the bottom band so it does not cover
 * the card.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { isPlaySurface, PLAY_TOAST_VIEWPORT_CLASS } from "../playToastViewport";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");
const matchSrc = readFileSync(new URL("../../pages/match.tsx", import.meta.url), "utf8");
const toasterSrc = readFileSync(new URL("../../components/ui/toaster.tsx", import.meta.url), "utf8");
const toastSrc = readFileSync(new URL("../../components/ui/toast.tsx", import.meta.url), "utf8");

function sliceBetween(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return src.slice(from, to);
}

const EARNINGS_TOAST = /You've earned|this game!|pts!|shownMilestones|in a row!|💰/;

describe("no earnings toast when a total crosses 500", () => {
  it("solo answer success does not toast score, streak, or cap milestones", () => {
    const onSuccess = sliceBetween(
      gameSrc,
      "const submitAnswerMutation = useMutation({",
      "onError: (error: Error) => {",
    );
    expect(onSuccess).not.toMatch(EARNINGS_TOAST);
    expect(onSuccess).not.toContain("toast(");
    expect(onSuccess).not.toContain("500");
    expect(onSuccess).not.toContain("1000");
    expect(onSuccess).not.toContain("pointsEarned");
    expect(onSuccess).not.toContain("setEarnedPoints");
    expect(gameSrc).not.toMatch(EARNINGS_TOAST);
    expect(gameSrc).not.toContain("consecutiveCorrect");
    expect(gameSrc).not.toContain("shownMilestones");
  });

  it("Daily 5 answer success does not toast when the running score updates", () => {
    const onSuccess = sliceBetween(
      daily5Src,
      "const answerMutation = useMutation({",
      "onError: (err: any) => {",
    );
    expect(onSuccess).not.toContain("setScore");
    expect(onSuccess).not.toContain("pointsEarned");
    expect(onSuccess).not.toMatch(EARNINGS_TOAST);
    expect(onSuccess).not.toContain("toast(");
    expect(daily5Src).not.toMatch(EARNINGS_TOAST);
    expect(matchSrc).not.toMatch(EARNINGS_TOAST);
  });
});

describe("Game Complete still shows the session total", () => {
  it("solo Game Complete score still renders and the quiet +N row is gone", () => {
    expect(gameSrc).not.toContain("+{points} pts");
    expect(gameSrc).not.toContain('data-testid="text-points-earned"');
    expect(gameSrc).not.toContain("PointsQuiet");
    expect(gameSrc).not.toContain('data-testid="badge-score"');
    const slot = sliceBetween(gameSrc, 'data-testid="solo-card-slot"', "{/* Zone 3: Answers */}");
    expect(slot).not.toContain("PointsQuiet");
    expect(slot).not.toContain("+{points}");
    const answers = sliceBetween(gameSrc, "{/* Zone 3: Answers */}", "button-submit-answer");
    expect(answers).not.toContain("PointsQuiet");
    expect(answers).not.toMatch(/\bpts\b/);
    expect(gameSrc).toContain('data-testid="text-game-over-title">Game Complete');
    expect(gameSrc).toContain('data-testid="text-final-score">{session.score}');
  });

  it("Daily 5 Game Complete score still renders and the in-play total is gone", () => {
    expect(daily5Src).not.toContain('data-testid="text-d5-score"');
    expect(daily5Src).toContain('data-testid="text-d5-complete">Game Complete');
    expect(daily5Src).toContain('data-testid="text-d5-final-score"');
    const results = sliceBetween(daily5Src, 'data-testid="text-d5-final-score"', "PTS");
    expect(results).toContain("finishResult?.score");
  });
});

describe("error toasts still work and stay off the card", () => {
  it("solo and Daily 5 still toast submit failures", () => {
    const soloError = sliceBetween(
      gameSrc,
      "onError: (error: Error) => {\n      setIsRevealed(false);",
      "const nextQuestionMutation",
    );
    expect(soloError).toContain('title: "Error"');
    expect(soloError).toContain("Failed to submit answer. Please try again.");
    expect(soloError).toContain('variant: "destructive"');

    const dailyError = sliceBetween(
      daily5Src,
      "onError: (err: any) => {\n      toast({ title: \"Error\", description: err.message || \"Failed to submit answer\", variant: \"destructive\" });",
      "const finishMutation",
    );
    expect(dailyError).toContain("Failed to submit answer");
    expect(dailyError).toContain('variant: "destructive"');
  });

  it("play routes pin the toaster to the bottom band above the tab bar", () => {
    expect(isPlaySurface("/game/solo")).toBe(true);
    expect(isPlaySurface("/match/abc")).toBe(true);
    expect(isPlaySurface("/daily5")).toBe(true);
    expect(isPlaySurface("/daily?challenge=1")).toBe(true);
    expect(isPlaySurface("/admin/daily5")).toBe(false);
    expect(isPlaySurface("/marketplace")).toBe(false);

    expect(PLAY_TOAST_VIEWPORT_CLASS).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]");
    expect(PLAY_TOAST_VIEWPORT_CLASS).toContain("max-h-36");
    expect(PLAY_TOAST_VIEWPORT_CLASS).toContain("md:bottom-4");
    expect(PLAY_TOAST_VIEWPORT_CLASS).not.toContain("top-0");
    expect(PLAY_TOAST_VIEWPORT_CLASS).not.toContain("left-1/2");

    expect(toasterSrc).toContain("isPlaySurface");
    expect(toasterSrc).toContain("PLAY_TOAST_VIEWPORT_CLASS");
    expect(toasterSrc).toContain('anchor={play ? "play" : "default"}');
    const playAnchor = toastSrc.slice(toastSrc.indexOf("play:"));
    expect(playAnchor.startsWith('play: "data-[state=open]:slide-in-from-bottom-full"')).toBe(true);
    expect(playAnchor.split("\n")[0]).not.toContain("slide-in-from-top-full");
  });
});
