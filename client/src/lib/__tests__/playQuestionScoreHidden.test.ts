/**
 * After an answer, play shows the card, the question, the marked choices,
 * then the next control. No per-question earnings copy in that gap.
 * The session total stays on Game Complete.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");
const matchSrc = readFileSync(new URL("../../pages/match.tsx", import.meta.url), "utf8");

function sliceBetween(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return src.slice(from, to);
}

const EARNINGS_COPY = /\bpts\b|Base:|Player:/;

describe("no per-question earnings between the answers and next", () => {
  it("solo revealed stack is answers, Next Question, then Report Wrong Image", () => {
    const playFrom = gameSrc.indexOf('data-testid="game-active-viewport"');
    expect(playFrom).toBeGreaterThanOrEqual(0);
    const play = gameSrc.slice(playFrom);
    expect(play).not.toMatch(EARNINGS_COPY);
    expect(play).not.toContain("Lesser Known");
    expect(play).not.toContain("badge-score");
    expect(play).not.toContain("min-h-");

    const zone = sliceBetween(play, 'aria-label="Answer choices"', "Report Wrong Image");
    const nextAt = zone.indexOf('data-testid="button-next-question"');
    expect(nextAt).toBeGreaterThan(0);
    expect(zone.slice(nextAt)).toContain("Next Question");
    expect(play.indexOf("Report Wrong Image")).toBeGreaterThan(play.indexOf('data-testid="button-next-question"'));

    const gap = zone.slice(0, nextAt);
    expect(gap).not.toMatch(EARNINGS_COPY);
    expect(gap).not.toContain("min-h");
    expect(gap).toContain('className="pt-2"');
    expect(gameSrc).toContain('data-testid="text-final-score">{session.score}');
    expect(gameSrc).toContain('data-testid="text-game-over-title">Game Complete');
  });

  it("Daily 5 revealed stack has no pts, Base:, or Player: before Next", () => {
    const playing = sliceBetween(
      daily5Src,
      'if (gameState === "playing" && currentCard)',
      'if (gameState === "results")',
    );
    expect(playing).not.toMatch(EARNINGS_COPY);
    expect(playing).not.toContain("Lesser Known");
    expect(playing).not.toContain("text-d5-score");

    const fromAnswers = playing.slice(playing.indexOf('data-testid="d5-answer-options"'));
    const nextLabel = fromAnswers.indexOf("Next Card");
    expect(nextLabel).toBeGreaterThan(0);
    const gap = fromAnswers.slice(0, nextLabel);
    expect(gap).not.toMatch(EARNINGS_COPY);
    expect(gap).not.toContain("min-h");
    expect(gap).toContain('data-testid="button-d5-next"');

    const results = sliceBetween(daily5Src, 'data-testid="text-d5-complete"', "ShareResultCard");
    expect(results).toContain("Game Complete");
    expect(results).toContain('data-testid="text-d5-final-score"');
    expect(results).toContain("finishResult?.score");
  });

  it("1v1 in-match header shows correct-answer counts and no pts", () => {
    const header = sliceBetween(matchSrc, 'data-testid="text-my-username"', "<Progress");
    expect(header).not.toMatch(/\bpts\b/);
    expect(header).not.toContain("me?.score");
    expect(header).not.toContain("opponent?.score");
    expect(header).not.toContain("pointValue");
    expect(header).toContain('className="text-lg font-bold font-mono" data-testid="text-my-score">You {me?.correctAnswers ?? 0}');
    expect(header).toContain('className="text-lg font-bold font-mono" data-testid="text-opponent-score">Opp {opponent?.correctAnswers ?? 0}');
    expect(matchSrc).toContain('data-testid="battle-series-tally"');

    const play = sliceBetween(matchSrc, 'data-testid="text-my-username"', 'data-testid="button-submit-answer"');
    expect(play).not.toMatch(EARNINGS_COPY);
    expect(play).not.toContain("Lesser Known");

    const answersAt = play.indexOf('aria-label="Answer choices"');
    expect(answersAt).toBeGreaterThan(0);
    const underAnswers = play.slice(answersAt);
    expect(underAnswers.length).toBeGreaterThan(0);
    expect(underAnswers).not.toMatch(EARNINGS_COPY);
    expect(matchSrc).toContain('data-testid="text-my-final-score">{meResult?.score || 0}');
    expect(matchSrc).toContain('data-testid="text-opponent-final-score">{opponentResult?.score || 0}');

    const wsSrc = readFileSync(new URL("../../../../server/websocket.ts", import.meta.url), "utf8");
    const blocks: string[] = [];
    let from = 0;
    while (true) {
      const at = wsSrc.indexOf('type: "participant_answered"', from);
      if (at < 0) break;
      blocks.push(wsSrc.slice(at, at + 700));
      from = at + 1;
    }
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of blocks) {
      expect(block).toContain("correctAnswers: p.correctAnswers");
    }
  });
});
