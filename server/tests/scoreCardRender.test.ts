/**
 * Score-card render contract — no database.
 * Asserts bundled Inter, outlined type (no <text>), and painted PNG pixels.
 */
import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
  generateScoreCard,
  buildScoreCardSvg,
  buildPipsSvg,
  buildMaskedStripSvg,
  buildStreakOverlayLabel,
  formatSessionDay,
  formatSessionDayIdentity,
  pipStartX,
  PIP_SIZE,
  PIP_GAP,
  PIP_Y,
  SCORE_CARD_SIZE,
  SCORE_CARD_COLORS,
} from "../contentFactory/generateScoreCard";
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

function isGold(r: number, g: number, b: number): boolean {
  return r > 200 && g > 160 && b < 80;
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

describe("§3b today identity", () => {
  it("formats the session calendar day without UTC-shifting YYYY-MM-DD", () => {
    expect(formatSessionDay("2026-09-08")).toBe("SEP 8");
    expect(formatSessionDayIdentity("2026-09-08", true)).toBe("SEP 8 · TODAY'S FIVE");
    expect(formatSessionDayIdentity("2026-09-08", false)).toBe("SEP 8");
  });

  it("keeps TODAY'S FIVE off non-daily5 cards", () => {
    const svg = buildScoreCardSvg({
      username: "Charter",
      score: 800,
      correctCount: 8,
      totalQuestions: 10,
      mode: "1v1",
      date: "2026-09-08",
    });
    expect(svg).toContain("SEP 8");
    expect(svg).not.toContain("TODAY'S FIVE");
    expect(svg).not.toContain("DAILY 5");
  });
});

describe("buildMaskedStripSvg()", () => {
  it("paints five cream tiles with gold redaction bars", () => {
    const svg = buildMaskedStripSvg();
    expect((svg.match(/fill="#F0F2F5"/g) || []).length).toBe(5);
    expect((svg.match(/fill="#F5C518"/g) || []).length).toBe(5);
  });
});

describe("buildPipsSvg()", () => {
  it("fills the first X pips #22C55E and leaves the rest as outlines", () => {
    const svg = buildPipsSvg(3, 5);
    expect((svg.match(/fill="#22C55E"/g) || []).length).toBe(3);
    expect((svg.match(/fill="none"/g) || []).length).toBe(2);
  });
});

describe("Beat-me 1080 palette + streak overlay", () => {
  it("locks Design Sync colors and never invents a streak", () => {
    expect(SCORE_CARD_COLORS).toEqual({
      canvas: "#0b0f16",
      gold: "#F5C518",
      green: "#22C55E",
      ink: "#F0F2F5",
      muted: "#8F96A3",
    });
    expect(buildStreakOverlayLabel(undefined)).toBeUndefined();
    expect(buildStreakOverlayLabel(0)).toBeUndefined();
    expect(buildStreakOverlayLabel(1)).toBe("1-day streak");
    expect(buildStreakOverlayLabel(4)).toBe("4-day streak");
  });

  it("overlays a real streak on the 1080 card and keeps packpts.com/daily as visual CTA", () => {
    const svg = buildScoreCardSvg({
      username: "dave",
      score: 400,
      correctCount: 4,
      totalQuestions: 5,
      mode: "daily5",
      streak: 4,
      date: TODAY,
    });
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1080"');
    expect(svg).toContain("4/5");
    expect(svg).toContain("4-day streak");
    expect(svg).toContain("TODAY'S FIVE");
    expect(svg).toContain("#0b0f16");
    expect(svg).toContain("#F5C518");
    expect(svg).toContain("#22C55E");
    expect(svg).toContain("#F0F2F5");
    expect(svg).toContain("#8F96A3");
    expect(svg).toContain("packpts.com/daily");
    expect(svg).not.toContain("three-square");
    const noStreak = buildScoreCardSvg({
      username: "dave",
      score: 400,
      correctCount: 4,
      totalQuestions: 5,
      mode: "daily5",
      date: TODAY,
    });
    expect(noStreak).not.toContain("streak");
  });
});

describe("score card PNG contract", () => {
  it("paints 3/5 type, green pips, §3b identity, and a legible footer without <text>", async () => {
    const input = {
      username: "Charter",
      score: 525,
      correctCount: 3,
      totalQuestions: 5,
      mode: "daily5",
      date: "2026-09-08",
    };
    const svg = buildScoreCardSvg(input);
    expect(svg).toContain(`width="${SCORE_CARD_SIZE}"`);
    expect(svg).toContain("DAILY 5");
    expect(svg).toContain("TODAY'S FIVE");
    expect(svg).toContain("SEP 8");
    expect(svg).toContain("3/5");
    expect(svg).toContain("525 pts");
    expect(svg).toContain("Three locked. Two open.");
    expect(svg).toContain("PackPTS");
    expect(svg).toContain("packpts.com/daily");
    expect(svg).toContain(SCORE_CARD_COLORS.ink);
    expect(svg).toContain(SCORE_CARD_COLORS.muted);
    expect(svg).toMatch(/<rect width="1024" height="1024" fill="#0b0f16"\/>/);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("#F5C518");
    expect(svg).toContain("data:font/ttf;base64,");
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).not.toContain("sans-serif");
    expect(svg).not.toContain("PackPoints");
    expect((svg.match(/fill="#F0F2F5"/g) || []).length).toBeGreaterThanOrEqual(5);

    const result = await generateScoreCard(input, `render-3of5-${Date.now()}`);
    created.push(result.imagePath);
    const meta = await sharp(result.imagePath).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);

    const startX = pipStartX(5);
    expect(await regionHasColor(result.imagePath, 360, 230, 720, 430, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 200, 660, 880, 730, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 150, 950, 340, 1000, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 720, 950, 1020, 1000, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, startX, PIP_Y, startX + PIP_SIZE, PIP_Y + PIP_SIZE, isGreen)).toBe(true);
    expect(await regionHasColor(
      result.imagePath,
      startX + 2 * (PIP_SIZE + PIP_GAP),
      PIP_Y,
      startX + 2 * (PIP_SIZE + PIP_GAP) + PIP_SIZE,
      PIP_Y + PIP_SIZE,
      isGreen,
    )).toBe(true);
    expect(await regionHasColor(
      result.imagePath,
      startX + 3 * (PIP_SIZE + PIP_GAP),
      PIP_Y,
      startX + 3 * (PIP_SIZE + PIP_GAP) + PIP_SIZE,
      PIP_Y + PIP_SIZE,
      isGreen,
    )).toBe(false);
    expect(await regionHasColor(result.imagePath, 80, 142, 104, 166, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 80, 148, 104, 160, isGold)).toBe(true);
  });
});
