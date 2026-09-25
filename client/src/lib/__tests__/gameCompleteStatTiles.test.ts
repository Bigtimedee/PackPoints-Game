/**
 * Game Complete stat tiles at a phone width. "4 of 5" wrapped to three
 * lines. The value is "4/5" on one line, and the three tiles stretch to
 * the same height. Longer values ("20/20", "100%", "12500") step the
 * font down so they stay inside the tile.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { statTileValueFontPx, statTileValueInkPx, STAT_TILE_FONT_MIN_PX, STAT_TILE_FONT_MAX_PX, STAT_TILE_INK_PX } from "../statTileValue";

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
    expect(grid).not.toContain("text-ellipsis");
    expect(grid).not.toContain("truncate");
    expect(grid).not.toContain("line-clamp");
    expect(grid).not.toContain("h-[");
    expect(grid.match(/whitespace-nowrap/g)).toHaveLength(3);
    expect(grid.match(/leading-9/g)).toHaveLength(3);
    expect(grid).toContain("statTileValueFontPx(session.score)");
    expect(grid).toContain("statTileValueFontPx(`${accuracy}%`)");
    expect(grid).toContain("statTileValueFontPx(`${session.correctAnswers}/${effectiveTotal}`)");
    expect(grid).not.toContain("text-3xl");
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
    expect(grid).toContain("{d5Fraction}");
    expect(daily5Src).toContain("const d5Fraction = `${d5Correct}/5`");
    expect(grid).not.toContain(" of ");
    expect(grid).not.toContain("overflow-hidden");
    expect(grid).not.toContain("text-ellipsis");
    expect(grid).not.toContain("truncate");
    expect(grid).not.toContain("line-clamp");
    expect(grid).not.toContain("h-[");
    expect(grid.match(/whitespace-nowrap/g)).toHaveLength(3);
    expect(grid.match(/leading-9/g)).toHaveLength(3);
    expect(grid).toContain("statTileValueFontPx(d5Points)");
    expect(grid).toContain("statTileValueFontPx(d5Accuracy)");
    expect(grid).toContain("statTileValueFontPx(d5Fraction)");
    expect(grid).not.toContain("text-3xl");
    expect(daily5Src.indexOf('data-testid="grid-d5-final-stats"')).toBeLessThan(
      daily5Src.indexOf('data-testid="block-d5-beat-me-compare"'),
    );
  });

  it("steps the value down to an 18px floor so the worst cases fit one line", () => {
    const cases: Array<[string, number]> = [
      ["20/20", 18],
      ["12/12", 18],
      ["3500", 23],
      ["100%", 23],
      ["12500", 18],
      ["-", 30],
    ];
    for (const [value, size] of cases) {
      expect(statTileValueFontPx(value)).toBe(size);
      expect(size).toBeGreaterThanOrEqual(STAT_TILE_FONT_MIN_PX);
      expect(size).toBeLessThanOrEqual(STAT_TILE_FONT_MAX_PX);
      expect(statTileValueInkPx(value)).toBeLessThanOrEqual(STAT_TILE_INK_PX);
    }
  });
});
