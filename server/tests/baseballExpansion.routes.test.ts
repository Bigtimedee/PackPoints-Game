/**
 * Original-pool insert reloads the winning row. Concurrent different
 * submissions cannot both succeed. A witness change is not "unchanged".
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { designPoolSubmissions, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { insertIntegratedGameSet } from "../services/baseballExpansion/createIntegratedSet";
import { recordOriginalMembership } from "../services/baseballExpansion/store";

const setId = "abababab-abab-4aba-8aba-ababababab10";
const ownA = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
const ownB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5";
const foreignSet = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const foreignCard = "ffffffff-ffff-4fff-8fff-fffffffffff6";

afterAll(async () => {
  await db.delete(designPoolSubmissions).where(eq(designPoolSubmissions.setId, setId));
  await db.delete(playableCards).where(inArray(playableCards.id, [ownA, ownB, foreignCard]));
  await db.delete(gameSets).where(inArray(gameSets.id, [setId, foreignSet]));
});

describe("original pool winner", () => {
  it("keeps one winner when two different first pools race, and a witness change is not unchanged", async () => {
    await insertIntegratedGameSet({ id: setId, sport: "baseball", brand: "Topps", year: 1973, setName: "1973 Topps Baseball", isActive: false });
    await insertIntegratedGameSet({ id: foreignSet, sport: "baseball", brand: "Topps", year: 1972, setName: "1972 Topps Baseball", isActive: false });
    await db.insert(playableCards).values([
      { id: ownA, gameSetId: setId, cardhedgeCardId: `pool:${ownA}`, player: "A", set: "1973 Topps", number: "1", variant: "Base", imageUrl: "https://img.example/a.jpg", category: "Baseball", isPlayable: true },
      { id: ownB, gameSetId: setId, cardhedgeCardId: `pool:${ownB}`, player: "B", set: "1973 Topps", number: "2", variant: "Base", imageUrl: "https://img.example/b.jpg", category: "Baseball", isPlayable: true },
      { id: foreignCard, gameSetId: foreignSet, cardhedgeCardId: `pool:${foreignCard}`, player: "F", set: "1972 Topps", number: "1", variant: "Base", imageUrl: "https://img.example/f.jpg", category: "Baseball", isPlayable: true },
    ]).onConflictDoNothing();
    const [left, right] = await Promise.all([
      recordOriginalMembership({ setId, slug: "1973-topps", cardIds: [ownA], sources: [{ id: ownA, sourceUrl: "https://img.example/a.jpg" }] }),
      recordOriginalMembership({ setId, slug: "1973-topps", cardIds: [ownB], sources: [{ id: ownB, sourceUrl: "https://img.example/b.jpg" }] }),
    ]);
    const stored = [left, right].filter((row) => row.stored);
    const rejected = [left, right].filter((row) => !row.stored);
    expect(stored).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ code: "membership_mismatch" });
    const winner = left.stored ? [ownA] : [ownB];
    const changed = await recordOriginalMembership({
      setId, slug: "1973-topps", cardIds: winner, sources: [{ id: winner[0]!, sourceUrl: "https://img.example/changed.jpg" }],
    });
    expect(changed).toMatchObject({ stored: false, code: "witness_changed" });
    const foreign = await recordOriginalMembership({
      setId, slug: "1973-topps", cardIds: [foreignCard], sources: [{ id: foreignCard, sourceUrl: "https://img.example/f.jpg" }],
    });
    expect(foreign).toMatchObject({ stored: false, code: "foreign_card" });
  });
});
