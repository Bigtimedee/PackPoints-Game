/**
 * A missing expansion set joins Daily 5 only with an active release manifest
 * and a clear hold. The deal is the manifest's released members that also
 * pass eligibleDealFilter, including card review. Held, unreleased, and
 * excluded sets stay out. Bare registry slugs follow the same gate.
 */
import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  cardReviewApprovals,
  dailyChallengeCards,
  dailyChallenges,
  discoveryCohortMembers,
  discoveryCohorts,
  expansionReleaseManifests,
  expansionReleaseMembers,
  gameSets,
  playableCards,
} from "@shared/schema";
import { isHeldSet, refreshHeldSets } from "../config/heldSets";
import { cardReviewGuardEnabled, setCardReviewGuardEnabled } from "../lib/cardReviewGuard";
import {
  daily5ExpansionSkipReason,
  daily5ExpansionSkipReasonFromFacts,
  releasedExpansionIdForSlug,
  releasedExpansionRotationIds,
} from "../services/baseballExpansion/daily5Enrollment";
import { listExpansionInventory } from "../services/baseballExpansion/inventory";
import { insertIntegratedGameSet } from "../services/baseballExpansion/createIntegratedSet";
import { DAILY5_EXCLUDED_EXPANSION_IDS, expansionTargetBySlug } from "../services/baseballExpansion/registry";
import { daily5CalendarConfig, daily5ConfigForDate, scheduledDaily5Set } from "../services/daily5Calendar";
import { loadDaily5Pool } from "../services/daily5Pool";
import { daily5Service } from "../services/daily5Service";
import { resolveDaily5SetForDate } from "../services/daily5SetPick";
import { decorateSpaIndexPage } from "../lib/spaIndexHtml";
import { handlePublicSetDetail } from "../services/publicSets";

const SET = "7bb0e667-46ce-5cfe-a76c-a51044756725";
const SLUG = "1990-fleer-baseball";
const UNRELEASED = "49e656e0-3762-5113-82b5-1480f1c77541";
const EXCLUDED = DAILY5_EXCLUDED_EXPANSION_IDS[0]!;
const FALLBACK = "229f0379-aa56-40a8-abe3-1af217a397e8";
const DAY = "2098-06-02";
const HASH = "ab".repeat(32);

const releasedApproved = [1, 2, 3, 4, 5].map((n) => cardId(n));
const releasedUnapproved = cardId(6);
const unreleasedApproved = cardId(7);
const allCards = [...releasedApproved, releasedUnapproved, unreleasedApproved];
const manifestMembers = [...releasedApproved, releasedUnapproved];

function cardId(n: number): string {
  return `7bb0e667-46ce-4cfe-a76c-${String(n).padStart(12, "0")}`;
}

function memberKey(card: string): string {
  return `d5exp:${card}`;
}

function capture() {
  const box: { status?: number; body?: { id?: string } } = {};
  const res = {
    headersSent: false,
    status(code: number) { box.status = code; return res; },
    json(body: { id?: string }) { box.body = body; return res; },
    setHeader() { return res; },
    removeHeader() { return res; },
    end() { res.headersSent = true; return res; },
  };
  return { box, res };
}

async function resetRows(): Promise<void> {
  const [challenge] = await db.select({ id: dailyChallenges.id }).from(dailyChallenges).where(eq(dailyChallenges.date, DAY)).limit(1);
  if (challenge) {
    await db.delete(dailyChallengeCards).where(eq(dailyChallengeCards.dailyChallengeId, challenge.id));
    await db.delete(dailyChallenges).where(eq(dailyChallenges.id, challenge.id));
  }
  await db.delete(cardReviewApprovals).where(inArray(cardReviewApprovals.cardId, allCards));
  await db.delete(expansionReleaseMembers).where(eq(expansionReleaseMembers.setId, SET));
  await db.delete(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, SET));
  await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, SET));
  await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, SET));
  await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
  await db.delete(playableCards).where(inArray(playableCards.id, allCards));
}

