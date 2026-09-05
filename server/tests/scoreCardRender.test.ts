/**
 * Score-card render contract — no database.
 * Asserts bundled Inter, outlined type (no <text>), and painted PNG pixels.
 */
import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { generateScoreCard, buildScoreCardSvg, buildPipsSvg, SCORE_CARD_SIZE } from "../contentFactory/generateScoreCard";
import { FONT_FILES, resolveFontsDir } from "../contentFactory/fonts";

const TODAY = "2026-09-05";
const created: string[] = [];

afterAll(() => {
  for (const filePath of created) {
    fs.rmSync(filePath, { force: true });
  }
});

function isGreen(r: number, g: number, b: number): boolean {
  return r < 80 && g > 160 && b < 130;
}

function isNearWhite(r: number, g: number, b: number): boolean {
  return r > 220 && g > 220 && b > 220;
}

async function regionHasColor(
  filePath: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pred: (r: number, g: number, b: number) => boolean,
): Promise<boolean> {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * ch;
      if (pred(data[i], data[i + 1], data[i + 2])) return true;
    }
  }
  return false;
}

describe("bundled score-card fonts", () => {
  it("ships Inter TTFs in the deploy tree", () => {
    const dir = resolveFontsDir();
    expect(fs.existsSync(path.join(dir, FONT_FILES.regular))).toBe(true);
    expect(fs.existsSync(path.join(dir, FONT_FILES.semibold))).toBe(true);
    expect(fs.existsSync(path.join(dir, FONT_FILES.bold))).toBe(true);
  });
});

describe("buildPipsSvg()", () => {
  it("fills the first X pips #22C55E and leaves the rest as outlines", () => {
    const svg = buildPipsSvg(3, 5);
    expect((svg.match(/fill="#22C55E"/g) || []).length).toBe(3);
    expect((svg.match(/fill="none"/g) || []).length).toBe(2);
  });
});

describe("score card PNG contract", () => {
  it("paints 3/5 type, green pips, and a legible footer without <text>", async () => {
    const input = {
      username: "Charter",
      score: 525,
      correctCount: 3,
      totalQuestions: 5,
      mode: "daily5",
      date: TODAY,
    };
    const svg = buildScoreCardSvg(input);
    expect(svg).toContain(`width="${SCORE_CARD_SIZE}"`);
    expect(svg).toContain("DAILY 5");
    expect(svg).toContain("3/5");
    expect(svg).toContain("525 pts");
    expect(svg).toContain("Three locked. Two open.");
    expect(svg).toContain("PackPTS");
    expect(svg).toContain("packpts.com/daily");
    expect(svg).toMatch(/<rect width="1024" height="1024" fill="#0b0f16"\/>/);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("#F5C518");
    expect(svg).toContain("data:font/ttf;base64,");
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).not.toContain("sans-serif");

    const result = await generateScoreCard(input, `render-3of5-${Date.now()}`);
    created.push(result.imagePath);
    const meta = await sharp(result.imagePath).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);

    expect(await regionHasColor(result.imagePath, 80, 200, 280, 400, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 80, 660, 720, 720, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 150, 950, 340, 1000, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 720, 950, 1020, 1000, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 80, 560, 136, 616, isGreen)).toBe(true);
    expect(await regionHasColor(result.imagePath, 220, 560, 276, 616, isGreen)).toBe(true);
    expect(await regionHasColor(result.imagePath, 290, 560, 346, 616, isGreen)).toBe(false);
  });
});
