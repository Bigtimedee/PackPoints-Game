/**
 * Game Complete stat tiles at a phone width. "4 of 5" in text-3xl mono
 * wraps to three lines and the Score tile grows. The value is "4/5" on
 * one line, and the three tiles stretch to the same height.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");

function sliceBetween(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe("Game Complete stat tiles", () => {
  it("solo score is correct/scored on one line and the three tiles stretch", () => {
    const grid = sliceBetween(gameSrc, 'data-testid="grid-final-stats"', "skippedQuestions");
    const gridOpen = gameSrc.slice(gameSrc.indexOf('data-testid="grid-final-stats"') - 120, gameSrc.indexOf('data-testid="grid-final-stats"'));
    expect(gridOpen + grid).toContain("grid grid-cols-3 gap-3 items-stretch");
    expect(grid.match(/h-full p-4 rounded-md bg-muted flex flex-col/g)).toHaveLength(3);
    expect(grid).toContain('data-testid="text-final-score">{session.score}');
    expect(grid).toContain('data-testid="text-accuracy">{accuracy}%');
    expect(grid).toContain('data-testid="text-final-correct">{session.correctAnswers}/{effectiveTotal}');
    expect(grid).not.toContain(" of ");
    expect(grid).not.toContain("overflow-hidden");
    expect(grid).not.toContain("h-[");
    expect(grid.match(/whitespace-nowrap/g)).toHaveLength(3);
    expect(grid.match(/text-3xl font-bold font-mono/g)).toHaveLength(3);
  });

  it("Daily 5 and Beat-me share the same X/5 tiles", () => {
    const grid = sliceBetween(daily5Src, 'data-testid="grid-d5-final-stats"', 'data-testid="block-d5-beat-me-compare"');
    const gridOpen = daily5Src.slice(
      daily5Src.indexOf('data-testid="grid-d5-final-stats"') - 140,
      daily5Src.indexOf('data-testid="grid-d5-final-stats"'),
    );
    expect(gridOpen + grid).toContain("grid grid-cols-3 gap-3 items-stretch");
    expect(grid.match(/h-full p-4 rounded-md bg-muted text-center flex flex-col/g)).toHaveLength(3);
    expect(grid).toContain('data-testid="text-d5-final-score"');
    expect(grid).toContain('data-testid="text-d5-final-correct"');
    expect(grid).toContain("}/5");
    expect(grid).not.toContain(" of ");
    expect(grid).not.toContain("overflow-hidden");
    expect(grid).not.toContain("h-[");
    expect(grid.match(/whitespace-nowrap/g)).toHaveLength(3);
    expect(grid.match(/text-3xl font-bold font-mono/g)).toHaveLength(3);
    expect(daily5Src.indexOf('data-testid="grid-d5-final-stats"')).toBeLessThan(
      daily5Src.indexOf('data-testid="block-d5-beat-me-compare"'),
    );
  });
});
