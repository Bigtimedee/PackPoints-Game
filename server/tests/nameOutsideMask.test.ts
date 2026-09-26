/**
 * Surname legible outside the mask band is excluded from deals and covers.
 * The fixture is a synthetic masked JPEG, not a production scan.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import express from "express";
import sharp from "sharp";
import opentype from "opentype.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { addPackptsDays, getDailyStartEnd, getPackptsDayKey } from "@shared/packptsDay";
import {
  anonDailyRuns,
  dailyChallengeCards,
  dailyChallengeEntries,
  dailyChallenges,
  gameSets,
  playableCards,
  users,
} from "@shared/schema";
import { FONT_FILES, resolveFontsDir } from "../contentFactory/fonts";
import { db } from "../db";
import { NAME_VISIBILITY_CHECK_VERSION, NAME_VISIBLE_OUTSIDE_MASK, nameVisibilityPassFilename, tokenMatchesPlayerName, verifyNameVisibleOutsideMask, visiblePlayerNameOutsideMask } from "../masking/nameOutsideMask";
import { runNameVisibilityBackfill } from "../masking/nameVisibilityBackfill";
import { quarantineUncoveredName } from "../masking/maskingService";
import { compareExpectedLeaks, parseExpectedLeaks, reportMaskSweep } from "../masking/maskPlateSweep";
import { readMaskFailureReason, setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { swapFailedCardsOnTodayChallenge } from "../services/daily5FailedCardSwap";
import { eligibleCountsByActiveSet } from "../services/playableSetEligibility";
import { clearReadyCoverIndexForTests, handlePublicSetCover, setCoverEtag } from "../services/setCovers";
import { storage } from "../storage";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";

const TOP_BAND = { xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "blur" as const };

describe("surname matching", () => {
  it("excludes a 4-letter surname run, ignores a 3-letter run, and excludes a full 3-letter surname", () => {
    expect(tokenMatchesPlayerName("Giannis Antetokounmpo", "KOUN")).toBe(true);
    expect(tokenMatchesPlayerName("Giannis Antetokounmpo", "KOU")).toBe(false);
    expect(tokenMatchesPlayerName("Bob Lee", "LEE")).toBe(true);
    expect(tokenMatchesPlayerName("Bob Lee", "LEGEND")).toBe(false);
    expect(tokenMatchesPlayerName("Bob Lee", "LEGENDARY")).toBe(false);
    expect(tokenMatchesPlayerName("Bob Lee", "FEEL")).toBe(false);

    const koun = visiblePlayerNameOutsideMask({
      playerName: "Giannis Antetokounmpo",
      words: [{ text: "KOUN", x: 40, y: 420, w: 80, h: 36 }],
      regions: [TOP_BAND],
      imageWidth: 400,
      imageHeight: 560,
    });
    expect(koun).toBe(true);

    const kou = visiblePlayerNameOutsideMask({
      playerName: "Giannis Antetokounmpo",
      words: [{ text: "KOU", x: 40, y: 420, w: 60, h: 36 }],
      regions: [TOP_BAND],
      imageWidth: 400,
      imageHeight: 560,
    });
    expect(kou).toBe(false);

    const lee = visiblePlayerNameOutsideMask({
      playerName: "Bob Lee",
      words: [{ text: "LEE", x: 40, y: 420, w: 60, h: 36 }],
      regions: [TOP_BAND],
      imageWidth: 400,
      imageHeight: 560,
    });
    expect(lee).toBe(true);
  });

  it("ignores a 4-letter common word when it is the whole token, and still flags a longer token or the whole surname", () => {
    expect(tokenMatchesPlayerName("John Witherspoon", "WITH")).toBe(false);
    expect(tokenMatchesPlayerName("John Witherspoon", "WITHER")).toBe(true);
    expect(tokenMatchesPlayerName("Ted Williams", "WILL")).toBe(false);
    expect(tokenMatchesPlayerName("Ted Williams", "WILLIAMS")).toBe(true);
    expect(tokenMatchesPlayerName("Jack Long", "LONG")).toBe(true);
    expect(tokenMatchesPlayerName("Evan Longoria", "LONG")).toBe(false);
    expect(tokenMatchesPlayerName("Evan Longoria", "LONGORIA")).toBe(true);
    expect(tokenMatchesPlayerName("Magic Johnson", "JOHNSTON")).toBe(true);
    expect(tokenMatchesPlayerName("Magic Johnson", "JOHNSON")).toBe(true);
  });

  it("matches ANTETOKOUNMPO outside the band, including OCR noise, and ignores the same word inside the band", () => {
    expect(tokenMatchesPlayerName("Giannis Antetokounmpo", "ANTETOKOUNMPO")).toBe(true);
    expect(tokenMatchesPlayerName("Giannis Antetokounmpo", "ANTET0KOUNMPO")).toBe(true);
    expect(tokenMatchesPlayerName("Giannis Antetokounmpo", "ANTETOKOUNMPX")).toBe(true);
    expect(tokenMatchesPlayerName("Giannis Antetokounmpo", "ANTETO")).toBe(true);
    expect(tokenMatchesPlayerName("Giannis Antetokounmpo", "KOUNMPO")).toBe(true);
    expect(tokenMatchesPlayerName("Giannis Antetokounmpo", "GIANNIS")).toBe(false);

    const outside = visiblePlayerNameOutsideMask({
      playerName: "Giannis Antetokounmpo",
      words: [{ text: "ANTETOKOUNMPO", x: 40, y: 420, w: 280, h: 48 }],
      regions: [TOP_BAND],
      imageWidth: 400,
      imageHeight: 560,
    });
    expect(outside).toBe(true);

    const covered = visiblePlayerNameOutsideMask({
      playerName: "Giannis Antetokounmpo",
      words: [{ text: "ANTETOKOUNMPO", x: 40, y: 12, w: 280, h: 36 }],
      regions: [TOP_BAND],
      imageWidth: 400,
      imageHeight: 560,
    });
    expect(covered).toBe(false);

    const split = visiblePlayerNameOutsideMask({
      playerName: "Giannis Antetokounmpo",
      words: [
        { text: "ANTET", x: 40, y: 420, w: 120, h: 40 },
        { text: "OKOUNMPO", x: 170, y: 420, w: 180, h: 40 },
      ],
      regions: [TOP_BAND],
      imageWidth: 400,
      imageHeight: 560,
    });
    expect(split).toBe(true);
  });

  it("counts name_visible_outside_mask in the sweep report", () => {
    const [report] = reportMaskSweep([{
      setId: "set-1",
      setName: "2024 Basketball",
      cards: [
        { id: "a", width: 750, height: 1050, pass: false, reason: NAME_VISIBLE_OUTSIDE_MASK },
        { id: "b", width: 750, height: 1050, pass: true, reason: null },
        { id: "c", width: 750, height: 1050, pass: false, reason: "name_text_visible" },
      ],
    }]);
    expect(report.fail).toBe(2);
    expect(report.nameVisibleOutsideMask).toBe(1);
    expect(report.pass).toBe(1);
  });

  it("parses a cardId and leak list and compares it to sweep reasons", () => {
    const pairs = parseExpectedLeaks(JSON.stringify([
      { cardId: "leaked", leak: true },
      { cardId: "quiet", leak: false },
      { cardId: "plate", leak: true },
      { cardId: "missing", leak: false },
    ]));
    const rows = compareExpectedLeaks(pairs, [
      { id: "leaked", reason: NAME_VISIBLE_OUTSIDE_MASK },
      { id: "quiet", reason: null },
      { id: "plate", reason: "name_text_visible" },
    ]);
    expect(rows.map((row) => [row.cardId, row.match, row.reason])).toEqual([
      ["leaked", true, NAME_VISIBLE_OUTSIDE_MASK],
      ["quiet", true, null],
      ["plate", false, "name_text_visible"],
      ["missing", false, "card_not_found"],
    ]);
    expect(() => parseExpectedLeaks(`{"cardId":"x","leak":true}`)).toThrow(/JSON array/);
    expect(() => parseExpectedLeaks(`[{"cardId":"x","leak":"yes"}]`)).toThrow(/true or false/);
  });
});

async function surnameOnCard(surname: string): Promise<Buffer> {
  const width = 700;
  const height = 980;
  const font = opentype.parse(readFileSync(path.join(resolveFontsDir(), FONT_FILES.bold)));
  const fontSize = 72;
  const advances = [...surname].map((ch) => font.getAdvanceWidth(ch, fontSize));
  const textWidth = advances.reduce((sum, n) => sum + n, 0);
  let x = Math.max(12, (width - textWidth) / 2);
  const y = Math.round(height * 0.52);
  let d = "";
  surname.split("").forEach((ch, index) => {
    d += font.getPath(ch, x, y, fontSize).toPathData({ decimalPlaces: 2, flipY: false });
    x += advances[index];
  });
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#f4f0e6"/>
  <rect width="100%" height="18%" fill="#0a0e16"/>
  <path d="${d}" fill="#111111"/>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

describe("visible surname outside the mask", () => {
  const stamp = randomUUID().slice(0, 8);
  const setId = randomUUID();
  const leakedId = randomUUID();
  const nextId = randomUUID();
  const thirdId = randomUUID();
  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => {
    void handlePublicSetCover(req, res);
  });
  const server = createServer(app);
  let base = "";
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-name-out-"));
    setMaskReadySidecarDirForTests(dir);
    await db.insert(gameSets).values({
      id: setId,
      sport: "basketball",
      brand: "Panini",
      year: 2024,
      setName: `2024 Basketball ${stamp}`,
      isUserCreated: false,
      isActive: true,
    });
    const card = (id: string, player: string, createdAt: string, playable = true) => ({
      id,
      gameSetId: setId,
      cardhedgeCardId: `outside:${id}`,
      player,
      set: `2024 Basketball ${stamp}`,
      description: player,
      imageUrl: `https://images.example.com/${id}.jpg`,
      category: "basketball",
      isPlayable: playable,
      contentVerified: true as boolean | null,
      imageReviewStatus: "unreviewed",
      quarantineStatus: "OK",
      proposedUnplayable: false,
      blockedReason: null as string | null,
      lastImageCheck: new Date(),
      createdAt: new Date(createdAt),
    });
    await db.insert(playableCards).values([
      card(leakedId, "Giannis Antetokounmpo", "2020-01-01T00:00:00.000Z"),
      card(nextId, "Jrue Holiday", "2020-01-02T00:00:00.000Z"),
      card(thirdId, "Khris Middleton", "2020-01-03T00:00:00.000Z"),
    ]);
    await writeFile(path.join(dir, warmOkMarkerFilename(leakedId)), "ok\n");
    await writeFile(path.join(dir, `${leakedId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from("leaked-jpeg"));
    await writeFile(path.join(dir, warmOkMarkerFilename(nextId)), "ok\n");
    await writeFile(path.join(dir, `${nextId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from("next-jpeg"));
    await writeFile(path.join(dir, warmOkMarkerFilename(thirdId)), "ok\n");
    await writeFile(path.join(dir, `${thirdId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from("third-jpeg"));
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
    await db.delete(playableCards).where(inArray(playableCards.id, [leakedId, nextId, thirdId])).catch(() => null);
    await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  it("excludes a card whose surname is drawn outside the mask band, and the cover falls through", async () => {
    const jpeg = await surnameOnCard("ANTETOKOUNMPO");
    const verdict = await verifyNameVisibleOutsideMask({
      buffer: jpeg,
      playerName: "Giannis Antetokounmpo",
      regions: [TOP_BAND],
    });
    expect(verdict.skipped).toBe(false);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe(NAME_VISIBLE_OUTSIDE_MASK);

    await quarantineUncoveredName(leakedId, verdict.reason || NAME_VISIBLE_OUTSIDE_MASK);
    clearReadyCoverIndexForTests();
    expect(readMaskFailureReason(leakedId, dir)).toBe(NAME_VISIBLE_OUTSIDE_MASK);

    const [row] = await db.select({
      isPlayable: playableCards.isPlayable,
      blockedReason: playableCards.blockedReason,
    }).from(playableCards).where(eq(playableCards.id, leakedId));
    expect(row?.isPlayable).toBe(false);
    expect(row?.blockedReason).toBe(NAME_VISIBLE_OUTSIDE_MASK);

    const dealt = await storage.getRandomCardsFromSet(setId, 10);
    const dealtIds = dealt.map((card) => card.id);
    expect(dealtIds).not.toContain(leakedId);
    expect(dealtIds).toContain(nextId);

    const counts = await eligibleCountsByActiveSet();
    const mine = counts.find((entry) => entry.setId === setId);
    expect(mine?.count).toBe(2);
    expect(JSON.stringify(counts)).not.toContain(leakedId);
    expect(JSON.stringify(counts)).not.toContain("Antetokounmpo");

    const slot0 = await fetch(`${base}/api/sets/${setId}/covers/0`);
    expect(slot0.status).toBe(200);
    expect(slot0.headers.get("etag")).toBe(setCoverEtag(setId, 0, nextId));
    expect(slot0.headers.get("etag")).not.toContain(nextId);
    expect(slot0.headers.get("etag")).not.toContain(leakedId);
    expect(Buffer.from(await slot0.arrayBuffer()).toString()).toBe("next-jpeg");

    const slot1 = await fetch(`${base}/api/sets/${setId}/covers/1`);
    expect(slot1.status).toBe(200);
    expect(slot1.headers.get("etag")).toBe(setCoverEtag(setId, 1, thirdId));
    const body = await slot1.text();
    expect(body).not.toContain(leakedId);
    expect(body).not.toContain("Antetokounmpo");
  }, 60_000);
});

describe("name visibility backfill", () => {
  it("flags a body surname and does not flag a short surname in other words", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-name-backfill-"));
    const jpeg = await sharp({
      create: { width: 80, height: 80, channels: 3, background: { r: 240, g: 240, b: 240 } },
    }).jpeg().toBuffer();
    const leaked = "card-leaked";
    const quiet = "card-quiet";
    await writeFile(path.join(dir, `${leaked}_${CURRENT_MASK_VERSION}.jpg`), jpeg);
    await writeFile(path.join(dir, `${quiet}_${CURRENT_MASK_VERSION}.jpg`), jpeg);
    const flagged: string[] = [];
    const counts = await runNameVisibilityBackfill({
      dir,
      pauseMs: 0,
      sleep: async () => {},
      files: [
        { cardId: leaked, filename: `${leaked}_${CURRENT_MASK_VERSION}.jpg` },
        { cardId: quiet, filename: `${quiet}_${CURRENT_MASK_VERSION}.jpg` },
      ],
      loadPlayers: async () => new Map([
        [leaked, "Giannis Antetokounmpo"],
        [quiet, "Bob Lee"],
      ]),
      recognize: async (_buffer, _width) => ({
        timedOut: false,
        ms: 1,
        words: [
          { text: "ANTETOKOUNMPO", x: 8, y: 40, w: 60, h: 16 },
          { text: "LEGEND", x: 8, y: 40, w: 40, h: 16 },
        ],
      }),
      onVisible: async (cardId) => {
        flagged.push(cardId);
      },
    });
    expect(flagged).toEqual([leaked]);
    expect(counts.failed).toBe(1);
    expect(counts.passed).toBe(1);
    await expect(readFile(path.join(dir, nameVisibilityPassFilename(quiet)), "utf8")).resolves.toContain(NAME_VISIBILITY_CHECK_VERSION);
    await expect(readFile(path.join(dir, nameVisibilityPassFilename(leaked)), "utf8")).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("today's Daily 5 name leak", () => {
  const stamp = randomUUID().slice(0, 8);
  const setId = randomUUID();
  const badId = randomUUID();
  const spareId = randomUUID();
  const fillerIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const today = getPackptsDayKey();
  const yesterday = addPackptsDays(today, -1);
  const todayChallenge = randomUUID();
  const yesterdayChallenge = randomUUID();
  const userId = randomUUID();
  const window = getDailyStartEnd(today);
  const priorWindow = getDailyStartEnd(yesterday);

  const card = (id: string, player: string, playable: boolean, reason: string | null) => ({
    id,
    gameSetId: setId,
    cardhedgeCardId: `d5:${id}`,
    player,
    set: `2024 Basketball ${stamp}`,
    description: player,
    imageUrl: `https://images.example.com/${id}.jpg`,
    category: "basketball",
    isPlayable: playable,
    contentVerified: true as boolean | null,
    imageReviewStatus: "unreviewed",
    quarantineStatus: playable ? "OK" : "QUARANTINED_ADMIN_REVIEW",
    proposedUnplayable: false,
    blockedReason: reason,
    lastImageCheck: new Date(),
    createdAt: new Date("2020-06-01T00:00:00.000Z"),
  });

  beforeAll(async () => {
    await db.insert(gameSets).values({
      id: setId,
      sport: "basketball",
      brand: "Panini",
      year: 2024,
      setName: `2024 Basketball Daily ${stamp}`,
      isUserCreated: false,
      isActive: true,
    });
    await db.insert(playableCards).values([
      card(badId, "Giannis Antetokounmpo", false, NAME_VISIBLE_OUTSIDE_MASK),
      card(fillerIds[0], "Jrue Holiday", true, null),
      card(fillerIds[1], "Khris Middleton", true, null),
      card(fillerIds[2], "Brook Lopez", true, null),
      card(fillerIds[3], "Bobby Portis", true, null),
      { ...card(spareId, "Damian Lillard", true, null), createdAt: new Date("2021-01-01T00:00:00.000Z") },
    ]);
    await db.insert(users).values({
      id: userId,
      username: `d5leak_${stamp}`,
      email: `${userId}@test.invalid`,
    });
    await db.insert(dailyChallenges).values([
      {
        id: todayChallenge,
        date: today,
        mode: "DAILY5",
        setId,
        seed: `seed-${stamp}`,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        status: "ACTIVE",
      },
      {
        id: yesterdayChallenge,
        date: yesterday,
        mode: "DAILY5",
        setId,
        seed: `seed-prior-${stamp}`,
        startsAt: priorWindow.startsAt,
        endsAt: priorWindow.endsAt,
        status: "CLOSED",
      },
    ]);
    const row = (challengeId: string, position: number, cardId: string, player: string) => ({
      dailyChallengeId: challengeId,
      position,
      cardId,
      correctAnswer: player,
      choices: [player, "Other One", "Other Two", "Other Three"],
      pointValue: 100,
    });
    await db.insert(dailyChallengeCards).values([
      row(todayChallenge, 1, badId, "Giannis Antetokounmpo"),
      row(todayChallenge, 2, fillerIds[0], "Jrue Holiday"),
      row(todayChallenge, 3, fillerIds[1], "Khris Middleton"),
      row(todayChallenge, 4, fillerIds[2], "Brook Lopez"),
      row(todayChallenge, 5, fillerIds[3], "Bobby Portis"),
      row(yesterdayChallenge, 1, badId, "Giannis Antetokounmpo"),
      row(yesterdayChallenge, 2, fillerIds[0], "Jrue Holiday"),
      row(yesterdayChallenge, 3, fillerIds[1], "Khris Middleton"),
      row(yesterdayChallenge, 4, fillerIds[2], "Brook Lopez"),
      row(yesterdayChallenge, 5, fillerIds[3], "Bobby Portis"),
    ]);
  });

  afterAll(async () => {
    await db.delete(dailyChallengeEntries).where(eq(dailyChallengeEntries.userId, userId)).catch(() => null);
    await db.delete(anonDailyRuns).where(eq(anonDailyRuns.dailyChallengeId, todayChallenge)).catch(() => null);
    await db.delete(dailyChallengeCards).where(inArray(dailyChallengeCards.dailyChallengeId, [todayChallenge, yesterdayChallenge])).catch(() => null);
    await db.delete(dailyChallenges).where(inArray(dailyChallenges.id, [todayChallenge, yesterdayChallenge])).catch(() => null);
    await db.delete(users).where(eq(users.id, userId)).catch(() => null);
    await db.delete(playableCards).where(eq(playableCards.gameSetId, setId)).catch(() => null);
    await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
  });

  it("swaps an unstarted today card, leaves a started card, and does not rewrite yesterday", async () => {
    const swapped = await swapFailedCardsOnTodayChallenge();
    expect(swapped.swapped).toBe(1);
    expect(swapped.held).toBe(0);
    const [todayPos] = await db.select().from(dailyChallengeCards).where(and(
      eq(dailyChallengeCards.dailyChallengeId, todayChallenge),
      eq(dailyChallengeCards.position, 1),
    ));
    expect(todayPos?.cardId).toBe(spareId);
    expect(todayPos?.correctAnswer).toBe("Damian Lillard");
    expect(todayPos?.correctAnswer).not.toBe("Giannis Antetokounmpo");

    const [prior] = await db.select().from(dailyChallengeCards).where(and(
      eq(dailyChallengeCards.dailyChallengeId, yesterdayChallenge),
      eq(dailyChallengeCards.position, 1),
    ));
    expect(prior?.cardId).toBe(badId);
    expect(prior?.correctAnswer).toBe("Giannis Antetokounmpo");

    await db.update(dailyChallengeCards).set({
      cardId: badId,
      correctAnswer: "Giannis Antetokounmpo",
      choices: ["Giannis Antetokounmpo", "Other One", "Other Two", "Other Three"],
    }).where(eq(dailyChallengeCards.id, todayPos!.id));
    await db.insert(dailyChallengeEntries).values({
      dailyChallengeId: todayChallenge,
      userId,
      score: 0,
      correctCount: 0,
      answers: [],
    });

    const held = await swapFailedCardsOnTodayChallenge();
    expect(held.swapped).toBe(0);
    expect(held.held).toBe(1);
    const [still] = await db.select().from(dailyChallengeCards).where(and(
      eq(dailyChallengeCards.dailyChallengeId, todayChallenge),
      eq(dailyChallengeCards.position, 1),
    ));
    expect(still?.cardId).toBe(badId);
    const [priorStill] = await db.select().from(dailyChallengeCards).where(and(
      eq(dailyChallengeCards.dailyChallengeId, yesterdayChallenge),
      eq(dailyChallengeCards.position, 1),
    ));
    expect(priorStill?.cardId).toBe(badId);
  });
});
