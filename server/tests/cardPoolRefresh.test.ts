/**
 * Card pool refresh must not mark a card playable when the current mask bake refuses it.
 * The blocked_reason list is the same one eligibleDealFilter uses.
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import {
  MASK_BAKE_BLOCK_REASONS,
  cardPoolMayRestore,
  eligibleDealFilter,
} from "../services/playableSetEligibility";

const setId = randomUUID();
const okId = randomUUID();
const plateId = randomUUID();
const uncoveredId = randomUUID();
const httpId = randomUUID();
const cardIds = [okId, plateId, uncoveredId, httpId];

function card(id: string, extra: {
  blockedReason?: string | null;
  lastValidationReason?: string | null;
}) {
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `pool-refresh:${id}`,
    player: "Pool Player",
    set: "QA Pool",
    number: "20",
    description: "Pool Player",
    imageUrl: `https://packpts.example/raw/${id}.jpg`,
    category: "football",
    isPlayable: true,
    contentVerified: true,
    imageReviewStatus: "unreviewed",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    blockedReason: extra.blockedReason ?? null,
    lastValidationReason: extra.lastValidationReason ?? null,
    lastImageCheck: new Date(),
  };
}

describe("card pool refresh mask refusal", () => {
  afterAll(async () => {
    await db.delete(playableCards).where(inArray(playableCards.id, cardIds)).catch(() => null);
    await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
  });

  it("refuses restore for every bake block reason and allows an HTTP image miss", () => {
    for (const reason of MASK_BAKE_BLOCK_REASONS) {
      expect(cardPoolMayRestore({ blockedReason: reason, lastValidationReason: null }, null)).toBe(false);
    }
    expect(cardPoolMayRestore(
      { blockedReason: "mask_name_uncovered", lastValidationReason: "name_plate_unresolved" },
      "name_plate_unresolved",
    )).toBe(false);
    expect(cardPoolMayRestore(
      { blockedReason: null, lastValidationReason: "name_plate_unresolved" },
      null,
    )).toBe(false);
    expect(cardPoolMayRestore(
      { blockedReason: null, lastValidationReason: "HTTP 404" },
      null,
    )).toBe(true);
    expect(cardPoolMayRestore(
      { blockedReason: null, lastValidationReason: null },
      null,
    )).toBe(true);
    expect(cardPoolMayRestore(
      { blockedReason: null, lastValidationReason: "HTTP 404" },
      "name_plate_unresolved",
    )).toBe(false);
  });

  it("uses the same reason list as eligibleDealFilter and checks it before marking playable", async () => {
    const eligibility = readFileSync(new URL("../services/playableSetEligibility.ts", import.meta.url), "utf8");
    const covered = eligibility.slice(eligibility.indexOf("export function maskNameStillCovered"));
    expect(covered.startsWith("export function maskNameStillCovered")).toBe(true);
    expect(covered).toContain("MASK_BAKE_BLOCK_REASONS");
    const deal = eligibility.slice(eligibility.indexOf("export function eligibleDealFilter"));
    expect(deal).toContain("maskNameStillCovered(alias)");
    const src = readFileSync(new URL("../services/cardPoolRefresh.ts", import.meta.url), "utf8");
    const guard = src.indexOf("cardPoolMayRestore");
    const delay = src.indexOf("DELAY_BETWEEN_CARDS_MS");
    const playable = src.indexOf("isPlayable: true");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(delay);
    expect(guard).toBeLessThan(playable);
    expect(src).toContain('maskNameStillCovered("playable_cards")');

    await db.insert(gameSets).values({
      id: setId,
      sport: "football",
      brand: "Topps",
      year: 1987,
      setName: `QA Pool ${setId.slice(0, 8)}`,
      isUserCreated: false,
      isActive: true,
    });
    await db.insert(playableCards).values([
      card(okId, {}),
      card(plateId, { blockedReason: "name_plate_unresolved", lastValidationReason: "name_plate_unresolved" }),
      card(uncoveredId, { blockedReason: "mask_name_uncovered", lastValidationReason: "name_plate_unresolved" }),
      card(httpId, { lastValidationReason: "HTTP 404" }),
    ]);
    const rows = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(and(eq(playableCards.gameSetId, setId), eligibleDealFilter("playable_cards")));
    expect(rows.map((row) => row.id).sort()).toEqual([httpId, okId].sort());
  });
});
