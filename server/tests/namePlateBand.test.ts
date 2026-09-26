/**
 * Tight-crop name plates, post-bake exclusion, and per-slot cover identity.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import express from "express";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  fitNamePlateBand,
  regionCoversPlate,
  type NamePlateBox,
} from "@shared/maskGeometry";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { applyPercentRegions, maskCardImage } from "../masking/maskCardImage";
import { verifyMaskedNamePlate } from "../masking/maskPlateVerify";
import { quarantineUncoveredName } from "../masking/maskingService";
import {
  readMaskFailureReason,
  setMaskReadySidecarDirForTests,
} from "../masking/maskReadySidecar";
import {
  FLEER_1989_BASKETBALL_CARDS,
  reportMaskSweep,
} from "../masking/maskPlateSweep";
import { storage } from "../storage";
import {
  clearReadyCoverIndexForTests,
  handlePublicSetCover,
  pickCoverSlots,
  setCoverEtag,
} from "../services/setCovers";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";

const TIGHT_W = 488;
const TIGHT_H = 761;
const NORMAL_W = 750;
const NORMAL_H = 1030;

function fixedTopBand(hPct: number) {
  return { xPct: 0, yPct: 0, wPct: 100, hPct, type: "blur" as const };
}

describe("name plate band geometry", () => {
  it("covers a 488x761 top plate that the fixed 18% band cuts through", () => {
    const plate: NamePlateBox = { x: 0, y: 6, w: TIGHT_W, h: 170 };
    expect(regionCoversPlate(fixedTopBand(18), plate, TIGHT_W, TIGHT_H)).toBe(false);

    const band = fitNamePlateBand({
      anchor: "top",
      imageWidth: TIGHT_W,
      imageHeight: TIGHT_H,
      profileFraction: 0.18,
      plate,
    });
    expect(band.yPct).toBe(0);
    expect(band.wPct).toBe(100);
    expect(band.hPct).toBeGreaterThan(18);
    expect(regionCoversPlate(band, plate, TIGHT_W, TIGHT_H)).toBe(true);
  });

  it("covers a normal ~750x1030 top plate", () => {
    const plate: NamePlateBox = { x: 18, y: 36, w: 710, h: 124 };
    const band = fitNamePlateBand({
      anchor: "top",
      imageWidth: NORMAL_W,
      imageHeight: NORMAL_H,
      profileFraction: 0.18,
      plate,
    });
    expect(band.yPct).toBe(0);
    expect(regionCoversPlate(band, plate, NORMAL_W, NORMAL_H)).toBe(true);
    expect(regionCoversPlate(fixedTopBand(18), plate, NORMAL_W, NORMAL_H)).toBe(true);
  });

  it("covers a bottom plaque that starts above the fixed fraction", () => {
    const plate: NamePlateBox = { x: 0, y: 500, w: TIGHT_W, h: 240 };
    const fixed = { xPct: 0, yPct: 80, wPct: 100, hPct: 20, type: "blur" as const };
    expect(regionCoversPlate(fixed, plate, TIGHT_W, TIGHT_H)).toBe(false);
    const band = fitNamePlateBand({
      anchor: "bottom",
      imageWidth: TIGHT_W,
      imageHeight: TIGHT_H,
      profileFraction: 0.2,
      plate,
    });
    expect(regionCoversPlate(band, plate, TIGHT_W, TIGHT_H)).toBe(true);
    expect(band.yPct + band.hPct).toBeGreaterThan(99);
  });
});

async function stripedTopPlate(width: number, height: number, plateFraction: number): Promise<Buffer> {
  const plateH = Math.round(height * plateFraction);
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (y < plateH) {
        const ink = Math.floor(x / 8) % 2 === 0;
        const value = ink ? 20 : 235;
        raw[i] = value;
        raw[i + 1] = value;
        raw[i + 2] = value;
      } else {
        raw[i] = 20;
        raw[i + 1] = 180;
        raw[i + 2] = 40;
      }
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("post-bake name check", () => {
  it("fails when the plate still shows name-like rows past a short band", async () => {
    const width = 244;
    const height = 380;
    const raw = await stripedTopPlate(width, height, 0.24);
    const short = await applyPercentRegions(raw, [fixedTopBand(18)]);
    const plate: NamePlateBox = { x: 0, y: 0, w: width, h: Math.round(height * 0.24) };
    const verdict = await verifyMaskedNamePlate({
      buffer: short,
      plate,
      layoutClass: "TOP_PLATE",
      imageWidth: width,
      imageHeight: height,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("name_text_visible");
  });

  it("bakes a tight Fleer crop so the band covers the plate and the photo stays", async () => {
    const width = 244;
    const height = 380;
    const raw = await stripedTopPlate(width, height, 0.24);
    const result = await maskCardImage(raw, "Kevin Johnson", "1989 Fleer Basketball", { skipOcr: true });
    expect(result.coverageOk).toBe(true);
    expect(result.layoutClass).toBe("TOP_PLATE");
    expect(result.regions[0]?.yPct).toBe(0);
    expect((result.regions[0]?.hPct || 0)).toBeGreaterThan(18);

    const meta = await sharp(result.maskedBuffer).metadata();
    const y = Math.round(((meta.height || height) - 1) * 0.21);
    const x = Math.round(((meta.width || width) - 1) * 0.5);
    const covered = await sharp(result.maskedBuffer).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer();
    expect(covered[0]).toBeLessThan(40);
    const photoY = Math.round(((meta.height || height) - 1) * 0.7);
    const photo = await sharp(result.maskedBuffer).extract({ left: x, top: photoY, width: 1, height: 1 }).raw().toBuffer();
    expect(photo[1]).toBeGreaterThan(120);
  });
});

describe("cover slots", () => {
  it("dedupes players and gives each slot its own ETag", () => {
    const setId = "11111111-2222-4333-8444-555555555555";
    const first = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const second = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const third = "cccccccc-dddd-4eee-8fff-000000000000";
    const picked = pickCoverSlots([
      { id: first, player: "Kevin Johnson" },
      { id: second, player: "KEVIN JOHNSON JR." },
      { id: third, player: "Tom Chambers" },
    ]);
    expect(picked.map((row) => row.id)).toEqual([first, third]);

    const slot0 = setCoverEtag(setId, 0, first);
    const slot1 = setCoverEtag(setId, 1, third);
    expect(slot0).not.toBe(slot1);
    expect(slot0).not.toBe(`"${CURRENT_MASK_VERSION}"`);
    expect(slot0).not.toContain(first);
    expect(slot1).not.toContain(third);
    expect(slot0).toBe(setCoverEtag(setId, 0, first));
    expect(setCoverEtag(setId, 0, second)).not.toBe(slot0);
  });
});

describe("mask plate sweep report", () => {
  it("counts pass and fail and flags a tight crop against the set median", () => {
    expect(FLEER_1989_BASKETBALL_CARDS).toBe(168);
    const cards = Array.from({ length: FLEER_1989_BASKETBALL_CARDS }, (_, index) => ({
      id: `fleer-${index}`,
      width: index === 3 ? 488 : 750,
      height: index === 3 ? 761 : 1030,
      pass: index !== 3,
      reason: index === 3 ? "name_text_visible" : null,
    }));
    const [report] = reportMaskSweep([{
      setId: "fleer-1989",
      setName: "1989 Fleer Basketball",
      cards,
    }]);
    expect(report.cardCount).toBe(168);
    expect(report.pass).toBe(167);
    expect(report.fail).toBe(1);
    expect(report.outliers.map((row) => row.id)).toEqual(["fleer-3"]);
  });
});

describe("failed post-bake verification stays out of deals and covers", () => {
  const stamp = randomUUID().slice(0, 8);
  const setId = randomUUID();
  const leakedId = randomUUID();
  const safeId = randomUUID();
  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => {
    void handlePublicSetCover(req, res);
  });
  const server = createServer(app);
  let base = "";
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-plate-fail-"));
    setMaskReadySidecarDirForTests(dir);
    await db.insert(gameSets).values({
      id: setId,
      sport: "basketball",
      brand: "Fleer",
      year: 1989,
      setName: `1989 Fleer Basketball ${stamp}`,
      isUserCreated: false,
      isActive: true,
    });
    const card = (id: string, player: string, createdAt: string) => ({
      id,
      gameSetId: setId,
      cardhedgeCardId: `plate:${id}`,
      player,
      set: `1989 Fleer Basketball ${stamp}`,
      description: player,
      imageUrl: `https://images.example.com/${id}.jpg`,
      category: "basketball",
      isPlayable: true,
      contentVerified: true as boolean | null,
      imageReviewStatus: "unreviewed",
      quarantineStatus: "OK",
      proposedUnplayable: false,
      lastImageCheck: new Date(),
      createdAt: new Date(createdAt),
    });
    await db.insert(playableCards).values([
      card(leakedId, "KEVIN JOHNSON", "2020-01-02T00:00:00.000Z"),
      card(safeId, "TOM CHAMBERS", "2020-01-03T00:00:00.000Z"),
    ]);
    await writeFile(path.join(dir, warmOkMarkerFilename(leakedId)), "ok\n");
    await writeFile(path.join(dir, `${leakedId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from("leaked-jpeg"));
    await writeFile(path.join(dir, warmOkMarkerFilename(safeId)), "ok\n");
    await writeFile(path.join(dir, `${safeId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from("safe-jpeg"));
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setMaskReadySidecarDirForTests(null);
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await db.delete(playableCards).where(inArray(playableCards.id, [leakedId, safeId])).catch(() => null);
    await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  it("excludes the card from solo dealing and from cover slots", async () => {
    await quarantineUncoveredName(leakedId, "name_text_visible");
    clearReadyCoverIndexForTests();
    expect(readMaskFailureReason(leakedId, dir)).toBe("name_text_visible");

    const dealt = await storage.getRandomCardsFromSet(setId, 10);
    const dealtIds = dealt.map((card) => card.id);
    expect(dealtIds).toContain(safeId);
    expect(dealtIds).not.toContain(leakedId);

    const safe = await fetch(`${base}/api/sets/${setId}/covers/0`);
    expect(safe.status).toBe(200);
    expect(safe.headers.get("etag")).toBe(setCoverEtag(setId, 0, safeId));
    expect(safe.headers.get("etag")).not.toContain(safeId);
    expect(Buffer.from(await safe.arrayBuffer()).toString()).toBe("safe-jpeg");

    const leaked = await fetch(`${base}/api/sets/${setId}/covers/1`);
    expect(leaked.status).toBe(404);
    const body = await leaked.text();
    expect(body).not.toContain(leakedId);
    expect(body).not.toContain("KEVIN JOHNSON");
  });
});
