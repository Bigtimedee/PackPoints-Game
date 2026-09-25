import { spawn } from "child_process";
import { readFileSync } from "fs";
import { unlink, writeFile, mkdir } from "fs/promises";
import path from "path";
import { Worker } from "worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { anyRegionCoversPoint, CURRENT_MASK_VERSION } from "@shared/maskGeometry";

const dbUpdate = vi.hoisted(() => vi.fn(() => ({
  set: () => ({ where: () => Promise.resolve() }),
})));

vi.mock("../db", () => ({
  db: {
    update: dbUpdate,
    insert: vi.fn(() => ({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    })),
    select: vi.fn(),
  },
  pool: { on: vi.fn() },
}));

import { maskCardImage } from "../masking/maskCardImage";
import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";
import {
  acceptWarmMaskedFile,
  bakeMaskedCardFromUrl,
  ocrSkipped,
  orientUnmaskedScan,
  peekWarmMaskedFilename,
  resetMaskBakeForTests,
  warmMaskedFilename,
  type MaskBakeSource,
} from "../masking/maskingService";
import {
  setOcrDeadlineForTests,
  setOcrJobFactoryForTests,
  terminateOcrRuntime,
  type OcrJob,
} from "../masking/ocrRuntime";
import { readOrientNote } from "../masking/orientNote";
import type { OcrWordBox } from "../masking/nameLocalization";

const GREEN = { r: 20, g: 180, b: 40 };
const WHITE = { r: 255, g: 255, b: 255 };
const W = 240;
const H = 360;

function isDark(r: number, g: number, b: number): boolean {
  return r < 50 && g < 50 && b < 60;
}

function isGreen(r: number, g: number, b: number): boolean {
  return g > 120 && r < 80 && b < 80;
}

async function sample(buf: Buffer, xPct: number, yPct: number): Promise<{ r: number; g: number; b: number }> {
  const meta = await sharp(buf).metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const x = Math.max(0, Math.min(width - 1, Math.round((xPct / 100) * (width - 1))));
  const y = Math.max(0, Math.min(height - 1, Math.round((yPct / 100) * (height - 1))));
  const { data } = await sharp(buf)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
}

/** Portrait 1987 Topps-style card: green photo, white name band in the bottom 46%. */
async function uprightTopps(): Promise<Buffer> {
  const nameH = Math.round(H * 0.46);
  const photoH = H - nameH;
  const photo = await sharp({
    create: { width: W, height: photoH, channels: 3, background: GREEN },
  }).png().toBuffer();
  const name = await sharp({
    create: { width: W, height: nameH, channels: 3, background: WHITE },
  }).png().toBuffer();
  return sharp({
    create: { width: W, height: H, channels: 3, background: GREEN },
  })
    .composite([
      { input: photo, top: 0, left: 0 },
      { input: name, top: photoH, left: 0 },
    ])
    .png()
    .toBuffer();
}

/** Last-name box only when the white name band sits in the bottom plaque. */
async function wordsForUprightName(buffer: Buffer): Promise<OcrWordBox[]> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  const channels = info.channels;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) {
        count += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count < 30) return [];
  const cy = (minY + maxY) / 2;
  if (cy < height * 0.54) return [];
  return [{ text: "PHELPS", x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }];
}

function ocrFromBuffer(buffer: Buffer): OcrJob {
  const promise = wordsForUprightName(buffer).then((words) => ({ words }));
  return { promise, cancel() {} };
}

