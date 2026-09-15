/**
 * Admin DELETE /api/admin/game-sets/:id must remove the game_sets row
 * (including already-inactive junk) and FK dependents such as playable_cards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { eq } from "drizzle-orm";
import {
  cardhedgeImportRuns,
  cardImageReports,
  gameSets,
  playableCards,
} from "@shared/schema";

const hasDb = Boolean(process.env.DATABASE_URL);
const setId = randomUUID();
const cardId = randomUUID();
const alreadyGoneId = randomUUID();

let db: Awaited<typeof import("../db")>["db"];
let hardDeleteGameSet: Awaited<typeof import("../services/gameSetDelete")>["hardDeleteGameSet"];

describe("DELETE /api/admin/game-sets/:id handler", () => {
  it("keeps admin auth and hard-deletes instead of setting isActive=false", () => {
    const routesPath = join(dirname(fileURLToPath(import.meta.url)), "../routes.ts");
    const src = readFileSync(routesPath, "utf8");
    const marker = 'app.delete("/api/admin/game-sets/:id"';
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const handler = src.slice(start, start + 900);
    expect(handler).toContain("isAuthenticated, requireAdmin");
    expect(handler).toContain("hardDeleteGameSet");
    expect(handler).toContain('res.json({ success: true })');
    expect(handler).toContain("404");
    expect(handler).not.toMatch(/\.set\(\{\s*isActive:\s*false\s*\}\)/);
  });
});

describe.skipIf(!hasDb)("hardDeleteGameSet", () => {
  beforeAll(async () => {
    ({ db } = await import("../db"));
    ({ hardDeleteGameSet } = await import("../services/gameSetDelete"));

    await db.insert(gameSets).values({
      id: setId,
      sport: "baseball",
      brand: "Junk",
      year: 1901,
      setName: "Hard Delete Test Set",
      isActive: false,
    });
    await db.insert(playableCards).values({
      id: cardId,
      gameSetId: setId,
      cardhedgeCardId: `hard-delete-test:${randomUUID()}`,
      player: "Nobody",
      imageUrl: "https://example.com/card.jpg",
      category: "baseball",
      isPlayable: true,
    });
    await db.insert(cardImageReports).values({
      cardId,
      reason: "other",
      description: "hard-delete cascade fixture",
    });
    await db.insert(cardhedgeImportRuns).values({
      gameSetId: setId,
      status: "SUCCESS",
      cardsImported: 1,
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(cardImageReports).where(eq(cardImageReports.cardId, cardId)).catch(() => null);
    await db.delete(playableCards).where(eq(playableCards.gameSetId, setId)).catch(() => null);
    await db.delete(cardhedgeImportRuns).where(eq(cardhedgeImportRuns.gameSetId, setId)).catch(() => null);
    await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
  });

  it("removes an already-inactive game_sets row and its playable_cards", async () => {
    const listedBefore = await db
      .select({ id: gameSets.id, isActive: gameSets.isActive })
      .from(gameSets)
      .where(eq(gameSets.id, setId));
    expect(listedBefore).toHaveLength(1);
    expect(listedBefore[0].isActive).toBe(false);

    const removed = await hardDeleteGameSet(setId);
    expect(removed).toBe(true);

    const listedAfter = await db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.id, setId));
    expect(listedAfter).toHaveLength(0);

    const leftoverCards = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, setId));
    expect(leftoverCards).toHaveLength(0);

    const leftoverReports = await db
      .select({ id: cardImageReports.id })
      .from(cardImageReports)
      .where(eq(cardImageReports.cardId, cardId));
    expect(leftoverReports).toHaveLength(0);

    const leftoverRuns = await db
      .select({ id: cardhedgeImportRuns.id })
      .from(cardhedgeImportRuns)
      .where(eq(cardhedgeImportRuns.gameSetId, setId));
    expect(leftoverRuns).toHaveLength(0);

    expect(await hardDeleteGameSet(setId)).toBe(false);
  });

  it("returns false when the set is already gone (handler 404)", async () => {
    expect(await hardDeleteGameSet(alreadyGoneId)).toBe(false);
  });
});
