/**
 * growthFlywheel.test.ts
 *
 * Vitest integration tests for the Growth Flywheel rollup service.
 * Seeds event tables with known data, runs computeRollup(), then asserts
 * that global_growth_rollups and user_growth_rollups contain correct values.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import {
  users,
  gameplayEvents,
  dailyChallengeEntries,
  shareEvents,
  referralLinks,
  referralAttributions,
  globalGrowthRollups,
  userGrowthRollups,
  dailyChallenges,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { computeRollup } from "../services/growthFlywheel/rollup";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DAY_KEY = "2099-06-15"; // Far future so it never collides with real data
const DAY_START = new Date(`${DAY_KEY}T00:00:00.000Z`);
const DAY_MID = new Date(`${DAY_KEY}T12:00:00.000Z`);

// We'll seed 3 users: userA, userB, userC
let userAId: string;
let userBId: string;
let userCId: string;
let challengeId: string;
let inviteLinkId: string;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  userAId = randomUUID();
  userBId = randomUUID();
  userCId = randomUUID();
  challengeId = randomUUID();
  inviteLinkId = randomUUID();

  // Insert test users
  await db.insert(users).values([
    { id: userAId, username: "flywheel_userA", email: `${userAId}@test.invalid` },
    { id: userBId, username: "flywheel_userB", email: `${userBId}@test.invalid` },
    { id: userCId, username: "flywheel_userC", email: `${userCId}@test.invalid` },
  ]);

  // gameplay_events: userA and userB each have MATCH_END (DAU=2), userA plays 2 matches
  await db.insert(gameplayEvents).values([
    { id: randomUUID(), userId: userAId, matchId: randomUUID(), eventType: "MATCH_END", createdAt: DAY_START },
    { id: randomUUID(), userId: userAId, matchId: randomUUID(), eventType: "MATCH_END", createdAt: DAY_MID },
    { id: randomUUID(), userId: userBId, matchId: randomUUID(), eventType: "MATCH_END", createdAt: DAY_START },
  ]);

  // daily_challenge_entries: userA completes the daily challenge once
  await db.insert(dailyChallenges).values({
    id: challengeId,
    date: DAY_KEY,
    seed: "test-seed",
    startsAt: DAY_START,
    endsAt: new Date(DAY_START.getTime() + 86_400_000),
    status: "ACTIVE",
  });
  await db.insert(dailyChallengeEntries).values({
    id: randomUUID(),
    dailyChallengeId: challengeId,
    userId: userAId,
    score: 100,
    correctCount: 5,
    completedAt: DAY_MID,
  });

  // share_events: userA shares 2 times, userB shares 1 time
  await db.insert(shareEvents).values([
    { id: randomUUID(), userId: userAId, shareType: "SCORE_CARD", target: "COPY_LINK", createdAt: DAY_START },
    { id: randomUUID(), userId: userAId, shareType: "LEADERBOARD_CARD", target: "COPY_LINK", createdAt: DAY_MID },
    { id: randomUUID(), userId: userBId, shareType: "SCORE_CARD", target: "COPY_LINK", createdAt: DAY_START },
  ]);

  // referral_links: userA creates 1 INVITE link
  await db.insert(referralLinks).values({
    id: inviteLinkId,
    code: `inv-${inviteLinkId.slice(0, 8)}`,
    createdByUserId: userAId,
    purpose: "INVITE",
    destinationPath: "/",
    createdAt: DAY_START,
  });

  // referral_attributions: userC signed up via userA's invite; also got FIRST_MATCH
  await db.insert(referralAttributions).values([
    {
      id: randomUUID(),
      referralLinkId: inviteLinkId,
      invitedUserId: userCId,
      eventType: "SIGNUP",
      createdAt: DAY_MID,
    },
    {
      id: randomUUID(),
      referralLinkId: inviteLinkId,
      invitedUserId: userCId,
      eventType: "FIRST_MATCH",
      createdAt: DAY_MID,
    },
  ]);
});

afterAll(async () => {
  // Clean up in reverse FK order
  await db.delete(referralAttributions).where(eq(referralAttributions.referralLinkId, inviteLinkId));
  await db.delete(referralLinks).where(eq(referralLinks.id, inviteLinkId));
  await db.delete(shareEvents).where(eq(shareEvents.userId, userAId));
  await db.delete(shareEvents).where(eq(shareEvents.userId, userBId));
  await db.delete(dailyChallengeEntries).where(eq(dailyChallengeEntries.dailyChallengeId, challengeId));
  await db.delete(dailyChallenges).where(eq(dailyChallenges.id, challengeId));
  await db.delete(gameplayEvents).where(eq(gameplayEvents.userId, userAId));
  await db.delete(gameplayEvents).where(eq(gameplayEvents.userId, userBId));
  await db.delete(userGrowthRollups).where(eq(userGrowthRollups.dayKey, DAY_KEY));
  await db.delete(globalGrowthRollups).where(eq(globalGrowthRollups.dayKey, DAY_KEY));
  await db.delete(users).where(eq(users.id, userAId));
  await db.delete(users).where(eq(users.id, userBId));
  await db.delete(users).where(eq(users.id, userCId));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeRollup — global metrics", () => {
  let result: { dayKey: string; dau: number };

  beforeAll(async () => {
    result = await computeRollup(DAY_KEY);
  });

  it("returns the correct dayKey", () => {
    expect(result.dayKey).toBe(DAY_KEY);
  });

  it("returns DAU = 2 (two distinct users with MATCH_END)", () => {
    expect(result.dau).toBe(2);
  });

  it("persists correct global rollup row", async () => {
    const [row] = await db
      .select()
      .from(globalGrowthRollups)
      .where(eq(globalGrowthRollups.dayKey, DAY_KEY))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.dau).toBe(2);
    expect(row.matchesPlayed).toBe(3); // 2 from userA + 1 from userB
    expect(row.daily5Entries).toBe(1);
    expect(row.sharesTotal).toBe(3);
    expect(row.invitesSent).toBe(1);
    expect(row.signupsFromInvites).toBe(1);
    expect(row.firstMatchesFromInvites).toBe(1);
    expect(row.firstPurchasesFromInvites).toBe(0);
  });

  it("computes kFactor = signupsFromInvites / dau = 0.5", async () => {
    const [row] = await db
      .select()
      .from(globalGrowthRollups)
      .where(eq(globalGrowthRollups.dayKey, DAY_KEY))
      .limit(1);

    expect(row.kFactor).toBeCloseTo(0.5, 5);
  });
});

describe("computeRollup — per-user metrics", () => {
  it("userA has correct per-user rollup", async () => {
    const [row] = await db
      .select()
      .from(userGrowthRollups)
      .where(and(eq(userGrowthRollups.userId, userAId), eq(userGrowthRollups.dayKey, DAY_KEY)))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.matchesPlayed).toBe(2);
    expect(row.daily5Entries).toBe(1);
    expect(row.sharesTotal).toBe(2);
    expect(row.invitesSent).toBe(1);
    expect(row.signupsFromInvites).toBe(1);
  });

  it("userB has correct per-user rollup", async () => {
    const [row] = await db
      .select()
      .from(userGrowthRollups)
      .where(and(eq(userGrowthRollups.userId, userBId), eq(userGrowthRollups.dayKey, DAY_KEY)))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.matchesPlayed).toBe(1);
    expect(row.daily5Entries).toBe(0);
    expect(row.sharesTotal).toBe(1);
    expect(row.invitesSent).toBe(0);
    expect(row.signupsFromInvites).toBe(0);
  });

  it("userC has no per-user rollup (no active events that day)", async () => {
    const rows = await db
      .select()
      .from(userGrowthRollups)
      .where(and(eq(userGrowthRollups.userId, userCId), eq(userGrowthRollups.dayKey, DAY_KEY)));

    expect(rows).toHaveLength(0);
  });
});

describe("computeRollup — idempotency", () => {
  it("re-running computeRollup for the same day produces identical results", async () => {
    const second = await computeRollup(DAY_KEY);
    expect(second.dau).toBe(2);

    const [row] = await db
      .select()
      .from(globalGrowthRollups)
      .where(eq(globalGrowthRollups.dayKey, DAY_KEY))
      .limit(1);

    expect(row.matchesPlayed).toBe(3);
    expect(row.signupsFromInvites).toBe(1);
  });
});
