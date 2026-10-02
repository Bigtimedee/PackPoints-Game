/**
 * A current-version mask refusal stays out of deals.
 * Card pool refresh must not flip it playable. A stored future Daily 5 hand
 * swaps it. A card with no fail sidecar stays dealable.
 */
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { dailyChallengeCards, dailyChallenges, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { sweepBlockedDaily5Deals } from "../lib/cardBlocklist";
import {
  clearMaskFailureSidecar,
  setMaskReadySidecarDirForTests,
  writeMaskFailureSidecar,
} from "../masking/maskReadySidecar";
import { cardPoolRefreshCandidateFilter, restorePlayableIfMaskAllows } from "../services/cardPoolRefresh";
import { eligibleDealFilter } from "../services/playableSetEligibility";

const stamp = randomUUID().slice(0, 8);
const setId = randomUUID();
const refusedId = randomUUID();
const imageFailId = randomUUID();
const bakedId = randomUUID();
const spareId = randomUUID();
const today = "2999-01-01";
const futureDate = "2999-08-26";
const pastDate = "2998-12-01";
const cardIds = [refusedId, imageFailId, bakedId, spareId];
const challengeIds: string[] = [];
let dir = "";

function row(id: string, player: string, playable: boolean, blockedReason: string | null) {
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `mask-refusal:${stamp}:${id}`,
    player,
    set: `Mask refusal ${stamp}`,
    description: player,
    number: "100",
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: "basketball",
    isPlayable: playable,
    contentVerified: true as boolean | null,
    imageReviewStatus: "approved",
    quarantineStatus: playable ? "OK" : "QUARANTINED_ADMIN_REVIEW",
    proposedUnplayable: false,
    blockedReason,
    imageFailureCount: playable ? 0 : 1,
    lastImageCheck: new Date(),
  };
}

async function dealableIds(): Promise<string[]> {
  const rows = await db
    .select({ id: playableCards.id })
    .from(playableCards)
    .where(and(inArray(playableCards.id, cardIds), eligibleDealFilter("playable_cards")));
  return rows.map((row) => row.id);
}

async function quarantineRefused(): Promise<void> {
  writeMaskFailureSidecar(refusedId, "name_plate_unresolved", dir);
  await db.update(playableCards).set({
    isPlayable: false,
    blockedReason: "mask_name_uncovered",
    quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
    imageUrl: `https://packpts.com/cards/${refusedId}.jpg`,
  }).where(eq(playableCards.id, refusedId));
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mask-refusal-"));
  setMaskReadySidecarDirForTests(dir);
  await db.insert(gameSets).values({
    id: setId,
    sport: "basketball",
    brand: "Fleer",
    year: 1986,
    setName: `Mask refusal ${stamp}`,
    isActive: true,
    isUserCreated: false,
  });
  await db.insert(playableCards).values([
    row(refusedId, "Michael Jordan", false, "mask_name_uncovered"),
    row(imageFailId, "Image Only", false, "image_validation_failed"),
    row(bakedId, "Baked Ok", true, null),
    row(spareId, "Spare Hand", true, null),
  ]);
  writeMaskFailureSidecar(refusedId, "name_plate_unresolved", dir);
});

