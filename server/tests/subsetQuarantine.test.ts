/**
 * Subset cards on a flagged set stay out of the deal filter until the
 * per-card layout check has passed. A player name by itself is not subset metadata.
 */
import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { MASK_LAYOUT_SET_IDS } from "../masking/maskProfiles";
import { cardMetadataMarksSubset } from "../masking/subsetQuarantine";
import { eligibleDealFilter } from "../services/playableSetEligibility";

const setId = MASK_LAYOUT_SET_IDS.toppsFootball1987;
const stamp = randomUUID().slice(0, 8);

describe("subset quarantine", () => {
  const bareId = randomUUID();
  const breakerId = randomUUID();
  const verifiedId = randomUUID();
  const baseId = randomUUID();
  const blockedShellId = randomUUID();

  afterAll(async () => {
    await db.delete(playableCards).where(inArray(playableCards.id, [bareId, breakerId, verifiedId, baseId, blockedShellId]));
    await db.delete(gameSets).where(eq(gameSets.id, setId));
  });

  it("keeps a Record Breaker out until the layout check passes, and does not treat a bare player name as a subset", async () => {
    expect(cardMetadataMarksSubset({ player: "Donnie Shell" })).toBe(false);
    expect(cardMetadataMarksSubset({ player: "Donnie Shell", variant: "Record Breaker" })).toBe(true);
    expect(cardMetadataMarksSubset({ description: "Team Leaders" })).toBe(true);
    expect(cardMetadataMarksSubset({ number: "CL" })).toBe(false);
    expect(cardMetadataMarksSubset({ description: "Checklist 1-132" })).toBe(true);

    await db.insert(gameSets).values({
      id: setId,
      sport: "football",
      brand: "Topps",
      year: 1987,
      setName: `1987 Topps Football ${stamp}`,
      isUserCreated: false,
      isActive: true,
    }).onConflictDoNothing();

    const card = (
      id: string,
      player: string,
      variant: string | null,
      verified: boolean,
    ) => ({
      id,
      gameSetId: setId,
      cardhedgeCardId: `subset:${id}`,
      player,
      set: `1987 Topps Football ${stamp}`,
      description: player,
      variant,
      imageUrl: `https://images.example.com/${id}.jpg`,
      category: "football",
      isPlayable: true,
      contentVerified: true as boolean | null,
      imageReviewStatus: "unreviewed",
      quarantineStatus: "OK",
      proposedUnplayable: false,
      blockedReason: null as string | null,
      nameLayoutVerified: verified,
      lastImageCheck: new Date(),
    });

    await db.insert(playableCards).values([
      card(bareId, "Jerry Rice", null, false),
      card(breakerId, "Jerry Rice", "Record Breaker", false),
      card(verifiedId, "Jerry Rice", "Record Breaker", true),
      card(baseId, "Hanford Dixon", null, false),
      card(blockedShellId, "Donnie Shell", null, true),
    ]);

    const rows = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(and(eq(playableCards.gameSetId, setId), eligibleDealFilter("playable_cards")));
    const ids = rows.map((row) => row.id).sort();
    expect(ids).toContain(bareId);
    expect(ids).toContain(baseId);
    expect(ids).toContain(verifiedId);
    expect(ids).not.toContain(breakerId);
    expect(ids).not.toContain(blockedShellId);
  });
});
