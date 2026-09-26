/**
 * title_verified backfill. Scoped to inserted rows. Does not shell out.
 */
import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { gameSets } from "@shared/schema";
import { db } from "../db";
import {
  backfillVerifiedSetTitlesOnce,
  eligibleForTitleBackfill,
  markEligibleSetTitlesVerified,
  UNVERIFIED_TITLE_ID_PREFIX,
  UNVERIFIED_TITLE_SET_NAME,
} from "../services/gameSetTitles";

const ids: string[] = [];

function row(id: string, setName: string, isActive: boolean) {
  return {
    id,
    sport: "baseball",
    brand: "Topps",
    year: 1987,
    setName,
    isUserCreated: false,
    isActive,
    titleVerified: false,
  };
}

afterAll(async () => {
  if (ids.length === 0) return;
  await db.delete(gameSets).where(inArray(gameSets.id, ids)).catch(() => null);
});

describe("set title backfill eligibility", () => {
  it("keeps 2024 Basketball and inactive sets unverified", () => {
    expect(eligibleForTitleBackfill({
      id: randomUUID(),
      setName: "1987 Topps Football",
      isActive: true,
    })).toBe(true);
    expect(eligibleForTitleBackfill({
      id: randomUUID(),
      setName: UNVERIFIED_TITLE_SET_NAME,
      isActive: true,
    })).toBe(false);
    expect(eligibleForTitleBackfill({
      id: `${UNVERIFIED_TITLE_ID_PREFIX}${randomUUID().slice(8)}`,
      setName: "Other Name",
      isActive: true,
    })).toBe(false);
    expect(eligibleForTitleBackfill({
      id: randomUUID(),
      setName: "1987 Topps Football",
      isActive: false,
    })).toBe(false);
  });

  it("marks eligible active sets and does not re-verify later rows", async () => {
    const goodId = randomUUID();
    const basketballNameId = randomUUID();
    const basketballPrefixId = `${UNVERIFIED_TITLE_ID_PREFIX}${randomUUID().slice(8)}`;
    const inactiveId = randomUUID();
    const laterId = randomUUID();
    ids.push(goodId, basketballNameId, basketballPrefixId, inactiveId, laterId);

    await db.insert(gameSets).values([
      row(goodId, "1987 Topps Football", true),
      row(basketballNameId, UNVERIFIED_TITLE_SET_NAME, true),
      row(basketballPrefixId, "Prefix Hold", true),
      row(inactiveId, "Inactive Football", false),
    ]);

    const marked = await markEligibleSetTitlesVerified([
      goodId,
      basketballNameId,
      basketballPrefixId,
      inactiveId,
    ]);
    expect(marked).toEqual([goodId]);

    const stored = await db.select({
      id: gameSets.id,
      titleVerified: gameSets.titleVerified,
    }).from(gameSets).where(inArray(gameSets.id, [goodId, basketballNameId, basketballPrefixId, inactiveId]));
    const byId = new Map(stored.map((item) => [item.id, item.titleVerified]));
    expect(byId.get(goodId)).toBe(true);
    expect(byId.get(basketballNameId)).toBe(false);
    expect(byId.get(basketballPrefixId)).toBe(false);
    expect(byId.get(inactiveId)).toBe(false);

    await db.insert(gameSets).values([row(laterId, "Later Active Set", true)]);
    expect(await backfillVerifiedSetTitlesOnce()).toBe(0);
    const [later] = await db.select({ titleVerified: gameSets.titleVerified })
      .from(gameSets)
      .where(inArray(gameSets.id, [laterId]));
    expect(later?.titleVerified).toBe(false);
  });
});
