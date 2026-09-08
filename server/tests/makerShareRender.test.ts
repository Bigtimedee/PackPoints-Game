/**
 * Maker share render contract — no database.
 * Asserts masked card fan, real set name/note/count, and no stock/DAU copy.
 */
import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import sharp from "sharp";
import {
  buildMakerShareSvg,
  generateMakerShare,
  redactCardForShare,
  parseCardPhotoId,
  cardCountLabel,
  containsForbiddenMakerShareCopy,
  MAKER_SHARE_SIZE,
  MAKER_SHARE_EYEBROW,
  MAKER_SHARE_FOOTER_URL,
  FORBIDDEN_MAKER_SHARE_COPY,
} from "../contentFactory/generateMakerShare";

const TODAY = "2026-09-08";
const created: string[] = [];

afterAll(() => {
  for (const filePath of created) {
    fs.rmSync(filePath, { force: true });
  }
});

function isNearRed(r: number, g: number, b: number): boolean {
  return r > 200 && g < 60 && b < 60;
}

function isNearGreen(r: number, g: number, b: number): boolean {
  return r < 60 && g > 200 && b < 60;
}

function isDark(r: number, g: number, b: number): boolean {
  return r < 80 && g < 90 && b < 100;
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

async function fakeCard(top: { r: number; g: number; b: number }, bottom: { r: number; g: number; b: number }): Promise<Buffer> {
  const w = 240;
  const h = 336;
  const split = Math.round(h * 0.54);
  const topBuf = await sharp({
    create: { width: w, height: split, channels: 3, background: top },
  }).png().toBuffer();
  const botBuf = await sharp({
    create: { width: w, height: h - split, channels: 3, background: bottom },
  }).png().toBuffer();
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).composite([
    { input: topBuf, top: 0, left: 0 },
    { input: botBuf, top: split, left: 0 },
  ]).jpeg().toBuffer();
}

describe("parseCardPhotoId", () => {
  it("extracts ids from card-photo URLs and rejects junk", () => {
    expect(parseCardPhotoId("https://packpts.com/api/card-photos/abc-123")).toBe("abc-123");
    expect(parseCardPhotoId("/api/card-photos/uuid-here")).toBe("uuid-here");
    expect(parseCardPhotoId("https://cdn.example/foo.jpg")).toBeNull();
    expect(parseCardPhotoId(null)).toBeNull();
  });
});

describe("cardCountLabel", () => {
  it("uses the real count — never a canned number", () => {
    expect(cardCountLabel(7)).toBe("7 cards");
    expect(cardCountLabel(1)).toBe("1 card");
    expect(cardCountLabel(0)).toBe("0 cards");
    expect(cardCountLabel(7)).not.toContain("8");
  });
});

describe("forbidden maker-share copy", () => {
  it("blocks Maker Rate / DAU / stock-fan language", () => {
    expect(containsForbiddenMakerShareCopy("Maker Rate 12%")).toBe(true);
    expect(containsForbiddenMakerShareCopy("10k DAU")).toBe(true);
    expect(containsForbiddenMakerShareCopy("I MADE THIS SET")).toBe(false);
    expect(FORBIDDEN_MAKER_SHARE_COPY.length).toBeGreaterThan(3);
  });
});

describe("redactCardForShare", () => {
  it("darkens the name band so the printed bottom is not the original color", async () => {
    const raw = await fakeCard({ r: 220, g: 20, b: 20 }, { r: 20, g: 220, b: 20 });
    const redacted = await redactCardForShare(raw);
    const tmp = `/tmp/maker-redact-${Date.now()}.jpg`;
    fs.writeFileSync(tmp, redacted);
    created.push(tmp);

    // Top of the card still has red identity pixels
    expect(await regionHasColor(tmp, 20, 20, 220, 120, isNearRed)).toBe(true);
    // Bottom 46% is no longer the original green nameplate
    expect(await regionHasColor(tmp, 20, 220, 220, 320, isNearGreen)).toBe(false);
    expect(await regionHasColor(tmp, 20, 220, 220, 320, isDark)).toBe(true);
  });
});

describe("maker share PNG contract", () => {
  it("paints the published set name, mixtape, honest count, and a real card fan", async () => {
    const card = await fakeCard({ r: 40, g: 110, b: 220 }, { r: 20, g: 220, b: 20 });
    const masked = await redactCardForShare(card);
    const input = {
      setName: "Porch 87s",
      makerNote: "The stack I kept in a shoebox",
      cardCount: 7,
      date: TODAY,
      cardImages: [masked, masked, masked],
    };

    const svg = await buildMakerShareSvg(input);
    expect(svg).toContain(`width="${MAKER_SHARE_SIZE}"`);
    expect(svg).toContain(MAKER_SHARE_EYEBROW);
    expect(svg).toContain("Porch 87s");
    expect(svg).toContain("The stack I kept in a shoebox");
    expect(svg).toContain("7 cards");
    expect(svg).not.toContain("8 cards");
    expect(svg).toContain("PackPTS");
    expect(svg).toContain(MAKER_SHARE_FOOTER_URL);
    expect(svg).toContain("data:image/jpeg;base64,");
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).not.toContain("sans-serif");
    const desc = svg.match(/<desc>([\s\S]*?)<\/desc>/)?.[1] ?? "";
    expect(containsForbiddenMakerShareCopy(desc)).toBe(false);
    expect(desc.toLowerCase()).not.toContain("maker rate");
    expect(desc.toLowerCase()).not.toContain("dau");

    const result = await generateMakerShare(input, `maker-render-${Date.now()}`);
    created.push(result.imagePath);
    const meta = await sharp(result.imagePath).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);

    // Fan lives in the middle of the square; blue card tops should show
    expect(await regionHasColor(result.imagePath, 400, 250, 680, 480, (r, g, b) => r < 100 && g > 60 && b > 150)).toBe(true);
    // Footer PackPTS / URL
    expect(await regionHasColor(result.imagePath, 140, 950, 340, 1000, (r, g, b) => r > 220 && g > 220 && b > 220)).toBe(true);
  });

  it("still renders name + note with no stock fan when there are no card photos", async () => {
    const svg = await buildMakerShareSvg({
      setName: "Empty Shoebox",
      makerNote: "Waiting on scans",
      cardCount: 5,
      date: TODAY,
      cardImages: [],
    });
    expect(svg).toContain("I MADE THIS SET");
    expect(svg).toContain("Empty Shoebox");
    expect(svg).toContain("Waiting on scans");
    expect(svg).toContain("5 cards");
    expect(svg).not.toContain("data:image/jpeg;base64,");
    const desc = svg.match(/<desc>([\s\S]*?)<\/desc>/)?.[1] ?? "";
    expect(containsForbiddenMakerShareCopy(desc)).toBe(false);
  });
});
