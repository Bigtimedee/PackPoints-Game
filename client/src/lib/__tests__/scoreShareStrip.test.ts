import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  SCORE_SHARE_STRIP,
  composeScoreSharePng,
  maskedTileSource,
  paintScoreShareStrip,
  restoreScoreCardBand,
  SCORE_DIGIT_TOP,
  SCORE_STRIP_CLEARANCE,
  scoreShareStripLayout,
  scoreShareStripRowCapacity,
  sessionShareTileSources,
  tilesForScoreShare,
  type StripPainter,
  type StripTileImage,
} from "../scoreShareStrip";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");
const shareSrc = readFileSync(new URL("../../components/ShareAssetCard.tsx", import.meta.url), "utf8");
const stripSrc = readFileSync(new URL("../scoreShareStrip.ts", import.meta.url), "utf8");

const MASKED = [
  "/api/play/m/solo/sess/0/tok-a?v=v4.4",
  "/api/play/m/d5/chal/1/tok-b",
  "/api/play/m/match/mid/2/tok-c",
];

function recordingPainter() {
  const fills: Array<{ color: string; x: number; y: number; w: number; h: number }> = [];
  const images: unknown[] = [];
  let fillStyle = "";
  const ctx: StripPainter = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    arcTo() {},
    closePath() {},
    clip() {},
    fillRect(x, y, w, h) {
      fills.push({ color: ctx.fillStyle, x, y, w, h });
    },
    stroke() {},
    drawImage(image) {
      images.push(image);
    },
  };
  return {
    ctx: new Proxy(ctx, {
      set(target, prop, value) {
        if (prop === "fillStyle") fillStyle = String(value);
        return Reflect.set(target, prop, value);
      },
      get(target, prop) {
        if (prop === "fillStyle") return fillStyle;
        return Reflect.get(target, prop);
      },
    }),
    fills,
    images,
  };
}

describe("masked share tile sources", () => {
  it("keeps same-origin masked play URLs in session order and rewrites a CDN absolute", () => {
    const sources = sessionShareTileSources([
      "https://cdn.example.com/api/play/m/solo/sess/0/tok-a?v=v4.4",
      MASKED[1],
      null,
      "",
    ]);
    expect(sources).toEqual([MASKED[0], MASKED[1]]);
  });

  it("rejects unmasked card bytes and reveal URLs, including unanswered or skipped cards", () => {
    expect(maskedTileSource("/api/images/card/abc")).toBeNull();
    expect(maskedTileSource("https://packpts.com/api/images/card/abc")).toBeNull();
    expect(maskedTileSource("/api/play/r/solo/sess/0/99/reveal-tok")).toBeNull();
    expect(maskedTileSource("https://cdn.example.com/api/play/r/d5/chal/1/99/reveal")).toBeNull();
    expect(maskedTileSource("/api/play/m/solo/sess/0/tok-a")).toBe("/api/play/m/solo/sess/0/tok-a");
    expect(maskedTileSource("/api/play/m/ad5/chal/4/tok")).toBe("/api/play/m/ad5/chal/4/tok");
  });

  it("keeps all five Daily 5 masked URLs, including the version query and a base64url token", () => {
    const token = "abc-DEF_0123456789xyz";
    const session = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const urls = [1, 2, 3, 4, 5].map(
      (position) => `/api/play/m/d5/${session}/${position}/${token}?v=v4.4`,
    );
    expect(sessionShareTileSources(urls)).toEqual(urls);
    expect(scoreShareStripLayout(urls.length)).toHaveLength(5);
  });

  it("retries a scored thumb once so a cold miss does not shrink a 5-card strip to 4", async () => {
    const urls = [0, 1, 2, 3, 4].map((index) => `/api/play/m/solo/sess/${index}/tok-${index}?v=v4.4`);
    const attempts = new Map<string, number>();
    const images = await tilesForScoreShare(urls, async (src) => {
      const n = (attempts.get(src) ?? 0) + 1;
      attempts.set(src, n);
      if (src.endsWith("tok-4?v=v4.4") && n === 1) return null;
      return { width: 10, height: 14, src };
    });
    expect(images).toHaveLength(5);
    expect(attempts.get(urls[4])).toBe(2);
    expect(images.map((image) => (image as { src: string }).src)).toEqual(urls);
  });

  it("omits a tile that fails to load or would taint the canvas and keeps the rest in order", async () => {
    const urls = [
      MASKED[0],
      "/api/play/r/solo/sess/1/1/reveal",
      "/api/images/card/raw",
      MASKED[1],
      MASKED[2],
    ];
    const images = await tilesForScoreShare(urls, async (src) => {
      if (src === MASKED[1]) return null;
      if (src === MASKED[2]) throw new Error("load failed");
      return { width: 10, height: 14, src };
    });
    expect(images).toEqual([{ width: 10, height: 14, src: MASKED[0] }]);

    const tainted = await tilesForScoreShare([MASKED[0], MASKED[1]], async (src) => ({ width: 4, height: 6, src }), (image) => (image as { src: string }).src === MASKED[0]);
    expect(tainted).toEqual([{ width: 4, height: 6, src: MASKED[1] }]);
  });
});

