/**
 * A stored Daily 5 hand drops a card that left the active expansion manifest.
 * Live sets are unchanged. A past date is left alone.
 */
import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";

const { db } = await import("../db");
const {
  dailyChallengeCards,
  dailyChallenges,
  discoveryCohortMembers,
  discoveryCohorts,
  expansionReleaseManifests,
  expansionReleaseMembers,
  playableCards,
} = await import("@shared/schema");
const { insertIntegratedGameSet } = await import("../services/baseballExpansion/createIntegratedSet");
const { replaceBlockedDaily5Cards } = await import("../lib/cardBlocklist");

const SET = "eb88c57e-cbd5-5d4b-a223-37b8fa8f99c2";
const TODAY = "2094-06-10";
const PAST = "2094-06-01";

type HandCard = { id: string; player: string; memberKey: string; onManifest: boolean };

function makeCard(n: number, onManifest: boolean): HandCard {
  const id = randomUUID();
  const sha = n.toString(16).padStart(64, "a");
  return { id, player: `Release Player ${n}`, memberKey: `candidate-${String(n).padStart(4, "0")}|${sha}`, onManifest };
}

const cards = [1, 2, 3, 4, 5, 6].map((n) => makeCard(n, n !== 1));
const dropped = cards[0]!;
const spare = cards[5]!;
const challengeIds: string[] = [];

async function reset(): Promise<void> {
  if (challengeIds.length > 0) {
    await db.delete(dailyChallengeCards).where(inArray(dailyChallengeCards.dailyChallengeId, challengeIds));
    await db.delete(dailyChallenges).where(inArray(dailyChallenges.id, challengeIds));
  }
  await db.delete(expansionReleaseMembers).where(eq(expansionReleaseMembers.setId, SET));
  await db.delete(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, SET));
  await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, SET));
  await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
  await db.delete(playableCards).where(inArray(playableCards.id, cards.map((card) => card.id)));
}

async function hand(date: string, picked: HandCard[]): Promise<string> {
  const [challenge] = await db.insert(dailyChallenges).values({
    date,
    mode: "DAILY5",
    setId: SET,
    seed: `release-swap-${date}`,
    startsAt: new Date(`${date}T00:00:00.000Z`),
    endsAt: new Date(`${date}T23:00:00.000Z`),
    status: date < TODAY ? "CLOSED" : "ACTIVE",
  }).returning({ id: dailyChallenges.id });
  challengeIds.push(challenge.id);
  await db.insert(dailyChallengeCards).values(picked.map((card, index) => ({
    dailyChallengeId: challenge.id,
    position: index + 1,
    cardId: card.id,
    correctAnswer: card.player,
    choices: [card.player, "Other One", "Other Two", "Other Three"],
    pointValue: 100,
  })));
  return challenge.id;
}

