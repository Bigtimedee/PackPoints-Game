/**
 * Publish honesty: public set cardCount must match the playable_cards
 * actually inserted by /make (same rows Surface A share reads).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../db";
import { gameSets, playableCards, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { userSetCardCountSql, userSetPlayCountSql } from "../routes/userSetCounts";
import { loadPublishedSetShareSource } from "../contentFactory/makerShareFromSet";

const CARD_COUNT = 5;
let testUserId: string;
let setId: string;

beforeAll(async () => {
  testUserId = `test-setcount-${randomUUID()}`;
  setId = randomUUID();
  await db.insert(users).values({
    id: testUserId,
    username: `setcount_${Date.now()}`,
    points: 0,
    gamesPlayed: 0,
    correctAnswers: 0,
    totalAnswers: 0,
    isAdmin: false,
  });
  await db.insert(gameSets).values({
    id: setId,
    sport: "basketball",
    brand: "Topps",
    year: 1987,
    setName: "Design QA Count Stack",
    isUserCreated: true,
    createdByUserId: testUserId,
    makerNote: "PC on the desk. Built for QA.",
  });
  await db.insert(playableCards).values(
    Array.from({ length: CARD_COUNT }, (_, i) => ({
      gameSetId: setId,
      cardhedgeCardId: `snap2set:${randomUUID()}`,
      player: `Player ${i + 1}`,
      set: "1987 Topps",
      description: `1987 Topps — Player ${i + 1}`,
      imageUrl: `https://packpts.com/api/card-photos/${randomUUID()}`,
      category: "basketball",
      isPlayable: true,
    })),
  );
});

afterAll(async () => {
  await db.delete(playableCards).where(eq(playableCards.gameSetId, setId)).catch(() => null);
  await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
  await db.delete(users).where(eq(users.id, testUserId)).catch(() => null);
});

describe("GET /api/sets/:id cardCount vs published cards", () => {
  it("counts the playable_cards rows /make inserted (not 0)", async () => {
    const [set] = await db.select({
      id: gameSets.id,
      cardCount: userSetCardCountSql,
      playCount: userSetPlayCountSql,
    }).from(gameSets).where(eq(gameSets.id, setId)).limit(1);

    expect(set).toBeTruthy();
    expect(Number(set.cardCount)).toBe(CARD_COUNT);
    expect(Number(set.playCount)).toBe(0);

    const shareSource = await loadPublishedSetShareSource(setId);
    expect(shareSource?.cardCount).toBe(CARD_COUNT);
    expect(shareSource?.cardCount).toBe(Number(set.cardCount));
  });

  it("does not rebind gameSets.id as a parameter (the live 0-count bug)", async () => {
    const [broken] = await db.select({
      cardCount: sql<number>`(SELECT COUNT(*) FROM playable_cards WHERE game_set_id = ${gameSets.id} AND is_playable = true)`,
    }).from(gameSets).where(eq(gameSets.id, setId)).limit(1);

    // Document the drizzle pitfall: interpolating ${gameSets.id} in sql``
    // counts 0 while the correlated game_sets.id identifier counts 5.
    expect(Number(broken.cardCount)).toBe(0);

    const [honest] = await db.select({
      cardCount: userSetCardCountSql,
    }).from(gameSets).where(eq(gameSets.id, setId)).limit(1);
    expect(Number(honest.cardCount)).toBe(CARD_COUNT);
  });
});
