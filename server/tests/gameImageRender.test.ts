/**
 * Social game-image render contract — no database, no CardHedge.
 * Asserts bundled Inter, outlined type (no <text>), and painted PNG pixels.
 * Missing fonts / bare sans-serif <text> = blank navy / tofu on Railway Alpine.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { FONT_FILES, assertShareFontsPresent, resolveFontsDir } from "../contentFactory/fonts";
import {
  SOCIAL_DESIGN_EXPORTS,
  readSocialDesignExport,
  socialDesignFileName,
} from "../services/socialMedia/designExports";
import {
  DIMENSIONS,
  GAME_IMAGE_COLORS,
  buildCardOverlaySvg,
  buildChallengeSvg,
  buildLeaderboardSvg,
  buildNewUserSvg,
  buildRewardSvg,
  buildStreakSvg,
  renderSocialSvgToPng,
} from "../services/socialMedia/gameImageRenderer";

const { width: W, height: H } = DIMENSIONS.TWITTER;

function isGold(r: number, g: number, b: number): boolean {
  return r > 230 && g > 190 && b < 50;
}

function isNearWhite(r: number, g: number, b: number): boolean {
  return r > 220 && g > 220 && b > 220;
}

function isMuted(r: number, g: number, b: number): boolean {
  return r > 150 && r < 200 && g > 150 && g < 200 && b > 180;
}

function isOrange(r: number, g: number, b: number): boolean {
  return r > 230 && g > 80 && g < 140 && b < 40;
}

function isBlue(r: number, g: number, b: number): boolean {
  return r < 100 && g > 140 && b > 220;
}

function isGreen(r: number, g: number, b: number): boolean {
  return r < 140 && g > 220 && b < 140;
}

function isPurple(r: number, g: number, b: number): boolean {
  return r > 180 && g > 100 && g < 180 && b > 220;
}

async function regionHasColor(
  png: Buffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pred: (r: number, g: number, b: number) => boolean,
): Promise<boolean> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * ch;
      if (pred(data[i], data[i + 1], data[i + 2])) return true;
    }
  }
  return false;
}

function assertOutlined(svg: string, labels: string[]): void {
  expect(svg).not.toMatch(/<text[\s>]/);
  expect(svg).not.toContain("sans-serif");
  expect(svg).toContain("data:font/ttf;base64,");
  expect(svg).toContain("@font-face");
  expect(svg).toContain("<path d=");
  for (const label of labels) {
    expect(svg).toContain(label);
  }
}

describe("bundled social-image fonts", () => {
  it("ships Inter TTFs used by gameImageRenderer", () => {
    const dir = resolveFontsDir();
    expect(fs.existsSync(path.join(dir, FONT_FILES.regular))).toBe(true);
    expect(fs.existsSync(path.join(dir, FONT_FILES.semibold))).toBe(true);
    expect(fs.existsSync(path.join(dir, FONT_FILES.bold))).toBe(true);
  });

  it("SOCIAL_PNG_QA: Inter + DejaVu paths exist (build fails if missing)", () => {
    const found = assertShareFontsPresent();
    expect(fs.existsSync(found.interRegular)).toBe(true);
    expect(fs.existsSync(found.interBold)).toBe(true);
    expect(fs.existsSync(found.dejaVuRegular)).toBe(true);
    expect(found.dejaVuRegular).toMatch(/DejaVuSans\.ttf$/);
  });
});

describe("social SVG composers outline type", () => {
  it("leaderboard / streak / challenge / join / reward / card overlay never emit <text>", () => {
    assertOutlined(buildLeaderboardSvg(W, H, "Charter", 1234), [
      "LEADERBOARD",
      "#1",
      "Charter",
      "1,234 pts today",
      "Can you take the top spot?",
      "PackPTS.com",
    ]);
    assertOutlined(buildStreakSvg(W, H, 7), ["STREAK", "7", "DAY STREAK", "Daily play = bonus points"]);
    assertOutlined(buildChallengeSvg(W, H, 2500), ["CHALLENGE", "2,500", "Card experts only."]);
    assertOutlined(buildNewUserSvg(W, H, 0), ["JOIN NOW", "Thousands", "Free to play. Real rewards."]);
    assertOutlined(buildRewardSvg(W, H, "500"), ["REWARD", "500", "PackPTS pays you to play."]);
    assertOutlined(buildCardOverlaySvg(W, H, "TRIVIA CARD", GAME_IMAGE_COLORS.gold, "1987 Topps"), [
      "TRIVIA CARD",
      "PackPTS.com",
      "1987 Topps",
    ]);
  });
});

describe("social PNG tofu guard", () => {
  it("paints leaderboard type — blank navy / tofu fails these regions", async () => {
    const svg = buildLeaderboardSvg(W, H, "Charter", 1234);
    const png = await renderSocialSvgToPng(svg);
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);

    // Outlined type must paint (missing fonts = blank navy / tofu).
    expect(await regionHasColor(png, 200, 40, 880, 130, isGold)).toBe(true); // LEADERBOARD
    expect(await regionHasColor(png, 450, 380, 630, 510, isGold)).toBe(true); // #1
    expect(await regionHasColor(png, 250, 610, 830, 690, isNearWhite)).toBe(true); // username
    expect(await regionHasColor(png, 250, 730, 830, 800, isMuted)).toBe(true); // pts today
    expect(await regionHasColor(png, 250, 840, 830, 910, isGold)).toBe(true); // CTA
    expect(await regionHasColor(png, 250, 990, 830, 1070, isGold)).toBe(true); // PackPTS.com
  });

  it("paints streak, challenge, join, reward, and overlay accents", async () => {
    const streak = await renderSocialSvgToPng(buildStreakSvg(W, H, 7));
    expect(await regionHasColor(streak, 200, 40, 880, 130, isOrange)).toBe(true);
    expect(await regionHasColor(streak, 400, 380, 680, 560, isOrange)).toBe(true);
    expect(await regionHasColor(streak, 250, 680, 830, 760, isNearWhite)).toBe(true);
    expect(await regionHasColor(streak, 250, 990, 830, 1070, isGold)).toBe(true);

    const challenge = await renderSocialSvgToPng(buildChallengeSvg(W, H, 2500));
    expect(await regionHasColor(challenge, 200, 40, 880, 130, isBlue)).toBe(true);
    expect(await regionHasColor(challenge, 250, 380, 830, 560, isBlue)).toBe(true);
    expect(await regionHasColor(challenge, 250, 680, 830, 760, isNearWhite)).toBe(true);

    const join = await renderSocialSvgToPng(buildNewUserSvg(W, H, 0));
    expect(await regionHasColor(join, 200, 40, 880, 130, isGreen)).toBe(true);
    expect(await regionHasColor(join, 150, 360, 930, 560, isGreen)).toBe(true);

    const reward = await renderSocialSvgToPng(buildRewardSvg(W, H, "500"));
    expect(await regionHasColor(reward, 200, 40, 880, 130, isPurple)).toBe(true);
    expect(await regionHasColor(reward, 250, 360, 830, 560, isPurple)).toBe(true);

    const overlay = await renderSocialSvgToPng(
      buildCardOverlaySvg(W, H, "TRIVIA CARD", GAME_IMAGE_COLORS.gold),
    );
    expect(await regionHasColor(overlay, 200, 40, 880, 130, isGold)).toBe(true);
    expect(await regionHasColor(overlay, 250, 960, 830, 1040, isGold)).toBe(true);
  });
});

describe("Design-baked social exports", () => {
  it("maps content types to square/story filenames and does not invent art", () => {
    expect(socialDesignFileName("LEADERBOARD_HIGHLIGHT", "TWITTER")).toBe("leaderboard-1080.png");
    expect(socialDesignFileName("LEADERBOARD_HIGHLIGHT", "TIKTOK")).toBe("leaderboard-story.png");
    expect(socialDesignFileName("UNKNOWN", "TWITTER")).toBeNull();
    expect(SOCIAL_DESIGN_EXPORTS.STREAK_MILESTONE.square).toBe("streak-1080.png");
    expect(readSocialDesignExport("LEADERBOARD_HIGHLIGHT", "TWITTER", { searchDirs: ["/tmp/packpts-no-design"] })).toBeNull();
  });

  it("prefers a Design-baked PNG when the file is on disk", async () => {
    const dir = path.join(os.tmpdir(), `packpts-social-design-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    const baked = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 20, b: 20 } },
    }).png().toBuffer();
    fs.writeFileSync(path.join(dir, "leaderboard-1080.png"), baked);

    const found = readSocialDesignExport("LEADERBOARD_HIGHLIGHT", "TWITTER", { searchDirs: [dir] });
    expect(found?.fileName).toBe("leaderboard-1080.png");
    expect(found && await regionHasColor(found.buffer, 0, 0, 64, 64, (r, g, b) => r > 200 && g < 40 && b < 40)).toBe(true);

    expect(readSocialDesignExport("CHALLENGE", "TWITTER", { searchDirs: [dir] })).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