afterAll(async () => {
  setMaskReadySidecarDirForTests(null);
  await db.delete(dailyChallengeCards).where(inArray(dailyChallengeCards.dailyChallengeId, challengeIds));
  await db.delete(dailyChallenges).where(inArray(dailyChallenges.id, challengeIds));
  await db.delete(playableCards).where(inArray(playableCards.id, cardIds));
  await db.delete(gameSets).where(eq(gameSets.id, setId));
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("current mask refusal stays non-dealable", () => {
  it("does not let card pool refresh flip a refused card to playable", async () => {
    expect(CURRENT_MASK_VERSION).toBe("v4.6");
    await quarantineRefused();
    const candidates = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(and(inArray(playableCards.id, [refusedId, imageFailId]), cardPoolRefreshCandidateFilter()));
    expect(candidates.map((row) => row.id)).toEqual([imageFailId]);
    const nextUrl = "https://packpts.com/cards/refreshed.jpg";
    const restored = await restorePlayableIfMaskAllows(
      { id: refusedId, blockedReason: "mask_name_uncovered" },
      nextUrl,
    );
    expect(restored).toBe(false);

    const [refused] = await db
      .select({
        isPlayable: playableCards.isPlayable,
        blockedReason: playableCards.blockedReason,
        imageUrl: playableCards.imageUrl,
      })
      .from(playableCards)
      .where(eq(playableCards.id, refusedId));
    expect(refused.isPlayable).toBe(false);
    expect(refused.blockedReason).toBe("mask_name_uncovered");
    expect(refused.imageUrl).toBe(`https://packpts.com/cards/${refusedId}.jpg`);

    const imageRestored = await restorePlayableIfMaskAllows(
      { id: imageFailId, blockedReason: "image_validation_failed" },
      nextUrl,
    );
    expect(imageRestored).toBe(true);
    const [imageRow] = await db
      .select({
        isPlayable: playableCards.isPlayable,
        blockedReason: playableCards.blockedReason,
        imageUrl: playableCards.imageUrl,
      })
      .from(playableCards)
      .where(eq(playableCards.id, imageFailId));
    expect(imageRow.isPlayable).toBe(true);
    expect(imageRow.blockedReason).toBeNull();
    expect(imageRow.imageUrl).toBe(nextUrl);
  });

  it("swaps a refused card in a stored future hand and leaves a past hand", async () => {
    writeMaskFailureSidecar(refusedId, "name_plate_unresolved", dir);
    await db.update(playableCards).set({
      isPlayable: true,
      blockedReason: null,
      quarantineStatus: "OK",
    }).where(eq(playableCards.id, refusedId));

    const stale = await db
      .select({ id: dailyChallenges.id })
      .from(dailyChallenges)
      .where(inArray(dailyChallenges.date, [futureDate, pastDate]));
    if (stale.length > 0) {
      const staleIds = stale.map((row) => row.id);
      await db.delete(dailyChallengeCards).where(inArray(dailyChallengeCards.dailyChallengeId, staleIds));
      await db.delete(dailyChallenges).where(inArray(dailyChallenges.id, staleIds));
    }

    const [future] = await db.insert(dailyChallenges).values({
      date: futureDate,
      mode: "DAILY5",
      setId,
      seed: `mask-refusal-future-${stamp}`,
      startsAt: new Date(`${futureDate}T00:00:00.000Z`),
      endsAt: new Date("2999-08-27T00:00:00.000Z"),
      status: "SCHEDULED",
    }).returning();
    const [past] = await db.insert(dailyChallenges).values({
      date: pastDate,
      mode: "DAILY5",
      setId,
      seed: `mask-refusal-past-${stamp}`,
      startsAt: new Date(`${pastDate}T00:00:00.000Z`),
      endsAt: new Date("2998-12-02T00:00:00.000Z"),
      status: "CLOSED",
    }).returning();
    challengeIds.push(future.id, past.id);
    await db.insert(dailyChallengeCards).values([
      {
        dailyChallengeId: future.id,
        position: 1,
        cardId: refusedId,
        correctAnswer: "Michael Jordan",
        choices: ["Michael Jordan", "Spare Hand", "Baked Ok", "Image Only"],
        pointValue: 100,
      },
      {
        dailyChallengeId: past.id,
        position: 1,
        cardId: refusedId,
        correctAnswer: "Michael Jordan",
        choices: ["Michael Jordan", "Spare Hand", "Baked Ok", "Image Only"],
        pointValue: 100,
      },
    ]);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sweepBlockedDaily5Deals(today);
    const lines = spy.mock.calls.map((call) => String(call[0]));
    spy.mockRestore();

    const swapped = lines.find((line) => line.startsWith(`[Daily5] mask refusal swapped date=${futureDate} `));
    expect(swapped).toMatch(new RegExp(
      `^\\[Daily5\\] mask refusal swapped date=${futureDate} slot=1 old=${refusedId} new=[0-9a-f-]{36} reason=name_plate_unresolved$`,
    ));
    expect(lines.some((line) => line.includes(pastDate))).toBe(false);
    const newId = swapped!.split(" new=")[1].split(" ")[0];
    expect(newId).not.toBe(refusedId);

    const [futureRow] = await db
      .select({ cardId: dailyChallengeCards.cardId, correctAnswer: dailyChallengeCards.correctAnswer })
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, future.id));
    const [pastRow] = await db
      .select({ cardId: dailyChallengeCards.cardId })
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, past.id));
    expect(futureRow.cardId).toBe(newId);
    expect(futureRow.correctAnswer).not.toBe("Michael Jordan");
    expect(pastRow.cardId).toBe(refusedId);
  });

  it("keeps a card dealable after the current mask version bake succeeds", async () => {
    writeMaskFailureSidecar(refusedId, "name_plate_unresolved", dir);
    await db.update(playableCards).set({
      isPlayable: true,
      blockedReason: null,
      quarantineStatus: "OK",
    }).where(eq(playableCards.id, refusedId));

    const before = await dealableIds();
    expect(before).toContain(bakedId);
    expect(before).not.toContain(refusedId);

    clearMaskFailureSidecar(refusedId, dir);
    await db.update(playableCards).set({
      isPlayable: true,
      blockedReason: null,
      quarantineStatus: "OK",
    }).where(eq(playableCards.id, refusedId));

    const after = await dealableIds();
    expect(after).toContain(bakedId);
    expect(after).toContain(refusedId);
  });
});