describe("upright mask bake", () => {
  const written: string[] = [];

  beforeEach(() => {
    resetMaskBakeForTests();
    dbUpdate.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setOcrJobFactoryForTests((buffer) => ocrFromBuffer(buffer));
  });

  afterEach(async () => {
    resetMaskBakeForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await Promise.all(written.splice(0).map(async (file) => {
      await unlink(file).catch(() => {});
    }));
  });

  function track(cardId: string) {
    written.push(
      path.join(MASKED_CARDS_DIR, `${cardId}_${CURRENT_MASK_VERSION}.orient.json`),
      path.join(MASKED_CARDS_DIR, warmMaskedFilename(cardId)),
      path.join(MASKED_CARDS_DIR, warmMaskedFilename(cardId, 90)),
      path.join(MASKED_CARDS_DIR, warmMaskedFilename(cardId, 180)),
      path.join(MASKED_CARDS_DIR, warmMaskedFilename(cardId, 270)),
    );
  }

  it("rotates a sideways 1987 Topps scan upright and covers the name band", async () => {
    const upright = await uprightTopps();
    const sideways = await sharp(upright).rotate(90).png().toBuffer();
    const rawMeta = await sharp(sideways).metadata();
    expect((rawMeta.width || 0) / (rawMeta.height || 1)).toBeGreaterThan(1.3);

    const cardId = "sideways-1987-topps";
    track(cardId);
    const result = await maskCardImage(sideways, "Ken Phelps", "1987 Topps baseball", { cardId });
    const meta = await sharp(result.maskedBuffer).metadata();
    expect(meta.height || 0).toBeGreaterThan(meta.width || 0);
    expect(result.servedRotation === 90 || result.servedRotation === 270).toBe(true);
    expect(result.coverageOk).toBe(true);
    expect(result.layoutClass).toBe("BOTTOM_PLAQUE");
    expect(anyRegionCoversPoint(result.regions, 50, 90)).toBe(true);
    const band = result.regions.find((region) => region.wPct >= 90);
    expect(band?.yPct).toBeGreaterThanOrEqual(50);
    expect((band?.yPct || 0) + (band?.hPct || 0)).toBeGreaterThanOrEqual(99);

    const name = await sample(result.maskedBuffer, 50, 90);
    const photo = await sample(result.maskedBuffer, 50, 18);
    expect(isDark(name.r, name.g, name.b)).toBe(true);
    expect(isGreen(photo.r, photo.g, photo.b)).toBe(true);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("honors imageRotation 90 and 270", async () => {
    const upright = await uprightTopps();
    const turned90 = await sharp(upright).rotate(270).png().toBuffer();
    const turned270 = await sharp(upright).rotate(90).png().toBuffer();

    for (const [file, rotation, cardId] of [
      [turned90, 90, "rot-90"],
      [turned270, 270, "rot-270"],
    ] as const) {
      track(cardId);
      const result = await maskCardImage(file, "Ken Phelps", "1987 Topps baseball", {
        cardId,
        imageRotation: rotation,
        skipOcr: true,
      });
      expect(result.servedRotation).toBe(rotation);
      const meta = await sharp(result.maskedBuffer).metadata();
      expect(meta.height || 0).toBeGreaterThan(meta.width || 0);
      expect(result.coverageOk).toBe(true);
      const name = await sample(result.maskedBuffer, 50, 90);
      const photo = await sample(result.maskedBuffer, 50, 18);
      expect(isDark(name.r, name.g, name.b)).toBe(true);
      expect(isGreen(photo.r, photo.g, photo.b)).toBe(true);
    }
  });

  it("leaves a horizontal design landscape", async () => {
    const width = 400;
    const height = 260;
    const nameH = Math.round(height * 0.46);
    const photoH = height - nameH;
    const photo = await sharp({
      create: { width, height: photoH, channels: 3, background: GREEN },
    }).png().toBuffer();
    const name = await sharp({
      create: { width, height: nameH, channels: 3, background: WHITE },
    }).png().toBuffer();
    const landscape = await sharp({
      create: { width, height, channels: 3, background: GREEN },
    }).composite([
      { input: photo, top: 0, left: 0 },
      { input: name, top: photoH, left: 0 },
    ]).png().toBuffer();

    const cardId = "true-landscape";
    track(cardId);
    const result = await maskCardImage(landscape, "Ken Phelps", "1987 Topps baseball", {
      cardId,
      skipOcr: true,
      cardOrientation: "landscape",
    });
    const meta = await sharp(result.maskedBuffer).metadata();
    expect(meta.width || 0).toBeGreaterThan(meta.height || 0);
    expect(result.servedRotation).toBe(0);
    expect(result.landscapeDesign).toBe(true);
    expect(result.coverageOk).toBe(true);
    const covered = await sample(result.maskedBuffer, 50, 90);
    const photoPx = await sample(result.maskedBuffer, 50, 18);
    expect(isDark(covered.r, covered.g, covered.b)).toBe(true);
    expect(isGreen(photoPx.r, photoPx.g, photoPx.b)).toBe(true);
    expect(readOrientNote(cardId)?.landscapeDesign).toBe(true);
  });

  it("rotates the reveal to the same upright frame as the masked bake", async () => {
    const upright = await uprightTopps();
    const sideways = await sharp(upright).rotate(90).png().toBuffer();
    const cardId = "reveal-align";
    track(cardId);
    const masked = await maskCardImage(sideways, "Ken Phelps", "1987 Topps baseball", { cardId });
    const revealed = await orientUnmaskedScan(cardId, sideways);
    const maskedMeta = await sharp(masked.maskedBuffer).metadata();
    const revealedMeta = await sharp(revealed).metadata();
    expect(revealedMeta.width).toBe(maskedMeta.width);
    expect(revealedMeta.height).toBe(maskedMeta.height);
    expect(revealedMeta.height || 0).toBeGreaterThan(revealedMeta.width || 0);

    const revealedName = await sample(revealed, 50, 90);
    const revealedPhoto = await sample(revealed, 50, 18);
    const maskedName = await sample(masked.maskedBuffer, 50, 90);
    const maskedPhoto = await sample(masked.maskedBuffer, 50, 18);
    expect(revealedName.r).toBeGreaterThan(200);
    expect(isGreen(revealedPhoto.r, revealedPhoto.g, revealedPhoto.b)).toBe(true);
    expect(isDark(maskedName.r, maskedName.g, maskedName.b)).toBe(true);
    expect(isGreen(maskedPhoto.r, maskedPhoto.g, maskedPhoto.b)).toBe(true);
  });

  it("keeps v4.4 for upright files and suffixes only a rotated bake", async () => {
    expect(CURRENT_MASK_VERSION).toBe("v4.4");
    expect(warmMaskedFilename("card-plain")).toBe("card-plain_v4.4.jpg");
    expect(warmMaskedFilename("card-turn", 90)).toBe("card-turn_v4.4_r90.jpg");
    expect(warmMaskedFilename("card-turn", 270)).toBe("card-turn_v4.4_r270.jpg");

    const upright = await uprightTopps();
    const sideways = await sharp(upright).rotate(90).png().toBuffer();
    const cardId = "suffix-r270";
    track(cardId);
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(sideways), {
      status: 200,
      headers: { "content-type": "image/png" },
    }));
    const source: MaskBakeSource = {
      cardId,
      imageUrl: "https://images.example/sideways.png",
      playerName: "Ken Phelps",
      setHint: "1987 Topps baseball",
      gameSetId: null,
      imageRotation: 270,
    };
    const filename = await bakeMaskedCardFromUrl(source);
    expect(filename).toBe(`${cardId}_${CURRENT_MASK_VERSION}_r270.jpg`);
    const baked = await sharp(path.join(MASKED_CARDS_DIR, filename || "")).metadata();
    expect(baked.height || 0).toBeGreaterThan(baked.width || 0);
    expect(peekWarmMaskedFilename("card-plain")).toBeNull();
  });
});

