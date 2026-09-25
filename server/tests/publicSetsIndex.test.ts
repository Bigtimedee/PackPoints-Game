/**
 * GET /api/sets lists integrated sets the game can deal.
 * UGC, inactive, thin, and ineligible shelves stay off the index.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { gameSessionsTable, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { userSetCardCountSql } from "../routes/userSetCounts";
import { handlePublicSetsIndex } from "../services/publicSets";
import { PUBLIC_SET_MIN_ELIGIBLE_CARDS } from "../services/playableSetEligibility";

const stamp = randomUUID().slice(0, 8);
const integratedName = `P0 Integrated ${stamp}`;
const dupeName = `P0 Dupe ${stamp}`;

const integratedId = randomUUID();
const ugcId = randomUUID();
const inactiveId = randomUUID();
const thinId = randomUUID();
const ineligibleId = randomUUID();
const dupeLowId = randomUUID();
const dupeHighId = randomUUID();
const otherYearId = randomUUID();
const setIds = [integratedId, ugcId, inactiveId, thinId, ineligibleId, dupeLowId, dupeHighId, otherYearId];

const GOOD = 6;
let sessionId: string | null = null;

function goodCard(setId: string, player: string, imageUrl?: string) {
  return {
    gameSetId: setId,
    cardhedgeCardId: `p0sets:${randomUUID()}`,
    player,
    set: integratedName,
    description: `${integratedName} ${player}`,
    imageUrl: imageUrl ?? `https://packpts.com/cards/${randomUUID()}.jpg`,
    category: "baseball",
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "unreviewed",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    lastImageCheck: new Date(),
  };
}

function manyGood(setId: string, n: number, sport = "baseball") {
  return Array.from({ length: n }, (_, i) => ({
    ...goodCard(setId, `Player ${setId.slice(0, 4)} ${i + 1}`),
    category: sport,
  }));
}

beforeAll(async () => {
  await db.insert(gameSets).values([
    { id: integratedId, sport: "baseball", brand: "Topps", year: 1987, setName: integratedName, isUserCreated: false, isActive: true },
    { id: ugcId, sport: "baseball", brand: "Topps", year: 1987, setName: `P0 UGC ${stamp}`, isUserCreated: true, isActive: true },
    { id: inactiveId, sport: "baseball", brand: "Topps", year: 1988, setName: `P0 Inactive ${stamp}`, isUserCreated: false, isActive: false },
    { id: thinId, sport: "baseball", brand: "Topps", year: 1986, setName: `P0 Thin ${stamp}`, isUserCreated: false, isActive: true },
    { id: ineligibleId, sport: "baseball", brand: "Topps", year: 1985, setName: `P0 Bad ${stamp}`, isUserCreated: false, isActive: true },
    { id: dupeLowId, sport: "baseball", brand: "Topps", year: 1991, setName: dupeName, isUserCreated: false, isActive: true },
    { id: dupeHighId, sport: "baseball", brand: "Topps", year: 1991, setName: dupeName, isUserCreated: false, isActive: true },
    { id: otherYearId, sport: "baseball", brand: "Topps", year: 1992, setName: dupeName, isUserCreated: false, isActive: true },
  ]);

  const fan = "https://packpts.com/assets/maker-set-1080.png";
  await db.insert(playableCards).values([
    ...Array.from({ length: GOOD - 1 }, (_, i) => goodCard(integratedId, `Ken Griffey ${i + 1}`)),
    goodCard(integratedId, "Nolan Ryan", fan),
    { ...goodCard(integratedId, "Wrong Sport"), category: "football" },
    { ...goodCard(integratedId, "Http Image"), imageUrl: "http://packpts.com/cards/plain.jpg" },
    { ...goodCard(integratedId, "Not Playable"), isPlayable: false },
    { ...goodCard(integratedId, "Rejected Scan"), imageReviewStatus: "rejected" },
    { ...goodCard(integratedId, "Silhouette Card"), imageUrl: "https://s3.amazonaws.com/appforest_uf/05-Baseball-silhouette.jpg" },
    { ...goodCard(integratedId, "Quarantine Card"), quarantineStatus: "QUARANTINED_ADMIN_REVIEW", proposedUnplayable: true },
    { ...goodCard(integratedId, "Unverified Fail"), contentVerified: false },
    { ...goodCard(integratedId, ""), player: "" },
    ...manyGood(ugcId, 6),
    ...manyGood(inactiveId, 6),
    ...manyGood(thinId, PUBLIC_SET_MIN_ELIGIBLE_CARDS - 1),
    ...Array.from({ length: 3 }, () => ({ ...goodCard(ineligibleId, "Checklist Card"), isPlayable: false })),
    ...manyGood(dupeLowId, 6),
    ...manyGood(dupeHighId, 9),
    ...manyGood(otherYearId, 5),
  ]);
});

afterAll(async () => {
  if (sessionId) {
    await db.delete(gameSessionsTable).where(eq(gameSessionsTable.id, sessionId)).catch(() => null);
  }
  await db.delete(playableCards).where(inArray(playableCards.gameSetId, setIds)).catch(() => null);
  await db.delete(gameSets).where(inArray(gameSets.id, setIds)).catch(() => null);
});

describe("GET /api/sets integrated shelf", () => {
  const app = express();
  app.get("/api/sets", (req, res) => {
    void handlePublicSetsIndex(req, res);
  });
  const server = createServer(app);
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns integrated eligible sets and drops UGC, inactive, thin, and ineligible shelves", async () => {
    const res = await fetch(`${base}/api/sets?limit=50`);
    expect(res.status).toBe(200);
    const body = await res.json() as { sets: Array<Record<string, unknown>> };
    const ids = body.sets.map((set) => String(set.id));

    expect(ids).toContain(integratedId);
    expect(ids).toContain(dupeHighId);
    expect(ids).toContain(otherYearId);
    expect(ids).not.toContain(ugcId);
    expect(ids).not.toContain(inactiveId);
    expect(ids).not.toContain(thinId);
    expect(ids).not.toContain(ineligibleId);
    expect(ids).not.toContain(dupeLowId);

    const row = body.sets.find((set) => set.id === integratedId);
    expect(row).toBeTruthy();
    expect(Number(row?.cardCount)).toBe(GOOD);
    expect(row?.isUserCreated).toBe(false);
    expect(row?.makerUsername ?? null).toBeNull();
    expect(row?.setName).toBe(integratedName);
    const covers = row?.coverCardUrls as string[];
    expect(covers).toEqual([]);
    const rowJson = JSON.stringify(row);
    expect(rowJson).not.toContain("Ken Griffey");
    expect(rowJson).not.toContain("Nolan Ryan");
    expect(rowJson).not.toContain("packpts.com/cards/");
    expect(rowJson).not.toContain("maker-set-1080.png");

    const winner = body.sets.find((set) => set.id === dupeHighId);
    expect(Number(winner?.cardCount)).toBe(9);
    expect(body.sets.every((set) => set.isUserCreated !== true)).toBe(true);
  });

  it("cardCount matches eligible cards, not every is_playable row", async () => {
    const [honest] = await db.select({
      cardCount: userSetCardCountSql,
    }).from(gameSets).where(eq(gameSets.id, integratedId)).limit(1);
    expect(Number(honest.cardCount)).toBeGreaterThan(GOOD);
  });

  it("deals the eligible stack when the request is larger than the set", async () => {
    const dealt = await storage.getRandomCardsFromSet(integratedId, 20);
    expect(dealt).toHaveLength(GOOD);
    expect(dealt.every((card) => card.gameSetId === integratedId)).toBe(true);
    expect(dealt.every((card) => card.player && card.player !== "Wrong Sport")).toBe(true);
    expect(dealt.some((card) => (card.imageUrl || "").includes("maker-set-1080.png"))).toBe(true);

    const fewer = await storage.getRandomCardsFromSet(otherYearId, 3);
    expect(fewer).toHaveLength(3);

    const session = await storage.createGameSession(null, "solo", 20, undefined, integratedId);
    sessionId = session.id;
    expect(session.questions).toHaveLength(GOOD);
    expect(session.totalQuestions).toBe(GOOD);
  });

  it("wires GET /api/sets to the integrated handler", () => {
    const routes = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
    const start = routes.indexOf('app.get("/api/sets",');
    expect(start).toBeGreaterThan(-1);
    const next = routes.indexOf("\n  app.", start + 10);
    const slice = routes.slice(start, next === -1 ? undefined : next);
    expect(slice).toContain("handlePublicSetsIndex");
    expect(slice).not.toContain("is_user_created = true");
    const detail = routes.slice(routes.indexOf('app.get("/api/sets/:id"'), routes.indexOf('app.get("/api/sets",'));
    expect(detail).toContain("handlePublicSetDetail");
    expect(routes).toContain("handlePublicSetCover");
    const detailSrc = readFileSync(new URL("../services/publicSets.ts", import.meta.url), "utf8");
    expect(detailSrc).toContain("eligiblePlayableCardCountSql");
    expect(detailSrc).not.toContain("playableCards.imageUrl");
  });
});
