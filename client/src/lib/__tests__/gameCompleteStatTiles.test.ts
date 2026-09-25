/**
 * Game Complete stat tiles at a phone width. "4 of 5" wrapped to three
 * lines. The value is "4/5" on one line, and the three tiles stretch to
 * the same height. Longer values ("20/20", "100%", "12500") step the
 * font down so they stay inside the tile.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { statTileValueFontPx, statTileValueInkPx, STAT_TILE_FONT_MIN_PX, STAT_TILE_FONT_MAX_PX, STAT_TILE_INK_PX } from "../statTileValue";
import {
  daily5StatTileBorderPx,
  soloStatTileBorderPx,
  statTileContentPx,
  statTileLabelInkPx,
  statTileLabelIsNarrow,
  STAT_TILE_CONTENT_MIN_PX,
  STAT_TILE_LABEL_NARROW_PX,
  STAT_TILE_LABEL_SWITCH_PX,
  STAT_TILE_LABEL_WIDE_PX,
  STAT_TILE_PAD_X_MAX_PX,
  STAT_TILE_PAD_X_MIN_PX,
} from "../statTileLabel";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");
const cssSrc = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

const TILE_CLASS = "stat-tile h-full py-4 rounded-md bg-muted flex flex-col text-center";

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
    expect(grid.match(new RegExp(TILE_CLASS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(3);
    expect(grid.match(/stat-tile-label/g)).toHaveLength(3);
    expect(grid).not.toContain("max-[384px]");
    expect(grid).not.toContain("tracking-wider");
    expect(grid).not.toContain("text-ellipsis");
    expect(grid).toContain('data-testid="text-final-score">{session.score}');
    expect(grid).toContain('data-testid="text-accuracy">{accuracy}%');
    expect(grid).toContain('data-testid="text-final-correct">{session.correctAnswers}/{effectiveTotal}');
    expect(grid).not.toContain(" of ");
    expect(grid).not.toContain("overflow-hidden");
    expect(grid).not.toContain("text-ellipsis");
    expect(grid).not.toContain("truncate");
    expect(grid).not.toContain("line-clamp");
    expect(grid).not.toContain("h-[");
    expect(grid.match(/whitespace-nowrap/g)).toHaveLength(6);
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
    expect(grid.match(new RegExp(TILE_CLASS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(3);
    expect(grid.match(/stat-tile-label/g)).toHaveLength(3);
    expect(grid).not.toContain("max-[384px]");
    expect(grid).not.toContain("tracking-wider");
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
    expect(grid.match(/whitespace-nowrap/g)).toHaveLength(6);
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

  it("fits values and labels inside the content box at 320, 360, 390, and 430", () => {
    expect(cssSrc).toContain("container-type: inline-size");
    expect(cssSrc).toContain("container-name: stat-tile");
    expect(cssSrc).toContain(
      `padding-inline: clamp(${STAT_TILE_PAD_X_MIN_PX}px, calc((100% - ${STAT_TILE_CONTENT_MIN_PX}px) / 2), ${STAT_TILE_PAD_X_MAX_PX}px)`,
    );
    expect(cssSrc).toContain(`@container stat-tile (width < ${STAT_TILE_LABEL_SWITCH_PX}px)`);
    expect(cssSrc).toContain(`font-size: ${STAT_TILE_LABEL_WIDE_PX}px`);
    expect(cssSrc).toContain("letter-spacing: 0.05em");
    expect(cssSrc).toContain(`font-size: ${STAT_TILE_LABEL_NARROW_PX}px`);
    expect(cssSrc).toContain("letter-spacing: 0;");
    expect(cssSrc).toContain("text-transform: uppercase");
    expect(cssSrc).toContain("white-space: nowrap");
    expect(cssSrc).not.toContain("text-overflow: ellipsis");
    expect(gameSrc).not.toContain("max-[384px]");
    expect(daily5Src).not.toContain("max-[384px]");

    const modes = [
      ["solo", soloStatTileBorderPx],
      ["daily5", daily5StatTileBorderPx],
    ] as const;
    const values = ["12500", "20/20", "100%", "3500", "-"];
    for (const [mode, tileBorder] of modes) {
      for (const viewport of [320, 360, 390, 430]) {
        const content = statTileContentPx(tileBorder(viewport));
        expect(content, `${mode} ${viewport}`).toBeGreaterThanOrEqual(STAT_TILE_CONTENT_MIN_PX);
        const box = Math.floor(content + 1e-9);
        for (const value of values) {
          expect(statTileValueFontPx(value)).toBeGreaterThanOrEqual(STAT_TILE_FONT_MIN_PX);
          const ink = statTileValueInkPx(value);
          expect(Math.ceil(ink - 1e-9), `${mode} ${viewport} ${value}`).toBeLessThanOrEqual(box);
        }
        for (const label of ["ACCURACY", "PTS", "SCORE"] as const) {
          const ink = statTileLabelInkPx(label, content);
          expect(Math.ceil(ink - 1e-9), `${mode} ${viewport} ${label}`).toBeLessThanOrEqual(box);
        }
      }
    }

    // The 12px tracked label is the overflow QA measured (72px vs 57px and 69px).
    const solo390 = statTileContentPx(soloStatTileBorderPx(390));
    const daily360 = statTileContentPx(daily5StatTileBorderPx(360));
    expect(statTileLabelIsNarrow(solo390)).toBe(true);
    expect(statTileLabelIsNarrow(daily360)).toBe(true);
    expect(statTileLabelInkPx("ACCURACY", solo390)).toBeLessThanOrEqual(solo390);
    expect(statTileLabelInkPx("ACCURACY", daily360)).toBeLessThanOrEqual(daily360);
    const wideAccuracy = (11546 * STAT_TILE_LABEL_WIDE_PX) / 2048 + STAT_TILE_LABEL_WIDE_PX * 0.05 * 7;
    expect(wideAccuracy).toBeGreaterThan(solo390);
    expect(wideAccuracy).toBeGreaterThan(daily360);

    // A wider Daily 5 tile keeps the 12px label, and that label still fits.
    const daily390 = statTileContentPx(daily5StatTileBorderPx(390));
    expect(statTileLabelIsNarrow(daily390)).toBe(false);
    expect(Math.ceil(wideAccuracy - 1e-9)).toBeLessThanOrEqual(Math.floor(daily390 + 1e-9));
  });
});
