/**
 * v4.6 refusals are stored and readable only behind the QA token.
 * name_plate_unresolved stays fail-closed.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { readFile } from "fs/promises";
import express from "express";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { maskBakeRefusals } from "@shared/schema";
import { db } from "../db";
import { MASK_LAYOUT_SET_IDS } from "../masking/maskProfiles";
import { maskCardImage } from "../masking/maskCardImage";
import { detectAnchorTextPlate } from "../masking/namePlateDetect";
import { recordMaskBakeRefusal } from "../masking/maskRefusalLog";
import { registerDealableQaRoutes } from "../routes/dealableQa";

const TOKEN = "refusal-qa-token";
const W = 200;
const H = 280;
const setA = "91cfdf3f-a620-4e73-adc8-22b8df221716";
const setB = "aea515e2-0000-4000-8000-0000000000aa";
const jordanId = "119393bc-df92-4c46-aab7-8730dd9217c8";
const kellyId = "704c2dab-0000-4000-8000-0000000000c1";
const otherId = "0084c5bd-0000-4000-8000-0000000000c2";
const cardIds = [jordanId, kellyId, otherId];

const previousToken = process.env.COVER_QA_TOKEN;

function setToken(value: string | undefined) {
  if (value === undefined) delete process.env.COVER_QA_TOKEN;
  else process.env.COVER_QA_TOKEN = value;
}

async function lightBottomBannerCard(): Promise<Buffer> {
  const bannerH = Math.round(H * 0.22);
  const photoH = H - bannerH;
  const banner = await sharp({
    create: { width: W, height: bannerH, channels: 3, background: { r: 140, g: 196, b: 230 } },
  }).png().toBuffer();
  const letterH = Math.round(bannerH * 0.62);
  const composites: { input: Buffer; top: number; left: number }[] = [
    { input: banner, top: photoH, left: 0 },
  ];
  for (let i = 0; i < 10; i++) {
    const bar = await sharp({
      create: { width: 8, height: letterH, channels: 3, background: { r: 8, g: 10, b: 14 } },
    }).png().toBuffer();
    composites.push({
      input: bar,
      top: photoH + Math.round(bannerH * 0.18),
      left: 12 + i * 16,
    });
  }
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 20, g: 180, b: 40 } },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

describe("mask bake refusal QA", () => {
  const app = express();
  registerDealableQaRoutes(app);
  const server = createServer(app);
  let base = "";
  let sourcePng: Buffer;

  beforeAll(async () => {
    setToken(TOKEN);
    sourcePng = await sharp({
      create: { width: 40, height: 56, channels: 3, background: { r: 20, g: 180, b: 40 } },
    }).png().toBuffer();
    await db.delete(maskBakeRefusals).where(inArray(maskBakeRefusals.cardId, cardIds));
    await recordMaskBakeRefusal({
      cardId: jordanId,
      gameSetId: setA,
      reason: "name_plate_unresolved",
      layoutClass: "TOP_PLATE",
      profileSource: "profile",
      plateTrace: {
        imageWidth: 40,
        imageHeight: 56,
        decision: "name_plate_unresolved",
        expectedPlate: { x: 0, y: 0, w: 40, h: 10 },
        ocrBoxes: [{ text: "JORDAN", confidence: 91, x: 8, y: 24, w: 20, h: 8, zone: "middle" }],
        candidates: [
          {
            id: "top_text_plate",
            box: null,
            accepted: false,
            why: "detectAnchorTextPlate(top) returned null",
          },
          {
            id: "bottom_text_plate",
            box: { x: 0, y: 40, w: 40, h: 16 },
            accepted: false,
            why: "letter run on the other edge; profile band refused",
          },
        ],
      },
      paintRegions: [{ xPct: 0, yPct: 0, wPct: 100, hPct: 24, type: "blur", radiusPct: 0 }],
      sourceImage: sourcePng,
    });
    await db.update(maskBakeRefusals)
      .set({ createdAt: new Date("2026-09-26T06:03:52Z") })
      .where(eq(maskBakeRefusals.cardId, jordanId));
    await recordMaskBakeRefusal({
      cardId: kellyId,
      gameSetId: setA,
      reason: "name_plate_unresolved",
      layoutClass: "TOP_PLATE",
      profileSource: "profile",
      plateTrace: {
        imageWidth: 40,
        imageHeight: 56,
        decision: "name_plate_unresolved",
        expectedPlate: { x: 0, y: 0, w: 40, h: 13 },
        ocrBoxes: [],
        candidates: [],
      },
      paintRegions: [{ xPct: 0, yPct: 0, wPct: 100, hPct: 24, type: "blur", radiusPct: 0 }],
      sourceImage: sourcePng,
    });
    await db.update(maskBakeRefusals)
      .set({ createdAt: new Date("2026-09-26T06:04:00Z") })
      .where(eq(maskBakeRefusals.cardId, kellyId));
    await recordMaskBakeRefusal({
      cardId: otherId,
      gameSetId: setB,
      reason: "name_plate_unresolved",
      layoutClass: "TOP_PLATE",
      profileSource: "profile",
      plateTrace: null,
      paintRegions: [],
      sourceImage: sourcePng,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setToken(previousToken);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await db.delete(maskBakeRefusals).where(inArray(maskBakeRefusals.cardId, cardIds));
  });

  function headers(token?: string): HeadersInit {
    return token ? { "X-QA-Token": token } : {};
  }

  it("keeps name_plate_unresolved fail-closed and records the plate trace", async () => {
    const raw = await lightBottomBannerCard();
    const middle = { text: "JORDAN", x: 40, y: 120, w: 80, h: 20, confidence: 91 };
    const jordan = await maskCardImage(raw, "Michael Jordan", "1987 Topps Football", {
      skipOcr: true,
      gameSetId: MASK_LAYOUT_SET_IDS.toppsFootball1987,
      words: [middle],
    });
    const kelly = await maskCardImage(raw, "Jim Kelly", "1987 Topps Football", {
      skipOcr: true,
      gameSetId: MASK_LAYOUT_SET_IDS.toppsFootball1987,
      words: [{ text: "KELLY", x: 40, y: 120, w: 80, h: 20, confidence: 88 }],
    });
    const top = await detectAnchorTextPlate(raw, "top");
    const bottom = await detectAnchorTextPlate(raw, "bottom");

    expect(jordan.coverageOk).toBe(false);
    expect(jordan.coverageReason).toBe("name_plate_unresolved");
    expect(jordan.source).toBe("profile");
    expect(jordan.layoutClass).toBe("TOP_PLATE");
    expect(kelly.coverageOk).toBe(false);
    expect(kelly.coverageReason).toBe("name_plate_unresolved");
    expect(kelly.plateTrace.decision).toBe("name_plate_unresolved");

    const fleer = await maskCardImage(raw, "Michael Jordan", "1989 Fleer Basketball", {
      skipOcr: true,
      words: [middle],
    });
    expect(fleer.coverageOk).toBe(false);
    expect(fleer.coverageReason).toBe("name_plate_unresolved");
    expect(fleer.source).toBe("profile");
    expect(fleer.layoutClass).toBe("TOP_PLATE");
    expect(fleer.plateTrace.expectedPlate).toEqual({ x: 0, y: 0, w: W, h: Math.round(H * 0.18) });
    expect(fleer.plateTrace.candidates.find((row) => row.id === "bottom_text_plate")?.box).toEqual(bottom);
    expect(fleer.plateTrace.candidates.find((row) => row.id === "top_text_plate")?.box).toBeNull();

    expect(jordan.plateTrace.expectedPlate).toEqual({ x: 0, y: 0, w: W, h: Math.round(H * 0.24) });
    expect(jordan.plateTrace.ocrBoxes).toEqual([
      { text: "JORDAN", confidence: 91, x: 40, y: 120, w: 80, h: 20, zone: "middle" },
    ]);
    const byId = Object.fromEntries(jordan.plateTrace.candidates.map((row) => [row.id, row]));
    expect(byId.top_text_plate.box).toEqual(top);
    expect(byId.top_text_plate.accepted).toBe(false);
    expect(byId.bottom_text_plate.box).toEqual(bottom);
    expect(byId.bottom_text_plate.accepted).toBe(false);
    expect(byId.expected_profile.accepted).toBe(false);
    expect(byId.ocr_top_surname.why).toContain("0");
    expect(byId.ocr_bottom_surname.why).toContain("0");
    expect(bottom).toEqual({ x: 0, y: 230, w: 200, h: 38 });
    expect(top).toBeNull();
    expect(kelly.plateTrace.expectedPlate).toEqual(jordan.plateTrace.expectedPlate);
    expect(kelly.plateTrace.candidates.find((row) => row.id === "bottom_text_plate")?.box).toEqual(bottom);
  });

  it("lists refusals only with the header token and omits the source bytes", async () => {
    const missing = await fetch(`${base}/api/qa/rejected-cards`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toContain("no-store");

    const query = await fetch(`${base}/api/qa/rejected-cards?token=${TOKEN}`);
    expect(query.status).toBe(404);

    const wrong = await fetch(`${base}/api/qa/rejected-cards`, { headers: headers("nope") });
    expect(wrong.status).toBe(404);

    const page = await fetch(`${base}/api/qa/rejected-cards?setId=${setA}&offset=0&limit=10`, {
      headers: headers(TOKEN),
    });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toContain("no-store");
    expect(page.headers.get("cdn-cache-control")).toBe("no-store");
    const body = await page.json();
    expect(body.maskVersion).toBe(CURRENT_MASK_VERSION);
    expect(body.total).toBe(2);
    expect(body.refusals.map((row: { cardId: string }) => row.cardId)).toEqual([kellyId, jordanId]);
    expect(body.refusals[1].reason).toBe("name_plate_unresolved");
    expect(body.refusals[1].profileSource).toBe("profile");
    expect(body.refusals[1].layoutClass).toBe("TOP_PLATE");
    expect(body.refusals[1].expectedPlate).toEqual({ x: 0, y: 0, w: 40, h: 10 });
    expect(body.refusals[1].ocrBoxes[0].text).toBe("JORDAN");
    expect(body.refusals[1].ocrBoxes[0].confidence).toBe(91);
    expect(JSON.stringify(body)).not.toContain("\"type\":\"Buffer\"");
    expect(body.refusals[0].sourceImage).toBeUndefined();
    expect(body.refusals[1].debugPath).toBe(`/api/qa/rejected-cards/${jordanId}/debug.png`);
  });

  it("serves source, debug, and attempt images with no-store and without the mask cache", async () => {
    const source = await fetch(`${base}/api/qa/rejected-cards/${jordanId}/source`, { headers: headers(TOKEN) });
    expect(source.status).toBe(200);
    expect(source.headers.get("content-type")).toContain("image/png");
    expect(source.headers.get("cache-control")).toContain("no-store");
    expect(source.headers.get("x-mask-cache")).toBeNull();
    expect(Buffer.from(await source.arrayBuffer())).toEqual(sourcePng);

    const debug = await fetch(`${base}/api/qa/rejected-cards/${jordanId}/debug.png`, { headers: headers(TOKEN) });
    expect(debug.status).toBe(200);
    expect(debug.headers.get("content-type")).toContain("image/png");
    expect(debug.headers.get("cache-control")).toContain("no-store");
    expect(debug.headers.get("x-mask-cache")).toBeNull();
    const debugBytes = Buffer.from(await debug.arrayBuffer());
    expect(debugBytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(debugBytes.equals(sourcePng)).toBe(false);

    const attempt = await fetch(`${base}/api/qa/rejected-cards/${jordanId}/attempt.png`, { headers: headers(TOKEN) });
    expect(attempt.status).toBe(200);
    expect(attempt.headers.get("content-type")).toContain("image/png");
    expect(attempt.headers.get("x-mask-cache")).toBeNull();
    const attemptBytes = Buffer.from(await attempt.arrayBuffer());
    expect(attemptBytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(attemptBytes.equals(debugBytes)).toBe(false);

    const hidden = await fetch(`${base}/api/qa/rejected-cards/${jordanId}/source`);
    expect(hidden.status).toBe(404);
    const missing = await fetch(`${base}/api/qa/rejected-cards/not-a-card/debug.png`, { headers: headers(TOKEN) });
    expect(missing.status).toBe(404);
  });

  it("persists from both bake refusal branches and does not link the images from play send", async () => {
    const bake = await readFile(new URL("../masking/maskingService.ts", import.meta.url), "utf8");
    const calls = [...bake.matchAll(/await recordMaskBakeRefusal\(/g)].map((match) => match.index ?? -1);
    expect(calls).toHaveLength(2);
    const coverage = bake.indexOf("if (!result.coverageOk)");
    const band = bake.indexOf("const bandIssue = maskBandFailure");
    expect(coverage).toBeLessThan(calls[0]);
    expect(calls[0]).toBeLessThan(band);
    expect(calls[1]).toBeGreaterThan(band);
    const play = await readFile(new URL("../services/playImageSend.ts", import.meta.url), "utf8");
    expect(play).not.toContain("rejected-cards");
    const png = await readFile(new URL("../masking/maskRefusalPng.ts", import.meta.url), "utf8");
    expect(png).not.toContain("MASKED_CARDS_DIR");
    expect(png).not.toContain("cardImageMaskCache");
  });
});