describe("ocr deadline fallback", () => {
  let calls = 0;
  let open = 0;

  beforeEach(() => {
    resetMaskBakeForTests();
    dbUpdate.mockClear();
    calls = 0;
    open = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setOcrDeadlineForTests(80);
    setOcrJobFactoryForTests(() => {
      calls += 1;
      open += 1;
      const timer = setInterval(() => {}, 60_000);
      const promise = new Promise<{ words: OcrWordBox[] }>(() => {});
      return {
        promise,
        cancel() {
          open -= 1;
          clearInterval(timer);
        },
      };
    });
  });

  afterEach(() => {
    resetMaskBakeForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function source(cardId: string): MaskBakeSource {
    return {
      cardId,
      imageUrl: `https://images.example/${cardId}.png`,
      playerName: "Ken Phelps",
      setHint: "1987 Topps baseball",
      gameSetId: null,
    };
  }

  it("terminates a hanging OCR and still serves the profile band", async () => {
    const upright = await uprightTopps();
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(upright), {
      status: 200,
      headers: { "content-type": "image/png" },
    }));
    const cardId = "card-ocr-hang";
    const started = Date.now();
    const filename = await bakeMaskedCardFromUrl(source(cardId));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(filename).toBe(`${cardId}_v4.4.jpg`);
    expect(calls).toBe(1);
    expect(open).toBe(0);
    expect(dbUpdate).not.toHaveBeenCalled();

    const baked = await sharp(path.join(MASKED_CARDS_DIR, filename || "")).toBuffer();
    const meta = await sharp(baked).metadata();
    expect(meta.height || 0).toBeGreaterThan(meta.width || 0);
    const name = await sample(baked, 50, 90);
    const photo = await sample(baked, 50, 18);
    expect(isDark(name.r, name.g, name.b)).toBe(true);
    expect(isGreen(photo.r, photo.g, photo.b)).toBe(true);
    const note = readOrientNote(cardId);
    expect(note?.rotation).toBe(0);
    const plan = JSON.parse(readFileSync(path.join(MASKED_CARDS_DIR, `${cardId}_v4.4.json`), "utf8")) as {
      regions: Array<{ yPct: number; hPct: number }>;
    };
    expect(plan.regions[0]?.yPct).toBe(54);
    expect(plan.regions[0]?.hPct).toBe(46);

    const logLine = vi.mocked(console.log).mock.calls.map((args) => String(args[0])).find((line) => line.includes("ocr-timeout"));
    expect(logLine).toMatch(/^\[MaskBake\] ocr-timeout fallback=profile card=card-ocr-hang ms=\d+$/);

    const again = await bakeMaskedCardFromUrl(source(cardId));
    expect(again).toBe(`${cardId}_v4.4.jpg`);
    expect(calls).toBe(1);
    expect(ocrSkipped(cardId)).toBe(true);
    expect(ocrSkipped(cardId, Date.now() + 2 * 60 * 60 * 1000)).toBe(false);
    expect(dbUpdate).not.toHaveBeenCalled();

    await unlink(path.join(MASKED_CARDS_DIR, `${cardId}_v4.4.jpg`)).catch(() => {});
    await unlink(path.join(MASKED_CARDS_DIR, `${cardId}_v4.4.orient.json`)).catch(() => {});
    await unlink(path.join(MASKED_CARDS_DIR, `${cardId}_v4.4.json`)).catch(() => {});
  });

  it("kills an ocr child process and a worker thread", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    const childExit = new Promise<boolean>((resolve) => {
      child.once("exit", () => resolve(true));
    });
    await terminateOcrRuntime({ pid: child.pid, terminate() {} });
    await expect(Promise.race([
      childExit,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ])).resolves.toBe(true);

    const worker = new Worker("setInterval(() => {}, 1000)", { eval: true });
    const workerExit = new Promise<boolean>((resolve) => {
      worker.once("exit", () => resolve(true));
    });
    await terminateOcrRuntime({
      worker,
      terminate: () => worker.terminate(),
    });
    await expect(Promise.race([
      workerExit,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ])).resolves.toBe(true);
  });

  it("does not treat a warm landscape jpeg as a finished upright bake", async () => {
    const cardId = "stale-landscape";
    const filename = warmMaskedFilename(cardId);
    const filePath = path.join(MASKED_CARDS_DIR, filename);
    const wide = await sharp({
      create: { width: 360, height: 240, channels: 3, background: GREEN },
    }).jpeg().toBuffer();
    await mkdir(MASKED_CARDS_DIR, { recursive: true });
    await writeFile(filePath, wide);
    expect(peekWarmMaskedFilename(cardId)).toBe(filename);
    await expect(acceptWarmMaskedFile(cardId, filename)).resolves.toBe(false);
    await unlink(filePath).catch(() => {});
  });
});