describe("Daily 5 swaps a card that left the active expansion manifest", () => {
  afterAll(async () => {
    await reset();
  });

  it("swaps a removed member, leaves a past hand, and refuses a revoked set", async () => {
    await reset();
    await insertIntegratedGameSet({
      id: SET, sport: "baseball", brand: "Upper Deck", year: 1989, setName: "1989 Upper Deck Baseball",
      isActive: true, cardhedgeSetQuery: "1989 Upper Deck Baseball", cardhedgeCategory: "Baseball",
    });
    await db.insert(playableCards).values(cards.map((card) => ({
      id: card.id,
      gameSetId: SET,
      cardhedgeCardId: `release-swap:${card.id}`,
      player: card.player,
      set: "1989 Upper Deck Baseball",
      number: card.memberKey.slice(10, 14),
      imageUrl: `https://packpts.com/cards/${card.id}.jpg`,
      category: "Baseball",
      isPlayable: true,
      contentVerified: true,
      imageReviewStatus: "approved",
    })));
    const membershipSha = "ab".repeat(32);
    await db.insert(discoveryCohorts).values({
      setId: SET,
      artifactSha256: "cd".repeat(32),
      membershipSha256: membershipSha,
      originalCount: cards.length,
      checklistCount: 800,
    });
    await db.insert(discoveryCohortMembers).values(cards.map((card, index) => ({
      memberKey: card.memberKey,
      setId: SET,
      ordinal: index + 1,
      cardNumber: String(index + 1),
      supplierId: `release-swap-${index + 1}`,
      originalSha256: card.memberKey.split("|")[1]!,
      originalWidth: 40,
      originalHeight: 60,
      originalBytes: 100,
      disposition: "pass-candidate",
      routing: "ordinary-canonical-candidate",
      playableCardId: card.id,
    })));
    const [manifest] = await db.insert(expansionReleaseManifests).values({
      setId: SET,
      version: 1,
      evidenceRef: "evidence-daily-swap",
      clearedBy: "reviewer",
      memberCount: 35,
      releasedMembershipSha256: "ef".repeat(32),
      discoveryMembershipSha256: membershipSha,
    }).returning({ id: expansionReleaseManifests.id });
    await db.insert(expansionReleaseMembers).values(cards.filter((card) => card.onManifest).map((card) => ({
      manifestId: manifest.id,
      memberKey: card.memberKey,
      setId: SET,
      sourceSha256: card.memberKey.split("|")[1]!,
      nativeSha256: "11".repeat(32),
      preview300Sha256: "22".repeat(32),
      polygonSha256: "33".repeat(32),
      rendererId: "renderMeasuredProposal@069e08e8391b1781005930a21ec524e4e5f2ba2b",
      proposalId: randomUUID(),
    })));

    const releasedHand = cards.filter((card) => card.onManifest).slice(0, 5);
    const steady = await hand(TODAY, releasedHand);
    expect(await replaceBlockedDaily5Cards(steady, TODAY)).toBe(0);
    const steadyRows = await db.select({ cardId: dailyChallengeCards.cardId }).from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, steady)).orderBy(asc(dailyChallengeCards.position));
    expect(steadyRows.map((row) => row.cardId)).toEqual(releasedHand.map((card) => card.id));

    const live = await hand("2094-06-11", [dropped, ...cards.filter((card) => card.onManifest).slice(0, 4)]);
    const past = await hand(PAST, [dropped, ...cards.filter((card) => card.onManifest).slice(0, 4)]);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const left = await replaceBlockedDaily5Cards(live, TODAY);
    const pastLeft = await replaceBlockedDaily5Cards(past, TODAY);
    const lines = spy.mock.calls.map((call) => String(call[0]));
    spy.mockRestore();
    expect(left).toBe(0);
    expect(pastLeft).toBe(0);
    expect(lines.some((line) => line.startsWith(`[Daily5] release manifest swapped date=2094-06-11 slot=1 old=${dropped.id} `))).toBe(true);
    expect(lines.some((line) => line.includes(PAST))).toBe(false);
    const [swapped] = await db.select({
      cardId: dailyChallengeCards.cardId,
      correctAnswer: dailyChallengeCards.correctAnswer,
      choices: dailyChallengeCards.choices,
    }).from(dailyChallengeCards).where(and(
      eq(dailyChallengeCards.dailyChallengeId, live),
      eq(dailyChallengeCards.position, 1),
    ));
    expect(swapped.cardId).not.toBe(dropped.id);
    expect(cards.filter((card) => card.onManifest).map((card) => card.id)).toContain(swapped.cardId);
    expect(swapped.cardId).toBe(spare.id);
    expect(swapped.correctAnswer).toBe(spare.player);
    expect((swapped.choices as string[]).join(" ")).not.toContain(dropped.player);
    const [pastRow] = await db.select({ cardId: dailyChallengeCards.cardId }).from(dailyChallengeCards).where(and(
      eq(dailyChallengeCards.dailyChallengeId, past),
      eq(dailyChallengeCards.position, 1),
    ));
    expect(pastRow.cardId).toBe(dropped.id);

    await db.update(expansionReleaseManifests).set({ revokedAt: new Date(), revokedBy: "reviewer" }).where(eq(expansionReleaseManifests.id, manifest.id));
    const revoked = await hand("2094-06-12", releasedHand);
    expect(await replaceBlockedDaily5Cards(revoked, TODAY)).toBe(releasedHand.length);
    const revokedRows = await db.select({ cardId: dailyChallengeCards.cardId }).from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, revoked)).orderBy(asc(dailyChallengeCards.position));
    expect(revokedRows.map((row) => row.cardId)).toEqual(releasedHand.map((card) => card.id));
  });
});