describe("released expansion sets in Daily 5", () => {
  const guardWas = cardReviewGuardEnabled();
  let createdSet = false;

  afterAll(async () => {
    setCardReviewGuardEnabled(guardWas);
    await resetRows();
    if (createdSet) {
      await db.delete(playableCards).where(eq(playableCards.gameSetId, SET));
      await db.delete(gameSets).where(eq(gameSets.id, SET));
    }
    await refreshHeldSets();
  });

  it("keeps held, unreleased, unknown, and excluded sets blocked", () => {
    expect(expansionTargetBySlug(SLUG)?.id).toBe(SET);
    expect(expansionTargetBySlug("1991-upper-deck-baseball")?.id).toBe(EXCLUDED);
    expect(daily5ExpansionSkipReasonFromFacts({
      registry: "missing", excluded: false, release: "active", held: "no",
    })).toBeNull();
    expect(daily5ExpansionSkipReasonFromFacts({
      registry: "missing", excluded: false, release: "active", held: "yes",
    })).toBe("held");
    expect(daily5ExpansionSkipReasonFromFacts({
      registry: "missing", excluded: false, release: "inactive", held: "no",
    })).toBe("expansion_not_enrolled");
    expect(daily5ExpansionSkipReasonFromFacts({
      registry: "missing", excluded: false, release: "unknown", held: "no",
    })).toBe("expansion_not_enrolled");
    expect(daily5ExpansionSkipReasonFromFacts({
      registry: "missing", excluded: false, release: "active", held: "unknown",
    })).toBe("expansion_not_enrolled");
    expect(daily5ExpansionSkipReasonFromFacts({
      registry: "missing", excluded: true, release: "active", held: "no",
    })).toBe("expansion_not_enrolled");
    expect(daily5ExpansionSkipReasonFromFacts({
      registry: "live", excluded: false, release: "inactive", held: "yes",
    })).toBeNull();
  });

  it("deals only released card-review-approved members and opens the bare slug", async () => {
    await resetRows();
    const inserted = await insertIntegratedGameSet({
      id: SET,
      sport: "baseball",
      brand: "Fleer",
      year: 1990,
      setName: "1990 Fleer Baseball",
      isActive: true,
    });
    createdSet = inserted.created;
    expect(inserted.id).toBe(SET);

    await db.insert(playableCards).values(allCards.map((id, index) => ({
      id,
      gameSetId: SET,
      cardhedgeCardId: `d5exp:${id}`,
      player: `Fixture Player ${index + 1}`,
      set: "1990 Fleer Baseball",
      number: String(200 + index),
      variant: "Base",
      imageUrl: `https://packpts.com/cards/${id}.jpg`,
      category: "Baseball",
      isPlayable: true,
      contentVerified: true,
    })));
    await db.insert(discoveryCohorts).values({
      setId: SET,
      artifactSha256: HASH,
      membershipSha256: HASH,
      originalCount: allCards.length,
      checklistCount: 660,
    });
    await db.insert(discoveryCohortMembers).values(allCards.map((id, index) => ({
      memberKey: memberKey(id),
      setId: SET,
      ordinal: index + 1,
      cardNumber: String(200 + index),
      supplierId: `d5exp-supplier-${index + 1}`,
      originalSha256: HASH,
      originalWidth: 40,
      originalHeight: 60,
      originalBytes: 8,
      disposition: "pass-candidate",
      routing: "synthetic",
      playableCardId: id,
    })));
    const manifestId = randomUUID();
    await db.insert(expansionReleaseManifests).values({
      id: manifestId,
      setId: SET,
      version: 1,
      evidenceRef: "daily5-expansion-test",
      clearedBy: "reviewer",
      memberCount: 35,
      releasedMembershipSha256: HASH,
      discoveryMembershipSha256: HASH,
    });
    await db.insert(expansionReleaseMembers).values(manifestMembers.map((id) => ({
      manifestId,
      memberKey: memberKey(id),
      setId: SET,
      sourceSha256: HASH,
      nativeSha256: HASH,
      preview300Sha256: HASH,
      polygonSha256: HASH,
      rendererId: "renderMeasuredProposal@" + "a".repeat(40),
      proposalId: randomUUID(),
    })));
    await db.insert(cardReviewApprovals).values([...releasedApproved, unreleasedApproved].map((id) => ({
      cardId: id,
      gameSetId: SET,
      source: "qa",
      approvedBy: "reviewer",
    })));

    setCardReviewGuardEnabled(true);
    await refreshHeldSets();
    expect(isHeldSet(SET)).toBe(false);
    expect(await daily5ExpansionSkipReason(SET)).toBeNull();
    expect(await daily5ExpansionSkipReason(UNRELEASED)).toBe("expansion_not_enrolled");
    expect(await daily5ExpansionSkipReason(EXCLUDED)).toBe("expansion_not_enrolled");

    const inventory = await listExpansionInventory();
    expect(inventory.sets.find((row) => row.slug === SLUG)?.daily5Blocked).toBe(false);
    expect(inventory.sets.find((row) => row.slug === SLUG)?.role).toBe("missing");
    expect(inventory.sets.find((row) => row.setId === UNRELEASED)?.daily5Blocked).toBe(true);
    expect(inventory.sets.find((row) => row.setId === EXCLUDED)?.daily5Blocked).toBe(true);

    const pool = await loadDaily5Pool(SET);
    const dealtIds = new Set(pool.filtered.map((card) => card.id));
    expect([...dealtIds].sort()).toEqual([...releasedApproved].sort());
    expect(dealtIds.has(releasedUnapproved)).toBe(false);
    expect(dealtIds.has(unreleasedApproved)).toBe(false);

    const [challenge] = await db.insert(dailyChallenges).values({
      date: DAY,
      mode: "DAILY5",
      setId: SET,
      seed: "d5-expansion-release",
      startsAt: new Date(`${DAY}T00:00:00.000Z`),
      endsAt: new Date("2098-06-03T00:00:00.000Z"),
      status: "SCHEDULED",
    }).returning();
    await daily5Service.selectCardsForChallenge(challenge!, SET, challenge!.seed);
    const hand = await db.select({ cardId: dailyChallengeCards.cardId }).from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, challenge!.id));
    expect(hand).toHaveLength(5);
    expect(hand.map((row) => row.cardId).sort()).toEqual([...releasedApproved].sort());

    const choice = await resolveDaily5SetForDate("2026-11-16", {
      config: () => ({ greenSetIds: [SET], fallbackSetId: FALLBACK }),
      legacyPick: async () => ({ id: FALLBACK, setName: "Fallback" }),
      refreshHeld: async () => { await refreshHeldSets(); },
      isHeld: (id) => isHeldSet(id),
      describe: async (id) => ({ id, setName: id === SET ? "1990 Fleer Baseball" : "Fallback", isActive: true, isUserCreated: false }),
      dealableCount: async (id) => (id === SET ? (await loadDaily5Pool(id)).filtered.length : 100),
    });
    expect(choice).toMatchObject({ id: SET, source: "scheduled", dealableCount: 5, skipped: [] });

    const blocked = await resolveDaily5SetForDate("2026-10-05", {
      config: () => ({ greenSetIds: [UNRELEASED], fallbackSetId: FALLBACK }),
      legacyPick: async () => ({ id: FALLBACK, setName: "Fallback" }),
      refreshHeld: async () => {},
      isHeld: () => false,
      describe: async (id) => ({ id, setName: "scheduled", isActive: true, isUserCreated: false }),
      dealableCount: async () => 100,
    });
    expect(blocked?.id).not.toBe(UNRELEASED);
    expect(blocked?.skipped).toContainEqual({ id: UNRELEASED, reason: "expansion_not_enrolled" });

    const excludedChoice = await resolveDaily5SetForDate("2026-10-05", {
      config: () => ({ greenSetIds: [EXCLUDED], fallbackSetId: FALLBACK }),
      legacyPick: async () => ({ id: FALLBACK, setName: "Fallback" }),
      refreshHeld: async () => {},
      isHeld: () => false,
      describe: async (id) => ({ id, setName: "scheduled", isActive: true, isUserCreated: false }),
      dealableCount: async () => 100,
    });
    expect(excludedChoice?.id).not.toBe(EXCLUDED);
    expect(excludedChoice?.skipped).toContainEqual({ id: EXCLUDED, reason: "expansion_not_enrolled" });

    const rotation = await releasedExpansionRotationIds();
    expect(rotation).toContain(SET);
    expect(rotation).not.toContain(EXCLUDED);
    const base = daily5CalendarConfig({});
    expect(scheduledDaily5Set("2026-11-10", daily5ConfigForDate("2026-11-10", base, rotation))!.setId)
      .toBe(scheduledDaily5Set("2026-11-10", base)!.setId);
    const later = daily5ConfigForDate("2026-11-17", base, rotation);
    expect(later.greenSetIds.slice(0, base.greenSetIds.length)).toEqual(base.greenSetIds);
    expect(later.greenSetIds).toContain(SET);
    expect(scheduledDaily5Set("2026-11-16", later)!.setId).toBe(base.greenSetIds[0]);

    expect(await releasedExpansionIdForSlug(SLUG)).toBe(SET);
    expect(await releasedExpansionIdForSlug("1991-upper-deck-baseball")).toBeNull();
    const detail = capture();
    await handlePublicSetDetail({ params: { id: SLUG }, headers: {} } as never, detail.res as never);
    expect(detail.box.status ?? 200).toBe(200);
    expect(detail.box.body?.id).toBe(SET);
    const byId = capture();
    await handlePublicSetDetail({ params: { id: SET }, headers: {} } as never, byId.res as never);
    expect(byId.box.status ?? 200).toBe(200);
    const shell = "<html><head><title>x</title></head><body><div id=\"root\"></div></body></html>";
    const page = await decorateSpaIndexPage(shell, `/sets/${SLUG}`);
    expect(page.status).toBe(200);
    expect(page.html).not.toContain("Page not found");

    await db.delete(expansionReleaseMembers).where(eq(expansionReleaseMembers.manifestId, manifestId));
    await db.delete(expansionReleaseManifests).where(eq(expansionReleaseManifests.id, manifestId));
    await refreshHeldSets();
    expect(isHeldSet(SET)).toBe(true);
    expect(await daily5ExpansionSkipReason(SET)).toBe("expansion_not_enrolled");
    expect(await releasedExpansionIdForSlug(SLUG)).toBeNull();
    const heldDetail = capture();
    await handlePublicSetDetail({ params: { id: SLUG }, headers: {} } as never, heldDetail.res as never);
    expect(heldDetail.box.status).toBe(404);
    const heldPage = await decorateSpaIndexPage(shell, `/sets/${SLUG}`);
    expect(heldPage.status).toBe(404);
    const after = await listExpansionInventory();
    expect(after.sets.find((row) => row.slug === SLUG)?.daily5Blocked).toBe(true);
  });
});
