/**
 * Maker share render contract — no database.
 * Locked spec: docs/MAKER_SHARE_CONTRACT.md
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
  CREAM_SILHOUETTE,
  STOCK_FAN_ASSET,
  WHO_IS_THIS_PLAYER,
  FORBIDDEN_MAKER_SHARE_COPY,
} from "../contentFactory/generateMakerShare";
import {
  setShareSlug,
  makerShareFooterUrl,
  setsMadeLabel,
  MAKER_SHARE_VOLUME_GATE,
  clampMakerStackCount,
} from "../contentFactory/makerShareSlug";

const TODAY = "2026-09-08";
const SET_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
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

describe("setShareSlug", () => {
  it("builds packpts.com/sets/{slug} from the published name + id prefix", () => {
    expect(setShareSlug("Porch 87s", SET_ID)).toBe("porch-87s-a1b2c3d4");
    expect(makerShareFooterUrl("Porch 87s", SET_ID)).toBe("packpts.com/sets/porch-87s-a1b2c3d4");
  });
});

describe("cardCountLabel / stack clamp", () => {
  it("uses the real count and caps the stack at 8", () => {
    expect(cardCountLabel(7)).toBe("7 cards");
    expect(cardCountLabel(1)).toBe("1 card");
    expect(clampMakerStackCount(12)).toBe(8);
    expect(clampMakerStackCount(5)).toBe(5);
  });
});

describe("volume gate copy", () => {
  it("blocks Maker Rate / DAU / stock-fan and keeps Sets Made personal", () => {
    expect(containsForbiddenMakerShareCopy("Maker Rate 12%")).toBe(true);
    expect(containsForbiddenMakerShareCopy("10k DAU")).toBe(true);
    expect(containsForbiddenMakerShareCopy(STOCK_FAN_ASSET)).toBe(true);
    expect(containsForbiddenMakerShareCopy("I MADE THIS SET")).toBe(false);
    expect(MAKER_SHARE_VOLUME_GATE).toBe(10);
    expect(setsMadeLabel(3)).toBe("3 sets made");
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

    expect(await regionHasColor(tmp, 20, 20, 220, 120, isNearRed)).toBe(true);
    expect(await regionHasColor(tmp, 20, 220, 220, 320, isNearGreen)).toBe(false);
    expect(await regionHasColor(tmp, 20, 220, 220, 320, isDark)).toBe(true);
  });
});

describe("maker share PNG contract", () => {
  it("paints header, name, mixtape, Daily 5 mask language, slug footer, and a real card stack", async () => {
    const card = await fakeCard({ r: 40, g: 110, b: 220 }, { r: 20, g: 220, b: 20 });
    const masked = await redactCardForShare(card);
    const input = {
      setName: "Porch 87s",
      makerNote: "The stack I kept in a shoebox",
      cardCount: 7,
      date: TODAY,
      setId: SET_ID,
      cardSlots: [masked, masked, masked, masked, masked],
    };

    const svg = await buildMakerShareSvg(input);
    expect(svg).toContain(`width="${MAKER_SHARE_SIZE}"`);
    expect(svg).toContain(MAKER_SHARE_EYEBROW);
    expect(svg).toContain("Porch 87s");
    expect(svg).toContain("The stack I kept in a shoebox");
    expect(svg).toContain("7 cards");
    expect(svg).toContain("PackPTS");
    expect(svg).toContain("packpts.com/sets/porch-87s-a1b2c3d4");
    expect(svg).toContain(WHO_IS_THIS_PLAYER);
    expect(svg).toContain("data:image/jpeg;base64,");
    expect(svg).not.toContain(STOCK_FAN_ASSET);
    expect(svg).not.toContain("sets made");
    expect(svg).not.toMatch(/<text[\s>]/);
    const desc = svg.match(/<desc>([\s\S]*?)<\/desc>/)?.[1] ?? "";
    expect(containsForbiddenMakerShareCopy(desc)).toBe(false);

    const result = await generateMakerShare(input, `maker-render-${Date.now()}`);
    created.push(result.imagePath);
    const meta = await sharp(result.imagePath).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
    expect(await regionHasColor(result.imagePath, 250, 180, 500, 360, (r, g, b) => r < 100 && g > 60 && b > 150)).toBe(true);
    expect(await regionHasColor(result.imagePath, 140, 950, 340, 1000, (r, g, b) => r > 220 && g > 220 && b > 220)).toBe(true);
  });

  it("uses a cream masked silhouette per failed card and never maker-set-1080.png", async () => {
    const card = await fakeCard({ r: 40, g: 110, b: 220 }, { r: 20, g: 220, b: 20 });
    const masked = await redactCardForShare(card);
    const svg = await buildMakerShareSvg({
      setName: "Porch 87s",
      makerNote: "The stack I kept in a shoebox",
      cardCount: 5,
      date: TODAY,
      setId: SET_ID,
      cardSlots: [masked, null, masked, null, masked],
    });
    expect(svg).toContain(CREAM_SILHOUETTE);
    expect(svg).toContain(WHO_IS_THIS_PLAYER);
    expect(svg).toContain("data:image/jpeg;base64,");
    expect(svg).not.toContain(STOCK_FAN_ASSET);
    expect((svg.match(/clip-path="url\(#makerCard/g) || []).length).toBe(3);
  });

  it("stacks up to 8 of this set's cards", async () => {
    const card = await fakeCard({ r: 40, g: 110, b: 220 }, { r: 20, g: 220, b: 20 });
    const masked = await redactCardForShare(card);
    const svg = await buildMakerShareSvg({
      setName: "Porch 87s",
      makerNote: null,
      cardCount: 12,
      date: TODAY,
      setId: SET_ID,
      cardSlots: Array.from({ length: 8 }, () => masked),
    });
    expect(svg).toContain("12 cards");
    expect((svg.match(/id="makerCard/g) || []).length).toBe(8);
  });

  it("omits Sets Made when the volume gate is locked and includes it when unlocked", async () => {
    const locked = await buildMakerShareSvg({
      setName: "Porch 87s",
      makerNote: "note",
      cardCount: 5,
      date: TODAY,
      setId: SET_ID,
      cardSlots: [null, null, null, null, null],
    });
    expect(locked).not.toContain("sets made");
    expect(locked).toContain(CREAM_SILHOUETTE);
    expect(locked).not.toContain(STOCK_FAN_ASSET);

    const unlocked = await buildMakerShareSvg({
      setName: "Porch 87s",
      makerNote: "note",
      cardCount: 5,
      date: TODAY,
      setId: SET_ID,
      setsMade: 3,
      cardSlots: [null, null, null, null, null],
    });
    expect(unlocked).toContain("3 sets made");
    expect(unlocked.toLowerCase()).not.toContain("maker rate");
  });
});
