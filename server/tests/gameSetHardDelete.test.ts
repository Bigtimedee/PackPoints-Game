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
    const handler = src.slice(start, start + 1600);
    expect(handler).toContain("isAuthenticated, requireAdmin");
    expect(handler).toContain("hardDeleteGameSet");
    expect(handler).toContain("describeGameSetDeleteError");
    expect(handler).toContain('res.json({ success: true })');
    expect(handler).toContain("404");
    expect(handler).toContain("failure.status");
    expect(handler).toContain("failure.constraint");
    expect(handler).not.toContain('error: "Failed to delete game set"');
    expect(handler).not.toMatch(/\.set\(\{\s*isActive:\s*false\s*\}\)/);
  });
});

describe("describeGameSetDeleteError", () => {
  it("names the playable_cards constraint instead of a generic failure", async () => {
    const { describeGameSetDeleteError } = await import("../services/gameSetDeleteError");
    const failure = describeGameSetDeleteError({
      code: "23503",
      constraint: "playable_cards_game_set_id_game_sets_id_fk",
      table: "playable_cards",
      detail: 'Key (id)=(abc) is still referenced from table "playable_cards".',
      message:
        'update or delete on table "game_sets" violates foreign key constraint "playable_cards_game_set_id_game_sets_id_fk" on table "playable_cards"',
    });
    expect(failure.status).toBe(409);
    expect(failure.code).toBe("23503");
    expect(failure.constraint).toBe("playable_cards_game_set_id_game_sets_id_fk");
    expect(failure.error).toContain("playable_cards_game_set_id_game_sets_id_fk");
    expect(failure.error).toContain("import");
    expect(failure.error).toContain('violates foreign key constraint "playable_cards_game_set_id_game_sets_id_fk"');
    expect(failure.error).not.toBe("Failed to delete game set");
  });

  it("names a different blocking table and constraint", async () => {
    const { describeGameSetDeleteError } = await import("../services/gameSetDeleteError");
    const failure = describeGameSetDeleteError({
      code: "23503",
      constraint: "set_of_week_set_id_game_sets_id_fk",
      table: "set_of_week",
    });
    expect(failure.status).toBe(409);
    expect(failure.error).toContain("set_of_week");
    expect(failure.error).toContain("set_of_week_set_id_game_sets_id_fk");
    expect(failure.error).not.toBe("Failed to delete game set");
  });

  it("keeps a specific non-FK server message", async () => {
    const { describeGameSetDeleteError } = await import("../services/gameSetDeleteError");
    const failure = describeGameSetDeleteError(new Error("deadlock detected"));
    expect(failure.status).toBe(500);
    expect(failure.error).toBe("deadlock detected");
  });
});

describe("admin playable-sets UI delete action", () => {
  const pagePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../client/src/pages/admin/playable-sets.tsx",
  );
  const src = readFileSync(pagePath, "utf8");

  it("calls DELETE /api/admin/game-sets/:id with credentials via apiRequest", () => {
    expect(src).toContain('apiRequest("DELETE", `/api/admin/game-sets/${setId}`)');
    expect(src).toContain("Trash2");
    expect(src).toContain('data-testid={`button-delete-${set.id}`}');
    expect(src).toContain('data-testid="button-confirm-delete"');
  });

  it("requires confirmation that names the set and shows card count", () => {
    expect(src).toContain("showDeleteConfirm");
    expect(src).toContain("setDisplayName(deleteTargetSet)");
    expect(src).toContain("cardsImportedCount");
    expect(src).toContain("Delete permanently");
    expect(src).toContain('variant="destructive"');
  });

  it("invalidates the game-sets list on successful delete", () => {
    const marker = "const deleteMutation = useMutation({";
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const mutation = src.slice(start, start + 1200);
    expect(mutation).toContain('queryKey: ["/api/admin/game-sets"]');
    expect(mutation).toContain("invalidateQueries");
    expect(mutation).toContain("error.message");
    expect(mutation).not.toContain("Failed to delete game set");
  });

  it("does not abort a CardHedge import at the default 15s client timeout", () => {
    expect(src).toContain("timeoutMs: 10 * 60 * 1000");
  });

  it("refreshes the blocking card count before confirm and does not label an in-progress import as Never", () => {
    expect(src).toContain("staleTime: 0");
    expect(src).toContain("Import in progress");
    expect(src).toContain("Cards stored, import not finished");
    expect(src).toContain("lastImportLabel(set)");
  });
});