describe("score share strip paint", () => {
  it("places plaque tiles in a row and does not draw mode, date, or footer chrome", () => {
    const painter = recordingPainter();
    const photos: StripTileImage[] = [
      { width: 20, height: 28 },
      { width: 20, height: 28 },
      { width: 20, height: 28 },
    ];
    const boxes = paintScoreShareStrip(painter.ctx, photos);
    expect(boxes).toHaveLength(3);
    expect(boxes.map((box) => box.y)).toEqual([SCORE_SHARE_STRIP.y, SCORE_SHARE_STRIP.y, SCORE_SHARE_STRIP.y]);
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    expect(boxes[1].x).toBeLessThan(boxes[2].x);
    expect(painter.images).toHaveLength(3);
    const colors = painter.fills.map((fill) => fill.color);
    const flatBand = painter.fills.filter((fill) => fill.color === SCORE_SHARE_STRIP.canvas && fill.w >= 900);
    expect(flatBand).toEqual([]);
    expect(colors.filter((color) => color === SCORE_SHARE_STRIP.plaqueFill)).toHaveLength(3);
    expect(colors.filter((color) => color === SCORE_SHARE_STRIP.seam)).toHaveLength(3);
    expect(colors.filter((color) => color === SCORE_SHARE_STRIP.bar)).toHaveLength(3);
    expect(stripSrc).not.toContain("packpts.com/daily");
    expect(stripSrc).not.toContain("fillText");
    expect(scoreShareStripLayout(0)).toEqual([]);
    expect(stripSrc).not.toContain("fillRect(SCORE_SHARE_STRIP.clearX");

    const five = scoreShareStripLayout(5);
    expect(five).toHaveLength(5);
    expect(five.every((box) => box.w === 64 && box.h === 90)).toBe(true);
    expect(new Set(five.map((box) => box.y)).size).toBe(1);
    const fiveGaps = five.slice(1).map((box, i) => box.x - (five[i].x + five[i].w));
    expect(new Set(fiveGaps)).toEqual(new Set([SCORE_SHARE_STRIP.gap]));
    expect(Math.max(...five.map((box) => box.y + box.h))).toBeLessThan(240);

    const ten = scoreShareStripLayout(10);
    expect(ten).toHaveLength(10);
    expect(ten.every((box) => box.w === 64 && box.h === 90)).toBe(true);
    expect(new Set(ten.map((box) => box.y)).size).toBe(1);
    expect(Math.max(...ten.map((box) => box.y + box.h))).toBeLessThan(240);

    const twelve = scoreShareStripLayout(12);
    expect(twelve.every((box) => box.w === 64 && box.h === 90)).toBe(true);
    expect(new Set(twelve.map((box) => box.y)).size).toBe(1);

    const fifteen = scoreShareStripLayout(15);
    expect(fifteen).toHaveLength(15);
    expect(fifteen.every((box) => box.w === 56 && box.h === 79)).toBe(true);
    expect(new Set(fifteen.map((box) => box.y)).size).toBe(1);
    expect(Math.max(...fifteen.map((box) => box.y + box.h))).toBeLessThanOrEqual(SCORE_DIGIT_TOP - SCORE_STRIP_CLEARANCE);

    const twenty = scoreShareStripLayout(20);
    expect(twenty).toHaveLength(20);
    expect(new Set(twenty.map((box) => box.y)).size).toBe(2);
    expect(twenty.every((box) => box.w === twenty[0].w && box.h === twenty[0].h)).toBe(true);
    expect(twenty[0].w / twenty[0].h).toBeCloseTo(64 / 90, 2);
    expect(twenty[0].w).toBe(Math.round((twenty[0].h * 64) / 90));
    expect(twenty[0].w).not.toBe(64);
    const twentyBottom = Math.max(...twenty.map((box) => box.y + box.h));
    expect(SCORE_DIGIT_TOP - twentyBottom).toBeGreaterThanOrEqual(SCORE_STRIP_CLEARANCE);
    expect(twentyBottom).toBeLessThanOrEqual(236);
    expect(scoreShareStripRowCapacity()).toBeGreaterThanOrEqual(10);

    const serverStrip = { x: 80, y: 136, w: 5 * 30 + 4 * 8, h: 42 };
    expect(SCORE_SHARE_STRIP.clearX).toBeLessThanOrEqual(serverStrip.x);
    expect(SCORE_SHARE_STRIP.clearY).toBeLessThanOrEqual(serverStrip.y);
    expect(SCORE_SHARE_STRIP.clearX + SCORE_SHARE_STRIP.clearW).toBeGreaterThanOrEqual(serverStrip.x + serverStrip.w);
    expect(SCORE_SHARE_STRIP.clearY + SCORE_SHARE_STRIP.clearH).toBeGreaterThanOrEqual(serverStrip.y + serverStrip.h);
  });

  it("repaints the strip band with the score-card radial glow, not a flat canvas fill", () => {
    const scoreCardSrc = readFileSync(new URL("../../../../server/contentFactory/generateScoreCard.ts", import.meta.url), "utf8");
    expect(scoreCardSrc).toContain('radialGradient id="glow" cx="85%" cy="12%" r="55%"');
    expect(scoreCardSrc).toContain('stop-color="#1e3a5f" stop-opacity="0.55"');
    const stops: Array<{ offset: number; color: string }> = [];
    let clipped = false;
    let fillStyle: string | { addColorStop(offset: number, color: string): void } = "";
    const fills: Array<{ color: string; w: number; h: number }> = [];
    const ctx = {
      fillStyle,
      strokeStyle: "",
      lineWidth: 1,
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      arcTo() {},
      closePath() {},
      clip() { clipped = true; },
      rect() {},
      fillRect(_x: number, _y: number, w: number, h: number) {
        fills.push({ color: typeof fillStyle === "string" ? fillStyle : "gradient", w, h });
      },
      stroke() {},
      drawImage() {},
      createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
        expect(x0).toBe(1080 * 0.85);
        expect(y0).toBeCloseTo(1080 * 0.12);
        expect(r0).toBe(0);
        expect(x1).toBe(x0);
        expect(y1).toBe(y0);
        expect(r1).toBe(1080 * 0.55);
        return {
          addColorStop(offset: number, color: string) {
            stops.push({ offset, color });
          },
        };
      },
    };
    Object.defineProperty(ctx, "fillStyle", {
      get() { return fillStyle; },
      set(value) { fillStyle = value; },
    });
    restoreScoreCardBand(ctx);
    expect(clipped).toBe(true);
    expect(fills.map((fill) => fill.color)).toEqual([SCORE_SHARE_STRIP.canvas, "gradient"]);
    expect(fills[0].w).toBe(SCORE_SHARE_STRIP.canvasSize);
    expect(stops).toEqual([
      { offset: 0, color: SCORE_SHARE_STRIP.glowInner },
      { offset: 1, color: SCORE_SHARE_STRIP.glowOuter },
    ]);
    expect(SCORE_SHARE_STRIP.glowInner).toBe("rgba(30, 58, 95, 0.55)");
  });

  it("composites only the tiles that loaded onto the score PNG", async () => {
    const draws: unknown[] = [];
    const base = new Blob(["png"], { type: "image/png" });
    const out = await composeScoreSharePng(base, [MASKED[0], "/api/play/r/solo/s/0/1/rev", MASKED[1]], {
      loadBase: async () => ({ width: 1080, height: 1080 }),
      loadTile: async (src) => (src === MASKED[1] ? null : { width: 8, height: 12, src }),
      taints: () => false,
      createCanvas: () => ({
        width: 1080,
        height: 1080,
        getContext: () => recordingPainter().ctx,
        toBlob(callback) {
          draws.push("blob");
          callback(new Blob(["composed"], { type: "image/png" }));
        },
      }),
    });
    expect(draws).toEqual(["blob"]);
    expect(await out.text()).toBe("composed");

    const unchanged = await composeScoreSharePng(base, ["/api/images/card/nope"], {
      createCanvas: () => {
        throw new Error("canvas should not be used");
      },
    });
    expect(unchanged).toBe(base);
  });
});

