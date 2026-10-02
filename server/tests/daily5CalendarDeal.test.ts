/**
 * Daily 5 fixed calendar against the DB: the scheduled set is dealt, a held
 * or thin scheduled set falls back, the fallback deal still goes through the
 * blocklist and refusals, a stored day is never rewritten, and the QA
 * preview matches the real deal.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import {
  anonDailyRuns,
  dailyChallengeCards,
  dailyChallengeEntries,
  dailyChallenges,
  gameSets,
  playableCards,
} from "@shared/schema";
import { addPackptsDays, getDailyStartEnd } from "@shared/packptsDay";
import { db } from "../db";
import { refreshHeldSets } from "../config/heldSets";
import { daily5Weekday } from "../services/daily5Calendar";
import { daily5Service } from "../services/daily5Service";
import { registerDealableQaRoutes } from "../routes/dealableQa";

const stamp = randomUUID().slice(0, 8);
const greenA = randomUUID();
const thinB = randomUUID();
const heldH = randomUUID();
const fallbackF = randomUUID();
const TOKEN = `d5cal-${stamp}`;
const saved = {
  extra: process.env.CLEARED_SET_IDS_EXTRA,
  green: process.env.DAILY5_GREEN_SET_IDS,
  fallback: process.env.DAILY5_FALLBACK_SET_ID,
  token: process.env.COVER_QA_TOKEN,
};

// First Monday on or after 2097-03-04, far from other fixtures' dates.
let monday = "2097-03-04";
while (daily5Weekday(monday) !== 0) monday = addPackptsDays(monday, 1);
const day = (offset: number) => addPackptsDays(monday, offset);
const DATES = Array.from({ length: 21 }, (_, i) => day(i));

const cardIds: string[] = [];
const blockedIds: string[] = [];

function card(setId: string, player: string, extra: Partial<typeof playableCards.$inferInsert> = {}) {
  const id = randomUUID();
  cardIds.push(id);
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `d5cal:${stamp}:${id}`,
    player,
    set: `D5 Calendar ${stamp}`,
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
    ...extra,
  };
}

async function clearDates() {
  const rows = await db.select({ id: dailyChallenges.id }).from(dailyChallenges).where(inArray(dailyChallenges.date, DATES));
  for (const row of rows) {
    await db.delete(dailyChallengeCards).where(eq(dailyChallengeCards.dailyChallengeId, row.id)).catch(() => null);
    await db.delete(dailyChallengeEntries).where(eq(dailyChallengeEntries.dailyChallengeId, row.id)).catch(() => null);
    await db.delete(anonDailyRuns).where(eq(anonDailyRuns.dailyChallengeId, row.id)).catch(() => null);
    await db.delete(dailyChallenges).where(eq(dailyChallenges.id, row.id)).catch(() => null);
  }
}

async function dealt(date: string) {
  const [row] = await db.select().from(dailyChallenges).where(eq(dailyChallenges.date, date)).limit(1);
  if (!row) return { row: null, cards: [] as { cardId: string; gameSetId: string | null }[] };
  const cards = await db
    .select({ cardId: dailyChallengeCards.cardId, gameSetId: playableCards.gameSetId })
    .from(dailyChallengeCards)
    .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
    .where(eq(dailyChallengeCards.dailyChallengeId, row.id))
    .orderBy(asc(dailyChallengeCards.position));
  return { row, cards };
}

beforeAll(async () => {
  process.env.CLEARED_SET_IDS_EXTRA = [saved.extra, greenA, thinB, fallbackF].filter(Boolean).join(",");
  process.env.DAILY5_GREEN_SET_IDS = [greenA, thinB, heldH].join(",");
  process.env.DAILY5_FALLBACK_SET_ID = fallbackF;
  process.env.COVER_QA_TOKEN = TOKEN;
  await clearDates();

  const base = { sport: "basketball", brand: "Fleer", year: 1989, isUserCreated: false, isActive: true, cardsImportedCount: 0 };
  await db.insert(gameSets).values([
    { ...base, id: greenA, setName: `D5 Green ${stamp}` },
    { ...base, id: thinB, setName: `D5 Thin ${stamp}` },
    { ...base, id: fallbackF, setName: `D5 Fallback ${stamp}` },
    // 1990 Hoops identity without Design clearance is held.
    { ...base, id: heldH, brand: "Hoops", year: 1990, setName: "1990 Hoops Basketball" },
  ]);
  const multi = card(fallbackF, "Karl Malone / John Stockton");
  const refused = card(fallbackF, "Refused Player", { isPlayable: false });
  blockedIds.push(multi.id, refused.id);
  await db.insert(playableCards).values([
    ...Array.from({ length: 8 }, (_, i) => card(greenA, `Green Player ${i + 1}`)),
    ...Array.from({ length: 3 }, (_, i) => card(thinB, `Thin Player ${i + 1}`)),
    ...Array.from({ length: 8 }, (_, i) => card(heldH, `Hoops Player ${i + 1}`)),
    ...Array.from({ length: 6 }, (_, i) => card(fallbackF, `Fallback Player ${i + 1}`)),
    multi,
    refused,
  ]);
  await refreshHeldSets();
});

afterAll(async () => {
  await clearDates();
  if (cardIds.length) await db.delete(playableCards).where(inArray(playableCards.id, cardIds)).catch(() => null);
  await db.delete(gameSets).where(inArray(gameSets.id, [greenA, thinB, heldH, fallbackF])).catch(() => null);
  for (const [key, value] of [
    ["CLEARED_SET_IDS_EXTRA", saved.extra],
    ["DAILY5_GREEN_SET_IDS", saved.green],
    ["DAILY5_FALLBACK_SET_ID", saved.fallback],
    ["COVER_QA_TOKEN", saved.token],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await refreshHeldSets();
});

describe("Daily 5 fixed calendar deal", () => {
  it("QA preview for a future Monday matches the deal that is later created", async () => {
    const preview = await daily5Service.previewDeal(day(0));
    expect(preview.stored).toBe(false);
    expect(preview.setId).toBe(greenA);
    expect(preview.choice?.source).toBe("scheduled");
    expect(preview.dealableCount).toBe(8);
    expect(preview.cardIds).toHaveLength(5);
    const [none] = await db.select({ id: dailyChallenges.id }).from(dailyChallenges).where(eq(dailyChallenges.date, day(0)));
    expect(none).toBeUndefined();

    await daily5Service.createChallengeForDate(day(0));
    const { row, cards } = await dealt(day(0));
    expect(row?.setId).toBe(greenA);
    expect(cards.map((c) => c.cardId)).toEqual(preview.cardIds);
    expect(cards.every((c) => c.gameSetId === greenA)).toBe(true);
  });

  it("deals the fallback on a fallback day, when the scheduled set is thin, and when it is held", async () => {
    // Tue fallback day, Wed slot 1 = thin set (3 cards), Fri slot 2 = held set.
    for (const offset of [1, 2, 4]) {
      await daily5Service.createChallengeForDate(day(offset));
      const { row, cards } = await dealt(day(offset));
      expect(row?.setId, day(offset)).toBe(fallbackF);
      expect(cards).toHaveLength(5);
      expect(cards.every((c) => c.gameSetId === fallbackF)).toBe(true);
    }
  });

  it("fallback deals respect the card blocklist and refusals", async () => {
    const preview = await daily5Service.previewDeal(day(3));
    expect(preview.setId).toBe(fallbackF);
    expect(preview.dealableCount).toBe(6);
    for (const offset of [1, 2, 3, 4, 6, 8, 10]) {
      await daily5Service.createChallengeForDate(day(offset));
      const { cards } = await dealt(day(offset));
      expect(cards).toHaveLength(5);
      expect(cards.some((c) => blockedIds.includes(c.cardId))).toBe(false);
    }
  });

  it("never rewrites a day that already has a stored deal", async () => {
    const date = day(7); // Monday, calendar says greenA
    const { startsAt, endsAt } = getDailyStartEnd(date);
    const [row] = await db.insert(dailyChallenges).values({
      date, mode: "DAILY5", setId: fallbackF, seed: "stored-seed", startsAt, endsAt, status: "SCHEDULED",
    }).returning();
    const fallbackCards = await db.select().from(playableCards)
      .where(eq(playableCards.gameSetId, fallbackF)).orderBy(asc(playableCards.player)).limit(8);
    const keep = fallbackCards.filter((c) => !blockedIds.includes(c.id)).slice(0, 5);
    await db.insert(dailyChallengeCards).values(keep.map((c, i) => ({
      dailyChallengeId: row.id, position: i + 1, cardId: c.id, correctAnswer: c.player!, choices: [c.player!], pointValue: 100,
    })));

    const again = await daily5Service.createChallengeForDate(date);
    expect(again?.id).toBe(row.id);
    expect(again?.setId).toBe(fallbackF);
    const { cards } = await dealt(date);
    expect(cards.map((c) => c.cardId)).toEqual(keep.map((c) => c.id));
    const preview = await daily5Service.previewDeal(date);
    expect(preview.stored).toBe(true);
    expect(preview.cardIds).toEqual(keep.map((c) => c.id));
  });

  it("QA preview route is token-gated and lists the calendar", async () => {
    const app = express();
    registerDealableQaRoutes(app);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/api/qa/daily5/preview?date=${day(14)}&days=7`;
    try {
      expect((await fetch(url)).status).toBe(404);
      expect((await fetch(url, { headers: { "X-QA-Token": "wrong" } })).status).toBe(404);
      const res = await fetch(url, { headers: { "X-QA-Token": TOKEN } });
      expect(res.status).toBe(200);
      const body = await res.json() as { timezone: string; days: { date: string; weekday: string; setId: string; scheduledSetId: string; cardIds: string[]; stored: boolean }[] };
      expect(body.timezone).toBe("America/Chicago");
      expect(body.days.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
      expect(body.days.map((d) => d.scheduledSetId)).toEqual([greenA, fallbackF, thinB, fallbackF, heldH, greenA, fallbackF]);
      expect(body.days.map((d) => d.setId)).toEqual([greenA, fallbackF, fallbackF, fallbackF, fallbackF, greenA, fallbackF]);
      expect(body.days.every((d) => d.cardIds.length === 5 && !d.stored)).toBe(true);
      expect(JSON.stringify(body)).not.toContain("Player");
      const bad = await fetch(`http://127.0.0.1:${port}/api/qa/daily5/preview?date=nope`, { headers: { "X-QA-Token": TOKEN } });
      expect(bad.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const [none] = await db.select({ id: dailyChallenges.id }).from(dailyChallenges).where(eq(dailyChallenges.date, day(14)));
    expect(none).toBeUndefined();
  });
});