describe("GET /api/admin/game-sets card count", () => {
  it("counts every playable_cards row that FK-blocks delete", () => {
    const routesPath = join(dirname(fileURLToPath(import.meta.url)), "../routes.ts");
    const src = readFileSync(routesPath, "utf8");
    const marker = 'app.get("/api/admin/game-sets"';
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const handler = src.slice(start, src.indexOf("app.post(", start));
    expect(handler).toContain("SELECT COUNT(*)::int FROM playable_cards pc");
    expect(handler).toContain("pc.game_set_id = game_sets.id");
    expect(handler).not.toContain("pc.is_playable");
    expect(handler).not.toContain("content_verified");
    expect(handler).toContain("latest_import_status");
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

  it("removes an active never-imported set with no playable cards", async () => {
    const id = randomUUID();
    await db.insert(gameSets).values({
      id,
      sport: "basketball",
      brand: "Panini",
      year: 2018,
      setName: "2018 Panini Prizm Basketball",
      isActive: true,
      cardsImportedCount: 0,
      lastImportAt: null,
    });

    try {
      expect(await hardDeleteGameSet(id)).toBe(true);
      const listedAfter = await db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.id, id));
      expect(listedAfter).toHaveLength(0);
    } finally {
      await db.delete(gameSets).where(eq(gameSets.id, id)).catch(() => null);
    }
  });

  it("removes an active set while the import counter is still zero but rows exist", async () => {
    const id = randomUUID();
    const partialCardId = randomUUID();
    await db.insert(gameSets).values({
      id,
      sport: "basketball",
      brand: "Panini",
      year: 2018,
      setName: "Partial Import Active Set",
      isActive: true,
      cardsImportedCount: 0,
      lastImportAt: null,
    });
    await db.insert(playableCards).values({
      id: partialCardId,
      gameSetId: id,
      cardhedgeCardId: `hard-delete-partial:${randomUUID()}`,
      player: "",
      imageUrl: null,
      category: "basketball",
      isPlayable: false,
    });
    await db.insert(cardhedgeImportRuns).values({
      gameSetId: id,
      status: "RUNNING",
      cardsImported: 0,
    });

    try {
      expect(await hardDeleteGameSet(id)).toBe(true);
      expect(await db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.id, id))).toHaveLength(0);
      expect(
        await db.select({ id: playableCards.id }).from(playableCards).where(eq(playableCards.gameSetId, id)),
      ).toHaveLength(0);
      expect(
        await db.select({ id: cardhedgeImportRuns.id }).from(cardhedgeImportRuns).where(eq(cardhedgeImportRuns.gameSetId, id)),
      ).toHaveLength(0);
    } finally {
      await db.delete(playableCards).where(eq(playableCards.id, partialCardId)).catch(() => null);
      await db.delete(cardhedgeImportRuns).where(eq(cardhedgeImportRuns.gameSetId, id)).catch(() => null);
      await db.delete(gameSets).where(eq(gameSets.id, id)).catch(() => null);
    }
  });

  it("waits for an in-flight playable_cards insert, then deletes the active set", async () => {
    const id = randomUUID();
    const cardId = randomUUID();
    await db.insert(gameSets).values({
      id,
      sport: "basketball",
      brand: "Panini",
      year: 2018,
      setName: "In Flight Import Active Set",
      isActive: true,
      cardsImportedCount: 0,
      lastImportAt: null,
    });

    const { pool } = await import("../db");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO playable_cards (id, game_set_id, cardhedge_card_id, player, category, is_playable)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [cardId, id, `hard-delete-race:${randomUUID()}`, "In Flight", "basketball"],
      );

      const removed = hardDeleteGameSet(id);
      const started = Date.now();
      let blocked = false;
      while (Date.now() - started < 5000) {
        const waiting = await pool.query(
          `SELECT pid FROM pg_stat_activity
           WHERE state = 'active'
             AND wait_event_type = 'Lock'
             AND query ILIKE '%game_sets%'
             AND pid <> pg_backend_pid()`,
        );
        if (waiting.rows.length > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(blocked).toBe(true);

      await client.query("COMMIT");
      expect(await removed).toBe(true);
      expect(await db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.id, id))).toHaveLength(0);
      expect(
        await db.select({ id: playableCards.id }).from(playableCards).where(eq(playableCards.id, cardId)),
      ).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK").catch(() => null);
      client.release();
      await db.delete(playableCards).where(eq(playableCards.id, cardId)).catch(() => null);
      await db.delete(gameSets).where(eq(gameSets.id, id)).catch(() => null);
    }
  });
});
