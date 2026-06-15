/**
 * rewardEngine.test.ts — Prompt 10 (DB integration subset)
 *
 * Tests awardPoints cap enforcement against a real database.
 * Runs in CI (postgres:16 service) where DATABASE_URL is available.
 * Pure-function tests live in rewardEnginePure.test.ts (no DB required).
 *
 * Covers:
 *   - Frozen user returns 0 pts + account_frozen reason
 *   - Idempotency: second call with same matchId+questionId returns null
 *   - dailyPointsCap reached: returns 0 pts + daily_cap_reached reason
 *   - dailyPointsCap partial: award trimmed to remaining daily budget
 *   - perMatchPointsCap reached: returns 0 pts + match_cap_reached reason
 *   - Normal award: finalPts within [minPts, maxAwardCap]
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../db';
import {
  users,
  wallets,
  ledgerEntries,
  pointsAwards,
  userPointsCounters,
  matchPointsCounters,
  userRiskState,
  playerFame,
  packptsBucket,
  packptsSpendAllocation,
} from '@shared/schema';
import {
  awardPoints,
  seedRewardPolicy,
  clearPolicyCache,
  type CardContext,
} from '../services/rewardEngine';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

describe('awardPoints (DB integration)', () => {
  let testUserId: string;

  const TEST_CARD: CardContext = {
    playerName: 'Test Player',
    cardId: 'reward-test-card-1',
    year: 2010,
    rarityType: 'base',
    sport: 'baseball',
  };

  beforeAll(async () => {
    testUserId = `reward-test-${randomUUID()}`;
    await db.insert(users).values({
      id: testUserId,
      username: `reward_test_${Date.now()}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });
    await seedRewardPolicy();
    clearPolicyCache();
  });

  afterAll(async () => {
    // player fame row auto-created by getFameScore for "Test Player"
    await db.delete(playerFame).where(eq(playerFame.playerKey, 'baseball:testplayer'));
    const walletRows = await db.select().from(wallets).where(eq(wallets.userId, testUserId)).limit(1);
    if (walletRows[0]) {
      const bucketIds = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, testUserId));
      if (bucketIds.length > 0) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, bucketIds.map(b => b.id)));
      }
      await db.delete(packptsBucket).where(eq(packptsBucket.userId, testUserId));
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, walletRows[0].id));
      await db.delete(wallets).where(eq(wallets.userId, testUserId));
    }
    await db.delete(pointsAwards).where(eq(pointsAwards.userId, testUserId));
    await db.delete(userPointsCounters).where(eq(userPointsCounters.userId, testUserId));
    await db.delete(matchPointsCounters).where(eq(matchPointsCounters.userId, testUserId));
    await db.delete(userRiskState).where(eq(userRiskState.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  beforeEach(async () => {
    clearPolicyCache();
    await db.delete(pointsAwards).where(eq(pointsAwards.userId, testUserId));
    await db.delete(userPointsCounters).where(eq(userPointsCounters.userId, testUserId));
    await db.delete(matchPointsCounters).where(eq(matchPointsCounters.userId, testUserId));
    await db.delete(userRiskState).where(eq(userRiskState.userId, testUserId));
    const walletRows = await db.select().from(wallets).where(eq(wallets.userId, testUserId)).limit(1);
    if (walletRows[0]) {
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, walletRows[0].id));
      await db.update(wallets).set({ balance: 0, lifetimeEarned: 0 }).where(eq(wallets.id, walletRows[0].id));
    }
  });

  it('frozen user returns capped=true with account_frozen reason', async () => {
    await db.insert(userRiskState).values({
      userId: testUserId,
      status: 'FROZEN',
      reason: 'Fraud detected',
    });

    const result = await awardPoints(testUserId, TEST_CARD);
    expect(result).not.toBeNull();
    expect(result!.capped).toBe(true);
    expect(result!.finalPts).toBe(0);
    expect(result!.cappedReason).toMatch(/^account_frozen/);
  });

  it('second call with same matchId+questionId returns null (idempotent)', async () => {
    const matchId = `match-${randomUUID()}`;
    const questionId = `q-${randomUUID()}`;

    const first = await awardPoints(testUserId, TEST_CARD, matchId, questionId);
    expect(first).not.toBeNull();

    const second = await awardPoints(testUserId, TEST_CARD, matchId, questionId);
    expect(second).toBeNull();
  });

  it('dailyPointsCap reached: returns finalPts=0 + daily_cap_reached', async () => {
    const today = new Date().toISOString().split('T')[0];
    await db.insert(userPointsCounters).values({
      userId: testUserId,
      date: today,
      pointsAwardedToday: 5000,
    });

    const result = await awardPoints(testUserId, TEST_CARD);
    expect(result).not.toBeNull();
    expect(result!.finalPts).toBe(0);
    expect(result!.capped).toBe(true);
    expect(result!.cappedReason).toBe('daily_cap_reached');
  });

  it('dailyPointsCap partial: award trimmed to remaining daily budget', async () => {
    const today = new Date().toISOString().split('T')[0];
    // Leave only 10 pts of budget remaining
    await db.insert(userPointsCounters).values({
      userId: testUserId,
      date: today,
      pointsAwardedToday: 4990,
    });

    const result = await awardPoints(testUserId, TEST_CARD);
    expect(result).not.toBeNull();
    expect(result!.finalPts).toBeLessThanOrEqual(10);
    expect(result!.capped).toBe(true);
    expect(result!.cappedReason).toMatch(/daily_cap_partial/);
  });

  it('perMatchPointsCap reached: returns finalPts=0 + match_cap_reached', async () => {
    const matchId = `match-cap-${randomUUID()}`;
    await db.insert(matchPointsCounters).values({
      matchId,
      userId: testUserId,
      pointsAwarded: 1000,
    });

    const result = await awardPoints(testUserId, TEST_CARD, matchId);
    expect(result).not.toBeNull();
    expect(result!.finalPts).toBe(0);
    expect(result!.capped).toBe(true);
    expect(result!.cappedReason).toBe('match_cap_reached');
  });

  it('normal award: finalPts positive and within [minPts, maxAwardCap]', async () => {
    const result = await awardPoints(testUserId, TEST_CARD);
    expect(result).not.toBeNull();
    expect(result!.finalPts).toBeGreaterThan(0);
    expect(result!.finalPts).toBeGreaterThanOrEqual(100);
    expect(result!.finalPts).toBeLessThanOrEqual(250);
    expect(result!.capped).toBe(false);
  });
});