describe("share card wiring", () => {
  it("passes masked image URLs only and leaves mode chrome on the server PNG", () => {
    expect(gameSrc).toContain("maskedCardUrls={(session.questions ?? []).filter((q) => q.answered).map((q) => q.card?.imageUrl)}");
    expect(gameSrc).toContain('shareUrl="https://packpts.com"');
    expect(gameSrc).not.toContain("packpts.com/daily");
    const soloShare = gameSrc.slice(gameSrc.indexOf("<ShareAssetCard"), gameSrc.indexOf("/>", gameSrc.indexOf("<ShareAssetCard")) + 2);
    expect(soloShare).not.toContain("revealUrl");

    expect(daily5Src).toContain("maskedCardUrls={[...cards].sort((a, b) => a.position - b.position).map((card) => card.imageUrl)}");
    expect(daily5Src).not.toContain('shareUrl="https://packpts.com/daily"');
    const dailyShare = daily5Src.slice(daily5Src.indexOf("<ShareAssetCard"), daily5Src.indexOf("resolveShareUrl"));
    expect(dailyShare).toContain("maskedCardUrls={maskedCardUrls}");
    expect(dailyShare).not.toContain("revealUrl");

    expect(shareSrc).toContain("composeScoreSharePng");
    expect(shareSrc).toContain('kind === "maker" ? "https://packpts.com/sets" : "https://packpts.com"');
    expect(shareSrc).not.toContain("packpts.com/daily");
    expect(shareSrc).toContain("const tileKey = !isMaker ? sessionShareTileSources");
  });
});
