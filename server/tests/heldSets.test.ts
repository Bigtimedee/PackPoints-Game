/**
 * 1990 Hoops stays off deals and public set pages until a PR removes the hold.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  anonDailyRuns,
  dailyChallengeCards,
  dailyChallengeEntries,
  dailyChallenges,
  gameSets,
  playableCards,
} from "@shared/schema";
import { db } from "../db";
import { HELD_SET_IDS, isHeldSet, logHeldSets } from "../config/heldSets";
import { cardBlocklistWhereBody, isBlockedCard } from "../lib/cardBlocklist";
import { storage } from "../storage";
import { handlePublicSetDetail, handlePublicSetsIndex } from "../services/publicSets";
import { handlePublicSetCover } from "../services/setCovers";
import { registerDealableQaRoutes } from "../routes/dealableQa";
import { daily5Service } from "../services/daily5Service";
import { pickDaily5Set } from "../services/daily5SetPick";

const HELD_ID = HELD_SET_IDS[0];
const stamp = randomUUID().slice(0, 8);
const keeperId = randomUUID();
const userSetId = randomUUID();
const date = "2099-09-27";
const TOKEN = `held-qa-${stamp}`;
const previousToken = process.env.COVER_QA_TOKEN;

const cardIds: string[] = [];
let heldExisted = false;
let heldCount = 0;
let challengeId: string | null = null;

function card(setId: string, player: string) {
  const id = randomUUID();
  cardIds.push(id);
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `held:${stamp}:${id}`,
    player,
    set: `Held ${stamp}`,
    description: player,
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: "basketball",
    number: String(cardIds.length),
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "unreviewed",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    lastImageCheck: new Date(),
  };
}

async function clearChallenge(id: string | null) {
  if (!id) return;
  await db.delete(dailyChallengeCards).where(eq(dailyChallengeCards.dailyChallengeId, id)).catch(() => null);
  await db.delete(dailyChallengeEntries).where(eq(dailyChallengeEntries.dailyChallengeId, id)).catch(() => null);
  await db.delete(anonDailyRuns).where(eq(anonDailyRuns.dailyChallengeId, id)).catch(() => null);
  await db.delete(dailyChallenges).where(eq(dailyChallenges.id, id)).catch(() => null);
}

beforeAll(async () => {
  const [prior] = await db.select({ id: dailyChallenges.id }).from(dailyChallenges).where(eq(dailyChallenges.date, date)).limit(1);
  if (prior) await clearChallenge(prior.id);

  const [existing] = await db.select({
    id: gameSets.id,
    cardsImportedCount: gameSets.cardsImportedCount,
  }).from(gameSets).where(eq(gameSets.id, HELD_ID)).limit(1);
  heldExisted = Boolean(existing);
  heldCount = existing?.cardsImportedCount ?? 0;
  if (existing) {
    await db.update(gameSets).set({
      isActive: true,
      isUserCreated: false,
      cardsImportedCount: 2147483646,
    }).where(eq(gameSets.id, HELD_ID));
  } else {
    await db.insert(gameSets).values({
      id: HELD_ID,
      sport: "basketball",
      brand: "Hoops",
      year: 1990,
      setName: "1990 Hoops Basketball",
      isUserCreated: false,
      isActive: true,
      cardsImportedCount: 2147483646,
    });
  }

  await db.insert(gameSets).values([
    {
      id: keeperId,
      sport: "basketball",
      brand: "Topps",
      year: 1987,
      setName: `Held Keeper ${stamp}`,
      isUserCreated: false,
      isActive: true,
      cardsImportedCount: 2147483645,
    },
    {
      id: userSetId,
      sport: "basketball",
      brand: "Topps",
      year: 1991,
      setName: `Held User ${stamp}`,
      isUserCreated: true,
      isActive: true,
      cardsImportedCount: 2147483647,
    },
  ]);

  await db.insert(playableCards).values([
    ...Array.from({ length: 6 }, (_, i) => card(keeperId, `Keeper Player ${i + 1}`)),
    ...Array.from({ length: 6 }, (_, i) => card(HELD_ID, `Hoops Player ${i + 1}`)),
    card(HELD_ID, "Karl Malone / John Stockton"),
    ...Array.from({ length: 6 }, (_, i) => card(userSetId, `User Player ${i + 1}`)),
  ]);
});

afterAll(async () => {
  if (challengeId) await clearChallenge(challengeId);
  const [left] = await db.select({ id: dailyChallenges.id }).from(dailyChallenges).where(eq(dailyChallenges.date, date)).limit(1);
  if (left) await clearChallenge(left.id);
  if (cardIds.length > 0) {
    await db.delete(playableCards).where(inArray(playableCards.id, cardIds)).catch(() => null);
  }
  await db.delete(gameSets).where(inArray(gameSets.id, [keeperId, userSetId])).catch(() => null);
  if (heldExisted) {
    await db.update(gameSets).set({ cardsImportedCount: heldCount }).where(eq(gameSets.id, HELD_ID)).catch(() => null);
  } else {
    await db.delete(playableCards).where(eq(playableCards.gameSetId, HELD_ID)).catch(() => null);
    await db.delete(gameSets).where(eq(gameSets.id, HELD_ID)).catch(() => null);
  }
  if (previousToken === undefined) delete process.env.COVER_QA_TOKEN;
  else process.env.COVER_QA_TOKEN = previousToken;
});

describe("held set blocklist", () => {
  it("blocks every card in the held set and puts that id in the SQL body", () => {
    expect(isHeldSet(HELD_ID)).toBe(true);
    expect(isHeldSet(HELD_ID.toUpperCase())).toBe(true);
    expect(isHeldSet(keeperId)).toBe(false);
    expect(isBlockedCard(HELD_ID, "Michael Jordan")).toBe(true);
    expect(isBlockedCard(HELD_ID, "")).toBe(true);
    expect(isBlockedCard(keeperId, "Michael Jordan")).toBe(false);

    const body = cardBlocklistWhereBody("playable_cards");
    expect(body).toContain(`lower(playable_cards.game_set_id) IN ('${HELD_ID}')`);
    const pc = cardBlocklistWhereBody("pc");
    expect(pc).toContain(`lower(pc.game_set_id) IN ('${HELD_ID}')`);
    expect(cardBlocklistWhereBody("playable_cards", { ignoreHeldSets: true })).not.toContain(HELD_ID);

    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      lines.push(String(line));
    });
    logHeldSets();
    spy.mockRestore();
    expect(lines).toContain("[HeldSets] ids=c2ce5d11");
  });
});

describe("Daily 5 set pick skips a held set", () => {
  it("picks the highest imported integrated set that is not held or user-created", async () => {
    const picked = await pickDaily5Set();
    expect(picked?.id).toBe(keeperId);

    const challenge = await daily5Service.createChallengeForDate(date);
    challengeId = challenge?.id ?? null;
    expect(challenge?.setId).toBe(keeperId);

    const dealt = await db.select({
      cardId: dailyChallengeCards.cardId,
      gameSetId: playableCards.gameSetId,
    })
      .from(dailyChallengeCards)
      .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
      .where(eq(dailyChallengeCards.dailyChallengeId, challenge!.id));
    expect(dealt).toHaveLength(5);
    expect(dealt.every((row) => row.gameSetId === keeperId)).toBe(true);
    expect(dealt.some((row) => isBlockedCard(row.gameSetId, "x"))).toBe(false);
  });
});

describe("public sets hide a held set", () => {
  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => {
    void handlePublicSetCover(req, res);
  });
  app.get("/api/sets/:id", (req, res) => {
    void handlePublicSetDetail(req, res);
  });
  app.get("/api/sets", (req, res) => {
    void handlePublicSetsIndex(req, res);
  });
  const server = createServer(app);
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("omits the held set from the index and returns 404 for id, slug, and covers", async () => {
    const list = await fetch(`${base}/api/sets?limit=50`);
    expect(list.status).toBe(200);
    const body = await list.json() as { sets: Array<{ id: string }> };
    const ids = body.sets.map((set) => set.id);
    expect(ids).not.toContain(HELD_ID);
    expect(ids).toContain(keeperId);
    expect(ids).not.toContain(userSetId);

    const detail = await fetch(`${base}/api/sets/${HELD_ID}`);
    expect(detail.status).toBe(404);
    const slug = await fetch(`${base}/api/sets/1990-hoops-basketball-c2ce5d11`);
    expect(slug.status).toBe(404);
    const keeper = await fetch(`${base}/api/sets/${keeperId}`);
    expect(keeper.status).toBe(200);

    const cover = await fetch(`${base}/api/sets/${HELD_ID}/covers/0`);
    expect(cover.status).toBe(404);
    expect(cover.headers.get("cache-control")).toContain("no-store");
    expect(cover.headers.get("cdn-cache-control")).toBe("no-store");

    await expect(storage.createGameSession(null, "solo", 5, undefined, HELD_ID)).rejects.toThrow("HELD_SET");
    const dealt = await storage.getRandomCardsFromSet(HELD_ID, 5);
    expect(dealt).toHaveLength(0);
  });
});

describe("QA routes flag a held set", () => {
  const app = express();
  registerDealableQaRoutes(app);
  const server = createServer(app);
  let base = "";

  beforeAll(async () => {
    process.env.COVER_QA_TOKEN = TOKEN;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("lists the held set and the cards that would deal if the hold were lifted", async () => {
    const headers = { "X-QA-Token": TOKEN };
    const sets = await fetch(`${base}/api/qa/sets`, { headers });
    expect(sets.status).toBe(200);
    const setsBody = await sets.json() as { sets: Array<{ setId: string; held: boolean; total: number }> };
    const held = setsBody.sets.find((row) => row.setId === HELD_ID);
    const keeper = setsBody.sets.find((row) => row.setId === keeperId);
    expect(held).toMatchObject({ setId: HELD_ID, held: true });
    expect(held?.total).toBeGreaterThan(0);
    expect(keeper).toMatchObject({ setId: keeperId, held: false });
    expect(setsBody.sets.some((row) => row.setId === userSetId)).toBe(false);

    const page = await fetch(`${base}/api/qa/sets/${HELD_ID}/dealable-cards`, { headers });
    expect(page.status).toBe(200);
    const pageBody = await page.json() as { held: boolean; cards: Array<{ cardId: string; player: string | null }> };
    expect(pageBody.held).toBe(true);
    const ours = pageBody.cards.filter((row) => cardIds.includes(row.cardId));
    expect(ours.length).toBeGreaterThan(0);
    expect(pageBody.cards.some((row) => (row.player || "").includes("/"))).toBe(false);
  });
});
