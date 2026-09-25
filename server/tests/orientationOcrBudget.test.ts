import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  CONFIDENT_ORIENTATION_CONFIDENCE,
  ORIENTATION_OCR_BUDGET_MS,
  ORIENTATION_OCR_PASS_ORDER,
  orientationOcrBudgetMs,
  uprightCardImage,
} from "../masking/cardOrientation";
import { getMaskProfile } from "../masking/maskProfiles";
import { maskCardImage } from "../masking/maskCardImage";
import { resetMaskBakeForTests } from "../masking/maskingService";
import { clearOrientNote } from "../masking/orientNote";
import { setOcrDeadlineForTests, setOcrJobFactoryForTests } from "../masking/ocrRuntime";

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

describe("orientation OCR budget", () => {
  it("keeps three passes inside the bake deadline", () => {
    expect(ORIENTATION_OCR_BUDGET_MS).toBe(12_000);
    expect(ORIENTATION_OCR_PASS_ORDER).toEqual([0, 90, 270]);
    expect(orientationOcrBudgetMs({ deadlineMs: 20_000, elapsedMs: 0 })).toBe(12_000);
    expect(orientationOcrBudgetMs({ deadlineMs: 20_000, elapsedMs: 9_000 })).toBe(9_500);
    expect(orientationOcrBudgetMs({ deadlineMs: 20_000, elapsedMs: 19_000 })).toBe(0);
    expect(9_000 + orientationOcrBudgetMs({ deadlineMs: 20_000, elapsedMs: 9_000 })).toBeLessThan(20_000);
  });

  it("stops on the first confident hit", async () => {
    const raw = await sharp({
      create: { width: 400, height: 260, channels: 3, background: { r: 20, g: 180, b: 40 } },
    }).png().toBuffer();
    let calls = 0;
    const result = await uprightCardImage(raw, {
      playerName: "Ken Phelps",
      profile: getMaskProfile("1987 Topps baseball"),
      recognize: async () => {
        calls += 1;
        return {
          words: [{ text: "PHELPS", x: 8, y: 200, w: 80, h: 20, confidence: CONFIDENT_ORIENTATION_CONFIDENCE }],
          timedOut: false,
          ms: 4,
        };
      },
    });
    expect(calls).toBe(1);
    expect(result.rotation).toBe(0);
    expect(result.orientationAmbiguous).toBe(false);
  });

  it("uses the no-turn cover-both fallback when the shared budget runs out", async () => {
    const raw = await sharp({
      create: { width: 400, height: 260, channels: 3, background: { r: 20, g: 180, b: 40 } },
    }).png().toBuffer();
    let calls = 0;
    const started = Date.now();
    const result = await uprightCardImage(raw, {
      playerName: "Ken Phelps",
      profile: getMaskProfile("1987 Topps baseball"),
      orientationBudgetMs: 300,
      recognize: async (_buffer, _width, opts) => {
        calls += 1;
        const wait = Math.min(opts?.deadlineMs ?? 8_000, 300);
        await new Promise((resolve) => setTimeout(resolve, wait));
        return { words: [], timedOut: true, ms: wait };
      },
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(calls).toBe(1);
    expect(result.rotation).toBe(0);
    expect(result.orientationAmbiguous).toBe(true);
    expect(result.ocrTimedOut).toBe(true);
  });

  it("does not quarantine when the orientation budget is exhausted", async () => {
    const cardId = "budget-no-quarantine";
    clearOrientNote(cardId);
    resetMaskBakeForTests();
    dbUpdate.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    setOcrDeadlineForTests(8_000);
    let calls = 0;
    setOcrJobFactoryForTests(() => {
      calls += 1;
      const timer = setInterval(() => {}, 60_000);
      return {
        promise: new Promise(() => {}),
        cancel() {
          clearInterval(timer);
        },
      };
    });
    const raw = await sharp({
      create: { width: 360, height: 240, channels: 3, background: { r: 240, g: 240, b: 240 } },
    }).png().toBuffer();
    const started = Date.now();
    const result = await maskCardImage(raw, "Ken Phelps", "1987 Topps baseball", {
      cardId,
      orientationBudgetMs: 200,
    });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(calls).toBe(0);
    expect(result.orientationAmbiguous).toBe(true);
    expect(result.servedRotation).toBe(0);
    expect(result.coverageOk).toBe(true);
    expect(dbUpdate).not.toHaveBeenCalled();
    clearOrientNote(cardId);
    resetMaskBakeForTests();
    vi.restoreAllMocks();
  });
});
