/**
 * Daily 5 set label. Name only, hidden when the status API sends null.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { Daily5SetLabel } from "../../components/Daily5SetLabel";
import { formatDaily5ShareText, formatTodaysSetLabel } from "../daily5SetLabel";

const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");

function renderLabel(setName: string | null | undefined): string {
  return renderToStaticMarkup(createElement(Daily5SetLabel, { setName }));
}

describe("Daily 5 today's set label", () => {
  it("shows TODAY'S SET and the set title", () => {
    const html = renderLabel("1987 Topps Football");
    expect(html).toContain('data-testid="text-d5-todays-set"');
    expect(html).toContain("max-w-[320px]");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("#8F96A3");
    expect(html).toMatch(/TODAY(?:&#x27;|')S SET {2}1987 TOPPS FOOTBALL/);
    expect(html).not.toMatch(/SET\s*[-–—]/);
    expect(formatTodaysSetLabel("1987 Topps Football")).toBe("TODAY'S SET  1987 TOPPS FOOTBALL");
  });

  it("hides the line when the set name is null", () => {
    expect(renderLabel(null)).toBe("");
    expect(renderLabel(undefined)).toBe("");
    expect(renderLabel("   ")).toBe("");
  });

  it("includes the set name in the share text", () => {
    const html = renderToStaticMarkup(
      createElement("p", { "data-testid": "text-d5-share-caption" }, formatDaily5ShareText(4, "1987 Topps Football")),
    );
    expect(html).toContain("Daily 5. 1987 Topps Football. 4/5.");
    expect(formatDaily5ShareText(4, null)).toBe("Daily 5. 4/5.");
    expect(formatDaily5ShareText(4, "1987 Topps Football")).not.toMatch(/[-–—]/);
  });

  it("wraps at 320px and does not truncate", () => {
    const longName = "Nineteen Eighty Seven Topps Football Traded Update";
    const html = renderLabel(longName);
    expect(html).toContain("max-w-[320px]");
    expect(html).toContain("break-words");
    expect(html).toContain(longName.toUpperCase());
    expect(html).not.toMatch(/\btruncate\b|ellipsis|line-clamp|whitespace-nowrap/);
  });

  it("keeps the label in the header and above the score, outside the answer stack", () => {
    const playing = daily5Src.slice(
      daily5Src.indexOf('if (gameState === "playing" && currentCard)'),
      daily5Src.indexOf('if (gameState === "results")'),
    );
    const labelAt = playing.indexOf("<Daily5SetLabel");
    const cardAt = playing.indexOf("<GameCard");
    const answersAt = playing.indexOf('data-testid="d5-answer-options"');
    const nextAt = playing.indexOf('data-testid="button-d5-next"');
    expect(labelAt).toBeGreaterThan(0);
    expect(labelAt).toBeLessThan(cardAt);
    expect(cardAt).toBeLessThan(answersAt);
    expect(answersAt).toBeLessThan(nextAt);
    const gap = playing.slice(answersAt, nextAt);
    expect(gap).not.toContain("Daily5SetLabel");

    const results = daily5Src.slice(
      daily5Src.indexOf('if (gameState === "results")'),
      daily5Src.indexOf("<ShareResultCard"),
    );
    const resultsLabel = results.indexOf("<Daily5SetLabel");
    const scoreAt = results.indexOf('data-testid="grid-d5-final-stats"');
    expect(resultsLabel).toBeGreaterThan(0);
    expect(resultsLabel).toBeLessThan(scoreAt);
    expect(daily5Src).toContain("formatDaily5ShareText");
  });
});
