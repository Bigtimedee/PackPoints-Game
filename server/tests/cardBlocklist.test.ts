/**
 * Hardcoded card blocklist: blocked players stay out of solo deals, Daily 5
 * deals, set covers, and replacement candidates. A stored Daily 5 card is swapped
 * before it is served.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray, like } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { dailyChallengeCards, dailyChallenges, gameSessionsTable, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { daily5Service } from "../services/daily5Service";
import { setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { clearReadyCoverIndexForTests, handlePublicSetCover, readyMaskedCoverUrls } from "../services/setCovers";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";
import { isBlockedCard, replaceBlockedDaily5Cards } from "../lib/cardBlocklist";

const stamp = randomUUID().slice(0, 8);
const prefix = `blocklist:${stamp}:`;
const basketballSetId = "229f0379-1111-4111-8111-111111111111";
const footballSetId = "91cfdf3f-a620-4e73-adc8-22b8df221716";
const fleerSetId = "aea515e2-2222-4222-8222-222222222222";
const fleerOnlySetId = "aea515e2-3333-4333-8333-333333333333";
const coverPlayers = [
  "Art Shell",
  "Kevin Johnson",
  "Joe Montana",
  "Walter Payton",
  "Jerry Rice",
  "Barry Sanders",
  "Emmitt Smith",
  "Marcus Allen",
];

const cardIds: string[] = [];
const challengeIds: string[] = [];
let sessionId = "";
let dir = "";
let createdSets: string[] = [];

function card(setId: string, player: string, createdAt: string, sport: string) {
  const id = randomUUID();
  cardIds.push(id);
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `${prefix}${id}`,
    player,
    set: `Blocklist ${stamp}`,
    description: player,
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: sport,
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "approved",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    lastImageCheck: new Date(),
    createdAt: new Date(createdAt),
  };
}

async function ensureSet(id: string, sport: string, year: number, setName: string) {
  const [existing] = await db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.id, id)).limit(1);
  if (existing) return;
  await db.insert(gameSets).values({
    id,
    sport,
    brand: "Topps",
    year,
    setName,
    isUserCreated: true,
    isActive: true,
  });
  createdSets.push(id);
}

describe("isBlockedCard", () => {
  it("matches the four leaks and leaves other players", () => {
    expect(isBlockedCard("229f0379-1111-4111-8111-111111111111", "Giannis Antetokounmpo")).toBe(true);
    expect(isBlockedCard("229f0379-1111-4111-8111-111111111111", "ANTETOKOUNMPO")).toBe(true);
    expect(isBlockedCard(fleerSetId, "Giannis Antetokounmpo")).toBe(false);

    expect(isBlockedCard(footballSetId, "Donnie Shell")).toBe(true);
    expect(isBlockedCard(footballSetId, "Shell, Donnie")).toBe(true);
    expect(isBlockedCard(footballSetId, "donnie l. shell")).toBe(true);
    expect(isBlockedCard(footballSetId, "Art Shell")).toBe(false);
    expect(isBlockedCard(basketballSetId, "Donnie Shell")).toBe(false);

    expect(isBlockedCard(footballSetId, "Mark Duper")).toBe(true);
    expect(isBlockedCard(footballSetId, "MARK DUPER")).toBe(true);
    expect(isBlockedCard(footballSetId, "mark duper")).toBe(true);
    expect(isBlockedCard(basketballSetId, "Mark Duper")).toBe(false);
    expect(isBlockedCard(fleerSetId, "Mark Duper")).toBe(false);

    expect(isBlockedCard(fleerSetId, "Kevin Johnson")).toBe(true);
    expect(isBlockedCard(fleerOnlySetId, "KEVIN JOHNSON")).toBe(true);
    expect(isBlockedCard(footballSetId, "Kevin Johnson")).toBe(false);
  });
});

describe("blocked cards stay out of deals, covers, and replacements", () => {
  const bytes = new Map<string, Buffer>();
  let footballCards: ReturnType<typeof card>[] = [];
  let donnieId = "";
  let fleerOnlyId = "";
  let artBytes = Buffer.alloc(0);
  let lastBytes = Buffer.alloc(0);

  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => {
    void handlePublicSetCover(req, res);
  });
  const server = createServer(app);
  let base = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-blocklist-"));
    setMaskReadySidecarDirForTests(dir);
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await ensureSet(basketballSetId, "basketball", 2024, `2024 Basketball ${stamp}`);
    await ensureSet(footballSetId, "football", 1987, `1987 Topps Football ${stamp}`);
    await ensureSet(fleerSetId, "basketball", 1989, `1989 Fleer ${stamp}`);
    await ensureSet(fleerOnlySetId, "basketball", 1989, `1989 Fleer only ${stamp}`);

    const basketball = [
      card(basketballSetId, "Giannis Antetokounmpo", "2020-01-01T00:00:00.000Z", "basketball"),
      ...Array.from({ length: 6 }, (_, i) => card(basketballSetId, `Basket Player ${i + 1}`, `2020-02-0${i + 1}T00:00:00.000Z`, "basketball")),
    ];
    const donnie = card(footballSetId, "Donnie Shell", "2020-01-01T00:00:00.000Z", "football");
    const shellDonnie = card(footballSetId, "Shell, Donnie", "2020-01-02T00:00:00.000Z", "football");
    donnieId = donnie.id;
    footballCards = [
      donnie,
      shellDonnie,
      ...coverPlayers.map((player, i) => card(footballSetId, player, `2020-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, "football")),
    ];
    const fleer = [
      card(fleerSetId, "Kevin Johnson", "2020-01-01T00:00:00.000Z", "basketball"),
      card(fleerSetId, "Giannis Antetokounmpo", "2020-01-02T00:00:00.000Z", "basketball"),
      ...Array.from({ length: 6 }, (_, i) => card(fleerSetId, `Fleer Player ${i + 1}`, `2020-04-0${i + 1}T00:00:00.000Z`, "basketball")),
    ];
    const fleerOnly = [card(fleerOnlySetId, "Kevin Johnson", "2020-01-01T00:00:00.000Z", "basketball")];
    fleerOnlyId = fleerOnly[0].id;

    for (const row of footballCards) {
      const body = Buffer.from(`masked-${row.player}-${row.id}`);
      bytes.set(row.id, body);
      await writeFile(path.join(dir, warmOkMarkerFilename(row.id)), "ok\n");
      await writeFile(path.join(dir, `${row.id}_${CURRENT_MASK_VERSION}.jpg`), body);
    }
    artBytes = bytes.get(footballCards[2].id)!;
    lastBytes = bytes.get(footballCards[footballCards.length - 1].id)!;
    clearReadyCoverIndexForTests();

    await db.insert(playableCards).values([...basketball, ...footballCards, ...fleer, ...fleerOnly]);
  });

  afterAll(async () => {
    setMaskReadySidecarDirForTests(null);
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
    if (createdSets.length > 0) await db.delete(gameSets).where(inArray(gameSets.id, createdSets)).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  it("keeps blocked players out of solo deals and still deals the rest", async () => {
    const basketball = await storage.getRandomCardsFromSet(basketballSetId, 20);
    expect(basketball.some((row) => isBlockedCard(row.gameSetId, row.player))).toBe(false);
    expect(basketball.some((row) => row.player === "Giannis Antetokounmpo")).toBe(false);
    expect(basketball.length).toBe(6);

    const football = await storage.getRandomCardsFromSet(footballSetId, 20);
    expect(football.some((row) => isBlockedCard(row.gameSetId, row.player))).toBe(false);
    expect(football.map((row) => row.player).sort()).toEqual([...coverPlayers].sort());

    const fleer = await storage.getRandomCardsFromSet(fleerSetId, 20);
    expect(fleer.some((row) => row.player === "Kevin Johnson")).toBe(false);
    expect(fleer.some((row) => row.player === "Giannis Antetokounmpo")).toBe(true);
    expect(fleer.length).toBe(7);
  });

  it("keeps blocked players out of new Daily 5 deals", async () => {
    const deals: Array<[string, string, string]> = [
      ["2099-11-01", basketballSetId, "Giannis Antetokounmpo"],
      ["2099-11-02", footballSetId, "Donnie Shell"],
      ["2099-11-03", fleerSetId, "Kevin Johnson"],
    ];
    for (const [date, setId, blockedName] of deals) {
      const [challenge] = await db.insert(dailyChallenges).values({
        date,
        mode: "DAILY5",
        setId,
        seed: `blocklist-${date}`,
        startsAt: new Date(`${date}T00:00:00.000Z`),
        endsAt: new Date(`${date}T23:00:00.000Z`),
        status: "SCHEDULED",
      }).returning();
      challengeIds.push(challenge.id);
      await daily5Service.selectCardsForChallenge(challenge, setId, challenge.seed);
      const dealt = await db
        .select({ player: playableCards.player, gameSetId: playableCards.gameSetId, correctAnswer: dailyChallengeCards.correctAnswer })
        .from(dailyChallengeCards)
        .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
        .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id));
      expect(dealt.length).toBe(5);
      expect(dealt.some((row) => isBlockedCard(row.gameSetId, row.player))).toBe(false);
      expect(dealt.some((row) => row.correctAnswer.toLowerCase().includes(blockedName.toLowerCase()))).toBe(false);
    }
  });

  it("falls through a blocked cover and still fills 8 distinct players", async () => {
    const urls = await readyMaskedCoverUrls([footballSetId]);
    expect(urls.get(footballSetId)).toHaveLength(8);

    const slot0 = await fetch(`${base}/api/sets/${footballSetId}/covers/0`);
    expect(slot0.status).toBe(200);
    expect(Buffer.from(await slot0.arrayBuffer())).toEqual(artBytes);
    expect(slot0.headers.get("x-card-id")).toBeNull();

    const slot7 = await fetch(`${base}/api/sets/${footballSetId}/covers/7`);
    expect(slot7.status).toBe(200);
    expect(Buffer.from(await slot7.arrayBuffer())).toEqual(lastBytes);
    expect(donnieId.length).toBeGreaterThan(0);
  });

  it("skips blocked cards when choosing a replacement", async () => {
    sessionId = randomUUID();
    const failedId = footballCards[0].id;
    await db.insert(gameSessionsTable).values({
      id: sessionId,
      mode: "solo",
      questions: [{
        card: {
          id: failedId,
          playableCardId: failedId,
          gameSetId: footballSetId,
          playerName: "Donnie Shell",
          team: "",
          year: 1987,
          cardNumber: "1",
          imageUrl: "https://packpts.com/cards/failed.jpg",
          popularity: 50,
          imageVerified: true,
          setName: "1987 Topps Football",
          position: "",
        },
        options: ["Donnie Shell", "Art Shell", "Joe Montana", "Jerry Rice"],
        correctAnswer: "Donnie Shell",
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

    for (let i = 0; i < 8; i++) {
      const result = await storage.getReplacementCardForSession(sessionId, failedId, []);
      expect(result).toBeTruthy();
      expect(isBlockedCard(footballSetId, result!.question.correctAnswer)).toBe(false);
      expect(result!.question.correctAnswer.toLowerCase()).not.toContain("donnie");
      expect(result!.question.card.id).not.toBe(failedId);
    }
  });

  it("swaps a stored Daily 5 card instead of serving the blocked answer", async () => {
    const [challenge] = await db.insert(dailyChallenges).values({
      date: "2099-11-04",
      mode: "DAILY5",
      setId: footballSetId,
      seed: "blocklist-stored",
      startsAt: new Date("2099-11-04T00:00:00.000Z"),
      endsAt: new Date("2099-11-05T00:00:00.000Z"),
      status: "ACTIVE",
    }).returning();
    challengeIds.push(challenge.id);

    const hand = footballCards.slice(0, 5);
    await db.insert(dailyChallengeCards).values(hand.map((row, index) => ({
      dailyChallengeId: challenge.id,
      position: index + 1,
      cardId: row.id,
      correctAnswer: row.player,
      choices: [row.player, "Other One", "Other Two", "Other Three"],
      pointValue: 100,
    })));

    const untouched = await replaceBlockedDaily5Cards(challenge.id, "2099-01-01");
    expect(untouched).toBe(0);
    const [before] = await db
      .select({ cardId: dailyChallengeCards.cardId, correctAnswer: dailyChallengeCards.correctAnswer })
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id))
      .orderBy(asc(dailyChallengeCards.position));
    expect(before.cardId).toBe(donnieId);

    const left = await replaceBlockedDaily5Cards(challenge.id, "2099-11-04");
    expect(left).toBe(0);
    const dealt = await db
      .select({
        cardId: dailyChallengeCards.cardId,
        correctAnswer: dailyChallengeCards.correctAnswer,
        choices: dailyChallengeCards.choices,
        player: playableCards.player,
        gameSetId: playableCards.gameSetId,
      })
      .from(dailyChallengeCards)
      .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
      .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id));
    expect(dealt.some((row) => isBlockedCard(row.gameSetId, row.player))).toBe(false);
    expect(dealt.some((row) => row.cardId === donnieId)).toBe(false);
    for (const row of dealt) {
      expect(row.correctAnswer.toLowerCase()).not.toContain("donnie");
      expect((row.choices as string[]).join(" ").toLowerCase()).not.toContain("donnie");
    }

    const again = await replaceBlockedDaily5Cards(challenge.id, "2099-11-04");
    expect(again).toBe(0);
  });

  it("does not hang or rewrite a Daily 5 hand that has no eligible replacement", async () => {
    const [challenge] = await db.insert(dailyChallenges).values({
      date: "2099-11-05",
      mode: "DAILY5",
      setId: fleerOnlySetId,
      seed: "blocklist-empty",
      startsAt: new Date("2099-11-05T00:00:00.000Z"),
      endsAt: new Date("2099-11-06T00:00:00.000Z"),
      status: "ACTIVE",
    }).returning();
    challengeIds.push(challenge.id);
    const only = fleerOnlyId;
    await db.insert(dailyChallengeCards).values({
      dailyChallengeId: challenge.id,
      position: 1,
      cardId: only,
      correctAnswer: "Kevin Johnson",
      choices: ["Kevin Johnson", "A", "B", "C"],
      pointValue: 100,
    });

    const started = Date.now();
    const left = await replaceBlockedDaily5Cards(challenge.id, "2099-11-05");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(left).toBe(1);
    const [row] = await db
      .select({ cardId: dailyChallengeCards.cardId, correctAnswer: dailyChallengeCards.correctAnswer })
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id));
    expect(row.cardId).toBe(only);
    expect(row.correctAnswer).toBe("Kevin Johnson");
  });
});
