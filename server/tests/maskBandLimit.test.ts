/**
 * Oversized name bands stay out of deals, covers, and replacements.
 * Already-baked v4.5 cards are judged from the plan sidecar. No mask-version bump.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { existsSync, readFileSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { dailyChallengeCards, dailyChallenges, gameSessionsTable, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { setMaskReadySidecarDirForTests, maskFailureSidecarFilename } from "../masking/maskReadySidecar";
import {
  clearMaskBandCacheForTests,
  isOversizedMaskBand,
  markOversizedBakedCards,
  maskedBandFraction,
  MASK_BAND_OVERSIZED,
  MAX_MASK_BAND_FRACTION,
} from "../masking/maskBandLimit";
import { getMaskedImagePath } from "../masking/maskingService";
import { clearReadyCoverIndexForTests, handlePublicSetCover, readyMaskedCoverUrls } from "../services/setCovers";
import { eligibleDealFilter } from "../services/playableSetEligibility";
import { replaceBlockedDaily5Cards } from "../lib/cardBlocklist";
import { findWarmMaskedPath, resolveReadyWarmMaskedFile, warmOkMarkerFilename } from "../startup/warmMaskGate";
import { maskToken } from "../services/playImageToken";

const stamp = randomUUID().slice(0, 8);
const prefix = `bandlimit:${stamp}:`;
const setId = randomUUID();
const coverPlayers = [
  "Cover One",
  "Cover Two",
  "Cover Three",
  "Cover Four",
  "Cover Five",
  "Cover Six",
  "Cover Seven",
];

const cardIds: string[] = [];
const challengeIds: string[] = [];
let sessionId = "";
let dir = "";
let createdSet = false;
let wideId = "";
let keptId = "";
let exactId = "";
let lateId = "";
let wideBytes = Buffer.alloc(0);
let keptBytes = Buffer.alloc(0);

function band(hPct: number, yPct = 0, wPct = 100) {
  return [{ xPct: 0, yPct, wPct, hPct, type: "solid" as const }];
}

function planBody(regions: ReturnType<typeof band>) {
  return JSON.stringify({
    layoutClass: "TOP_PLATE",
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
    set: `Band Limit ${stamp}`,
    description: player,
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: "football",
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

describe("mask band fraction", () => {
  it("drops bands over 35% and keeps 35% and under", () => {
    expect(MAX_MASK_BAND_FRACTION).toBe(0.35);
    expect(CURRENT_MASK_VERSION).toBe("v4.5");
    expect(isOversizedMaskBand(band(36))).toBe(true);
    expect(isOversizedMaskBand(band(28))).toBe(false);
    expect(isOversizedMaskBand(band(35))).toBe(false);
    expect(isOversizedMaskBand(band(30))).toBe(false);
    expect(isOversizedMaskBand(band(40))).toBe(true);
    expect(isOversizedMaskBand(band(43))).toBe(true);
    expect(isOversizedMaskBand(band(55))).toBe(true);
    expect(maskedBandFraction(band(77, 19))).toBeCloseTo(0.77);
    expect(isOversizedMaskBand(band(77, 19))).toBe(true);
    expect(isOversizedMaskBand(band(50, 0, 20))).toBe(false);
    expect(isOversizedMaskBand([...band(20), ...band(20, 50)])).toBe(true);
    expect(isOversizedMaskBand([...band(20), ...band(15, 10)])).toBe(false);
  });
});

describe("oversized bands stay out of deals, covers, and replacements", () => {
  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => {
    void handlePublicSetCover(req, res);
  });
  const server = createServer(app);
  let base = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-band-"));
    setMaskReadySidecarDirForTests(dir);
    clearMaskBandCacheForTests();
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const [existing] = await db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.id, setId)).limit(1);
    if (!existing) {
      await db.insert(gameSets).values({
        id: setId,
        sport: "football",
        brand: "Topps",
        year: 1994,
        setName: `1994 Topps Football ${stamp}`,
        isUserCreated: true,
        isActive: true,
      });
      createdSet = true;
    }

    const wide = card("Wide Plate", "2020-01-01T00:00:00.000Z");
    const kept = card("Kept Plate", "2020-01-02T00:00:00.000Z");
    const exact = card("Exact Plate", "2020-01-03T00:00:00.000Z");
    wideId = wide.id;
    keptId = kept.id;
    exactId = exact.id;
    const covers = coverPlayers.map((player, i) => card(player, `2020-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`));
    wideBytes = await writeBaked(wide.id, wide.player, band(36));
    keptBytes = await writeBaked(kept.id, kept.player, band(28));
    await writeBaked(exact.id, exact.player, band(35));
    for (const row of covers) await writeBaked(row.id, row.player, band(12));

    await db.insert(playableCards).values([wide, kept, exact, ...covers]);
    clearMaskBandCacheForTests();
    const scan = await markOversizedBakedCards({ dir, batchSize: 4, concurrency: 2, pauseMs: 0 });
    expect(scan.marked).toBe(1);
    expect(scan.scanned).toBe(10);

    const [wideRow] = await db.select({
      isPlayable: playableCards.isPlayable,
      blockedReason: playableCards.blockedReason,
    }).from(playableCards).where(eq(playableCards.id, wideId));
    expect(wideRow.isPlayable).toBe(false);
    expect(wideRow.blockedReason).toBe(MASK_BAND_OVERSIZED);
    expect(readFileSync(path.join(dir, maskFailureSidecarFilename(wideId)), "utf8").trim()).toBe(MASK_BAND_OVERSIZED);
    expect(existsSync(path.join(dir, warmOkMarkerFilename(wideId)))).toBe(false);
    expect(existsSync(path.join(dir, `${wideId}_${CURRENT_MASK_VERSION}.jpg`))).toBe(true);
    expect(existsSync(path.join(dir, warmOkMarkerFilename(keptId)))).toBe(true);
    expect(existsSync(path.join(dir, maskFailureSidecarFilename(keptId)))).toBe(false);
    clearReadyCoverIndexForTests();
  });

  afterAll(async () => {
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
    if (sessionId) await db.delete(gameSessionsTable).where(eq(gameSessionsTable.id, sessionId)).catch(() => null);
    if (cardIds.length > 0) await db.delete(playableCards).where(inArray(playableCards.id, cardIds)).catch(() => null);
    await db.delete(playableCards).where(like(playableCards.cardhedgeCardId, `${prefix}%`)).catch(() => null);
    if (createdSet) await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  it("excludes a 36% band from solo deals and keeps 28% and 35%", async () => {
    const late = card("Late Plate", "2020-06-01T00:00:00.000Z");
    lateId = late.id;
    await writeBaked(late.id, late.player, band(36));
    await db.insert(playableCards).values(late);
    clearMaskBandCacheForTests();

    const dealt = await storage.getRandomCardsFromSet(setId, 20);
    expect(dealt.some((row) => row.id === wideId || row.player === "Wide Plate")).toBe(false);
    expect(dealt.some((row) => row.id === lateId || row.player === "Late Plate")).toBe(false);
    expect(dealt.some((row) => row.id === keptId)).toBe(true);
    expect(dealt.some((row) => row.id === exactId)).toBe(true);
    expect(readFileSync(path.join(dir, maskFailureSidecarFilename(lateId)), "utf8").trim()).toBe(MASK_BAND_OVERSIZED);
    expect(existsSync(path.join(dir, warmOkMarkerFilename(lateId)))).toBe(false);

    await markOversizedBakedCards({ dir, batchSize: 4, concurrency: 2, pauseMs: 0 });
    const [lateRow] = await db.select({
      isPlayable: playableCards.isPlayable,
      blockedReason: playableCards.blockedReason,
    }).from(playableCards).where(eq(playableCards.id, lateId));
    expect(lateRow.blockedReason).toBe(MASK_BAND_OVERSIZED);
    expect(lateRow.isPlayable).toBe(false);
  });

  it("falls through an oversized cover and still fills 8", async () => {
    clearReadyCoverIndexForTests();
    const urls = await readyMaskedCoverUrls([setId]);
    expect(urls.get(setId)).toHaveLength(8);

    const bodies: Buffer[] = [];
    for (let slot = 0; slot < 8; slot++) {
      const res = await fetch(`${base}/api/sets/${setId}/covers/${slot}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-card-id")).toBeNull();
      bodies.push(Buffer.from(await res.arrayBuffer()));
    }
    expect(bodies[0]).toEqual(keptBytes);
    for (const body of bodies) expect(body.equals(wideBytes)).toBe(false);
  });

  it("skips an oversized card when choosing a replacement", async () => {
    const sneak = card("Sneak Plate", "2020-07-01T00:00:00.000Z");
    await writeBaked(sneak.id, sneak.player, band(36));
    await db.insert(playableCards).values(sneak);
    const dim = cardIds.filter((id) => id !== keptId && id !== exactId && id !== sneak.id);
    await db.update(playableCards).set({ imageReviewStatus: "unreviewed" }).where(inArray(playableCards.id, dim));

    sessionId = randomUUID();
    const failedId = keptId;
    await db.insert(gameSessionsTable).values({
      id: sessionId,
      mode: "solo",
      questions: [{
        card: {
          id: failedId,
          playableCardId: failedId,
          gameSetId: setId,
          playerName: "Kept Plate",
          team: "",
          year: 1994,
          cardNumber: "1",
          imageUrl: "https://packpts.com/cards/failed.jpg",
          popularity: 50,
          imageVerified: true,
          setName: "1994 Topps Football",
          position: "",
        },
        options: ["Kept Plate", "Cover One", "Cover Two", "Cover Three"],
        correctAnswer: "Kept Plate",
        pointValue: 100,
      }],
      currentQuestionIndex: 0,
      score: 0,
      correctAnswers: 0,
      totalQuestions: 1,
      skippedQuestions: 0,
      status: "active",
      startedAt: "2026-09-26T00:00:00.000Z",
    });

    try {
      for (let i = 0; i < 8; i++) {
        const result = await storage.getReplacementCardForSession(sessionId, failedId, []);
        expect(result).toBeTruthy();
        expect(result!.question.card.id).toBe(exactId);
        expect(result!.question.correctAnswer).not.toBe("Sneak Plate");
        expect(result!.question.correctAnswer).not.toBe("Wide Plate");
      }
    } finally {
      await db.update(playableCards).set({ imageReviewStatus: "approved" }).where(inArray(playableCards.id, dim));
    }
  });

  it("swaps a stored Daily 5 card with an oversized band and does not reveal it", async () => {
    const [challenge] = await db.insert(dailyChallenges).values({
      date: "2099-11-06",
      mode: "DAILY5",
      setId,
      seed: "band-stored",
      startsAt: new Date("2099-11-06T00:00:00.000Z"),
      endsAt: new Date("2099-11-07T00:00:00.000Z"),
      status: "ACTIVE",
    }).returning();
    challengeIds.push(challenge.id);

    const fillers = cardIds.filter((id) => id !== wideId && id !== lateId).slice(0, 4);
    const hand = [wideId, ...fillers];
    await db.insert(dailyChallengeCards).values(hand.map((id, index) => ({
      dailyChallengeId: challenge.id,
      position: index + 1,
      cardId: id,
      correctAnswer: id === wideId ? "Wide Plate" : "Cover One",
      choices: id === wideId
        ? ["Wide Plate", "Cover One", "Cover Two", "Cover Three"]
        : ["Cover One", "Cover Two", "Cover Three", "Cover Four"],
      pointValue: 100,
    })));

    const started = Date.now();
    const left = await replaceBlockedDaily5Cards(challenge.id, "2099-11-06");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(left).toBe(0);

    const dealt = await db
      .select({
        cardId: dailyChallengeCards.cardId,
        correctAnswer: dailyChallengeCards.correctAnswer,
        choices: dailyChallengeCards.choices,
      })
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id))
      .orderBy(asc(dailyChallengeCards.position));
    expect(dealt.some((row) => row.cardId === wideId)).toBe(false);
    for (const row of dealt) {
      expect(row.correctAnswer).not.toBe("Wide Plate");
      expect((row.choices as string[]).join(" ")).not.toContain("Wide Plate");
    }
  });

  it("does not serve a cached oversized JPEG, and the SQL filter keeps the reason", async () => {
    await writeFile(path.join(dir, warmOkMarkerFilename(wideId)), "ok\n");
    clearMaskBandCacheForTests();
    const token = maskToken("solo", "band-session", 0, wideId);
    expect(findWarmMaskedPath({
      dir,
      scope: "solo",
      sessionId: "band-session",
      index: 0,
      token,
    })).toBeNull();
    expect(resolveReadyWarmMaskedFile(dir, wideId)).toBeNull();
    expect(existsSync(path.join(dir, warmOkMarkerFilename(wideId)))).toBe(false);
    await expect(getMaskedImagePath(wideId)).resolves.toBeNull();

    await db.update(playableCards).set({ isPlayable: true }).where(eq(playableCards.id, wideId));
    const stillWide = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(and(eq(playableCards.id, wideId), eligibleDealFilter("playable_cards")));
    expect(stillWide).toHaveLength(0);
    const stillKept = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(and(eq(playableCards.id, keptId), eligibleDealFilter("playable_cards")));
    expect(stillKept).toHaveLength(1);
  });
});
