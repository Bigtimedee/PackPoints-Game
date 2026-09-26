/**
 * Layout-aware band guard. Report mode logs and excludes nothing.
 * Enforce mode drops oversized and misplaced bands. A 46% bottom plaque stays.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { existsSync, readFileSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { dailyChallengeCards, dailyChallenges, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { maskFailureSidecarFilename, setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import {
  clearMaskBandCacheForTests,
  maskBandFailure,
  MASK_BAND_EDGE_TOLERANCE_PCT,
  MASK_BAND_MISPLACED,
  MASK_BAND_OVERSIZED,
  MAX_BOTTOM_BAND_PCT,
  MAX_TOP_BAND_PCT,
  runMaskBandGuardScan,
} from "../masking/maskBandLimit";
import { getMaskedImagePath } from "../masking/maskingService";
import { clearReadyCoverIndexForTests, handlePublicSetCover, readyMaskedCoverUrls } from "../services/setCovers";
import { replaceBlockedDaily5Cards } from "../lib/cardBlocklist";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";

const stamp = randomUUID().slice(0, 8);
const prefix = `bandguard:${stamp}:`;
const setId = randomUUID();
const setTitle = `2024 Basketball ${stamp}`;
const coverPlayers = ["Cover One", "Cover Two", "Cover Three", "Cover Four", "Cover Five", "Cover Six"];

const cardIds: string[] = [];
const challengeIds: string[] = [];
let dir = "";
let createdSet = false;
let floatId = "";
let tallBottomId = "";
let tallTopId = "";
let normalId = "";
let shortTopId = "";
let floatBytes = Buffer.alloc(0);
let normalBytes = Buffer.alloc(0);
const previousGuard = process.env.MASK_BAND_GUARD;

function band(hPct: number, yPct = 0, wPct = 100) {
  return [{ xPct: 0, yPct, wPct, hPct, type: "solid" as const }];
}

function planBody(regions: ReturnType<typeof band>) {
  return JSON.stringify({
    layoutClass: "BOTTOM_PLAQUE",
    regions,
    maskVersion: CURRENT_MASK_VERSION,
  });
}

function card(player: string, createdAt: string) {
  const id = randomUUID();
  cardIds.push(id);
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `${prefix}${id}`,
    player,
    set: setTitle,
    description: player,
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: "basketball",
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "approved",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    lastImageCheck: new Date(),
    createdAt: new Date(createdAt),
  };
}

async function writeBaked(id: string, player: string, regions: ReturnType<typeof band>) {
  const body = Buffer.from(`masked-${player}-${id}`);
  await writeFile(path.join(dir, warmOkMarkerFilename(id)), "ok\n");
  await writeFile(path.join(dir, `${id}_${CURRENT_MASK_VERSION}.jpg`), body);
  await writeFile(path.join(dir, `${id}_${CURRENT_MASK_VERSION}.json`), planBody(regions));
  return body;
}

describe("mask band placement", () => {
  it("uses a 35% top limit, a 55% bottom limit, and a 3 point edge window", () => {
    expect(MAX_TOP_BAND_PCT).toBe(35);
    expect(MAX_BOTTOM_BAND_PCT).toBe(55);
    expect(MASK_BAND_EDGE_TOLERANCE_PCT).toBe(3);
    expect(CURRENT_MASK_VERSION).toBe("v4.5");
    expect(maskBandFailure(band(46, 54))).toBeNull();
    expect(maskBandFailure(band(55, 45))).toBeNull();
    expect(maskBandFailure(band(56, 44))).toBe(MASK_BAND_OVERSIZED);
    expect(maskBandFailure(band(36, 0))).toBe(MASK_BAND_OVERSIZED);
    expect(maskBandFailure(band(35, 0))).toBeNull();
    expect(maskBandFailure(band(28, 0))).toBeNull();
    expect(maskBandFailure(band(77, 19))).toBe(MASK_BAND_MISPLACED);
    expect(maskBandFailure(band(50, 0, 20))).toBeNull();
  });
});

describe("band guard report and enforce", () => {
  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => {
    void handlePublicSetCover(req, res);
  });
  const server = createServer(app);
  let base = "";

  beforeAll(async () => {
    delete process.env.MASK_BAND_GUARD;
    dir = await mkdtemp(path.join(tmpdir(), "packpts-band-guard-"));
    setMaskReadySidecarDirForTests(dir);
    clearMaskBandCacheForTests();
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await db.insert(gameSets).values({
      id: setId,
      sport: "basketball",
      brand: "Panini",
      year: 2024,
      setName: setTitle,
      isUserCreated: true,
      isActive: true,
    });
    createdSet = true;

    const float = card("Float Band", "2020-01-01T00:00:00.000Z");
    const tallBottom = card("Tall Plaque", "2020-01-02T00:00:00.000Z");
    const tallTop = card("Tall Top", "2020-01-03T00:00:00.000Z");
    const normal = card("Normal Plaque", "2020-01-04T00:00:00.000Z");
    const shortTop = card("Short Top", "2020-01-05T00:00:00.000Z");
    floatId = float.id;
    tallBottomId = tallBottom.id;
    tallTopId = tallTop.id;
    normalId = normal.id;
    shortTopId = shortTop.id;
    const covers = coverPlayers.map((player, i) => card(player, `2020-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`));

    floatBytes = await writeBaked(float.id, float.player, band(77, 19));
    await writeBaked(tallBottom.id, tallBottom.player, band(56, 44));
    await writeBaked(tallTop.id, tallTop.player, band(36, 0));
    normalBytes = await writeBaked(normal.id, normal.player, band(46, 54));
    await writeBaked(shortTop.id, shortTop.player, band(28, 0));
    for (const row of covers) await writeBaked(row.id, row.player, band(20, 80));
    await db.insert(playableCards).values([float, tallBottom, tallTop, normal, shortTop, ...covers]);
    clearReadyCoverIndexForTests();
  });

  afterAll(async () => {
    if (previousGuard === undefined) delete process.env.MASK_BAND_GUARD;
    else process.env.MASK_BAND_GUARD = previousGuard;
    setMaskReadySidecarDirForTests(null);
    clearMaskBandCacheForTests();
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (challengeIds.length > 0) {
      await db.delete(dailyChallengeCards).where(inArray(dailyChallengeCards.dailyChallengeId, challengeIds)).catch(() => null);
      await db.delete(dailyChallenges).where(inArray(dailyChallenges.id, challengeIds)).catch(() => null);
    }
    if (cardIds.length > 0) await db.delete(playableCards).where(inArray(playableCards.id, cardIds)).catch(() => null);
    await db.delete(playableCards).where(like(playableCards.cardhedgeCardId, `${prefix}%`)).catch(() => null);
    if (createdSet) await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  it("reports counts and still deals a 46% bottom band, a 56% bottom band, and a floating band", async () => {
    delete process.env.MASK_BAND_GUARD;
    clearMaskBandCacheForTests();

    const dealt = await storage.getRandomCardsFromSet(setId, 20);
    const players = dealt.map((row) => row.player);
    expect(players).toContain("Normal Plaque");
    expect(players).toContain("Tall Plaque");
    expect(players).toContain("Tall Top");
    expect(players).toContain("Short Top");
    expect(players).toContain("Float Band");
    expect(dealt).toHaveLength(11);

    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      if (typeof msg === "string" && msg.startsWith("[mask-band-guard]")) lines.push(msg);
    });
    const scan = await runMaskBandGuardScan({ dir, batchSize: 4, concurrency: 2, pauseMs: 0 });
    spy.mockRestore();

    const setLine = `[mask-band-guard] set=${setId.slice(0, 8)} title=${setTitle} eligibleNow=11 wouldDrop=3 oversized=2 misplaced=1 eligibleAfter=8`;
    const totalLine = `[mask-band-guard] set=all title=all eligibleNow=11 wouldDrop=3 oversized=2 misplaced=1 eligibleAfter=8`;
    expect(scan.mode).toBe("report");
    expect(lines).toContain(setLine);
    expect(lines).toContain(totalLine);
    expect(scan.lines).toEqual([setLine, totalLine]);

    const [floatRow] = await db.select({
      isPlayable: playableCards.isPlayable,
      blockedReason: playableCards.blockedReason,
    }).from(playableCards).where(eq(playableCards.id, floatId));
    expect(floatRow.isPlayable).toBe(true);
    expect(floatRow.blockedReason).toBeNull();
    expect(existsSync(path.join(dir, maskFailureSidecarFilename(floatId)))).toBe(false);
    expect(existsSync(path.join(dir, warmOkMarkerFilename(floatId)))).toBe(true);

    clearReadyCoverIndexForTests();
    const urls = await readyMaskedCoverUrls([setId]);
    expect(urls.get(setId)).toHaveLength(8);
    const slot0 = await fetch(`${base}/api/sets/${setId}/covers/0`);
    expect(slot0.status).toBe(200);
    expect(Buffer.from(await slot0.arrayBuffer())).toEqual(floatBytes);

    const [challenge] = await db.insert(dailyChallenges).values({
      date: "2099-11-07",
      mode: "DAILY5",
      setId,
      seed: "band-report",
      startsAt: new Date("2099-11-07T00:00:00.000Z"),
      endsAt: new Date("2099-11-08T00:00:00.000Z"),
      status: "ACTIVE",
    }).returning();
    challengeIds.push(challenge.id);
    const hand = [floatId, normalId, shortTopId, cardIds.find((id) => ![floatId, tallBottomId, tallTopId, normalId, shortTopId].includes(id))!];
    await db.insert(dailyChallengeCards).values([
      ...hand.map((id, index) => ({
        dailyChallengeId: challenge.id,
        position: index + 1,
        cardId: id,
        correctAnswer: id === floatId ? "Float Band" : "Normal Plaque",
        choices: id === floatId
          ? ["Float Band", "Normal Plaque", "Short Top", "Cover One"]
          : ["Normal Plaque", "Short Top", "Cover One", "Cover Two"],
        pointValue: 100,
      })),
      {
        dailyChallengeId: challenge.id,
        position: 5,
        cardId: normalId,
        correctAnswer: "Normal Plaque",
        choices: ["Normal Plaque", "Short Top", "Cover One", "Cover Two"],
        pointValue: 100,
      },
    ]);
    const left = await replaceBlockedDaily5Cards(challenge.id, "2099-11-07");
    expect(left).toBe(0);
    const [still] = await db.select({ cardId: dailyChallengeCards.cardId, correctAnswer: dailyChallengeCards.correctAnswer })
      .from(dailyChallengeCards)
      .where(and(eq(dailyChallengeCards.dailyChallengeId, challenge.id), eq(dailyChallengeCards.position, 1)));
    expect(still.cardId).toBe(floatId);
    expect(still.correctAnswer).toBe("Float Band");
  });

  it("enforces the limits, keeps a 46% bottom band, and replaces a stored floating band", async () => {
    process.env.MASK_BAND_GUARD = "enforce";
    clearMaskBandCacheForTests();
    await runMaskBandGuardScan({ dir, batchSize: 4, concurrency: 2, pauseMs: 0 });

    const [floatRow] = await db.select({
      isPlayable: playableCards.isPlayable,
      blockedReason: playableCards.blockedReason,
    }).from(playableCards).where(eq(playableCards.id, floatId));
    const [bottomRow] = await db.select({ blockedReason: playableCards.blockedReason })
      .from(playableCards).where(eq(playableCards.id, tallBottomId));
    const [topRow] = await db.select({ blockedReason: playableCards.blockedReason })
      .from(playableCards).where(eq(playableCards.id, tallTopId));
    const [normalRow] = await db.select({
      isPlayable: playableCards.isPlayable,
      blockedReason: playableCards.blockedReason,
    }).from(playableCards).where(eq(playableCards.id, normalId));
    expect(floatRow.isPlayable).toBe(false);
    expect(floatRow.blockedReason).toBe(MASK_BAND_MISPLACED);
    expect(bottomRow.blockedReason).toBe(MASK_BAND_OVERSIZED);
    expect(topRow.blockedReason).toBe(MASK_BAND_OVERSIZED);
    expect(normalRow.isPlayable).toBe(true);
    expect(normalRow.blockedReason).toBeNull();
    expect(readFileSync(path.join(dir, maskFailureSidecarFilename(floatId)), "utf8").trim()).toBe(MASK_BAND_MISPLACED);
    expect(existsSync(path.join(dir, warmOkMarkerFilename(normalId)))).toBe(true);

    clearMaskBandCacheForTests();
    const dealt = await storage.getRandomCardsFromSet(setId, 20);
    const players = dealt.map((row) => row.player);
    expect(players).toContain("Normal Plaque");
    expect(players).toContain("Short Top");
    expect(players).not.toContain("Float Band");
    expect(players).not.toContain("Tall Plaque");
    expect(players).not.toContain("Tall Top");
    expect(dealt).toHaveLength(8);

    clearReadyCoverIndexForTests();
    const urls = await readyMaskedCoverUrls([setId]);
    expect(urls.get(setId)).toHaveLength(8);
    const slot0 = await fetch(`${base}/api/sets/${setId}/covers/0`);
    expect(slot0.status).toBe(200);
    expect(Buffer.from(await slot0.arrayBuffer())).toEqual(normalBytes);

    const started = Date.now();
    const left = await replaceBlockedDaily5Cards(challengeIds[0], "2099-11-07");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(left).toBe(0);
    const dealtHand = await db.select({
      cardId: dailyChallengeCards.cardId,
      correctAnswer: dailyChallengeCards.correctAnswer,
      choices: dailyChallengeCards.choices,
    }).from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, challengeIds[0]))
      .orderBy(asc(dailyChallengeCards.position));
    expect(dealtHand.some((row) => row.cardId === floatId)).toBe(false);
    for (const row of dealtHand) {
      expect(row.correctAnswer).not.toBe("Float Band");
      expect((row.choices as string[]).join(" ")).not.toContain("Float Band");
    }

    await expect(getMaskedImagePath(floatId)).resolves.toBeNull();
  });
});
