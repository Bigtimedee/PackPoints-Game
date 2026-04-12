import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../db';
import { wallets, ledgerEntries, users, pointsAwards, userPointsCounters, matchPointsCounters } from '@shared/schema';
import { walletService } from '../services/walletService';
import { awardPoints, type CardContext } from '../services/rewardEngine';
import { eq, sql, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

describe('WalletService', () => {
  let testUserId: string;

  beforeAll(async () => {
    testUserId = `test-user-${randomUUID()}`;
    
    await db.insert(users).values({
      id: testUserId,
      username: `testuser_${Date.now()}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });
  });

  afterAll(async () => {
    const wallet = await walletService.getWallet(testUserId);
    if (wallet) {
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.delete(wallets).where(eq(wallets.userId, testUserId));
    }
    await db.delete(users).where(eq(users.id, testUserId));
  });

  beforeEach(async () => {
    const wallet = await walletService.getWallet(testUserId);
    if (wallet) {
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.update(wallets).set({ balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 }).where(eq(wallets.id, wallet.id));
    }
  });

  describe('earn()', () => {
    it('should create wallet and add balance for new user', async () => {
      const idempotencyKey = `earn-test-${randomUUID()}`;
      const result = await walletService.earn(testUserId, 100, 'Game reward', idempotencyKey);

      expect(result.success).toBe(true);
      expect(result.wallet?.balance).toBe(100);
      expect(result.wallet?.lifetimeEarned).toBe(100);
      expect(result.ledgerEntry?.amount).toBe(100);
      expect(result.ledgerEntry?.entryType).toBe('EARN');
    });

    it('should reject negative amounts', async () => {
      const idempotencyKey = `earn-negative-${randomUUID()}`;
      const result = await walletService.earn(testUserId, -50, 'Invalid', idempotencyKey);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Amount must be positive');
    });
  });

  describe('spend()', () => {
    it('should deduct balance when sufficient funds exist', async () => {
      await walletService.earn(testUserId, 200, 'Initial balance', `setup-${randomUUID()}`);
      
      const idempotencyKey = `spend-test-${randomUUID()}`;
      const result = await walletService.spend(testUserId, 50, 'Purchase', idempotencyKey);

      expect(result.success).toBe(true);
      expect(result.wallet?.balance).toBe(150);
      expect(result.wallet?.lifetimeSpent).toBe(50);
      expect(result.ledgerEntry?.amount).toBe(-50);
      expect(result.ledgerEntry?.entryType).toBe('SPEND');
    });

    it('should reject spend when insufficient balance (double-spend prevention)', async () => {
      await walletService.earn(testUserId, 100, 'Initial balance', `setup-${randomUUID()}`);
      
      const idempotencyKey1 = `spend-ds1-${randomUUID()}`;
      const idempotencyKey2 = `spend-ds2-${randomUUID()}`;
      
      const result1 = await walletService.spend(testUserId, 80, 'First purchase', idempotencyKey1);
      expect(result1.success).toBe(true);
      expect(result1.wallet?.balance).toBe(20);

      const result2 = await walletService.spend(testUserId, 80, 'Second purchase', idempotencyKey2);
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('Insufficient balance');
    });

    it('should prevent double-spend with same idempotency key', async () => {
      await walletService.earn(testUserId, 500, 'Initial balance', `setup-${randomUUID()}`);
      
      const idempotencyKey = `spend-idempotent-${randomUUID()}`;
      
      const result1 = await walletService.spend(testUserId, 100, 'Purchase', idempotencyKey);
      expect(result1.success).toBe(true);
      expect(result1.wallet?.balance).toBe(400);
      expect(result1.idempotent).toBeFalsy();

      const result2 = await walletService.spend(testUserId, 100, 'Purchase', idempotencyKey);
      expect(result2.success).toBe(true);
      expect(result2.wallet?.balance).toBe(400);
      expect(result2.idempotent).toBe(true);

      const wallet = await walletService.getWallet(testUserId);
      expect(wallet?.balance).toBe(400);
    });
  });

  describe('idempotency', () => {
    it('should return same result for duplicate earn requests', async () => {
      const idempotencyKey = `earn-idempotent-${randomUUID()}`;
      
      const result1 = await walletService.earn(testUserId, 150, 'Bonus', idempotencyKey);
      expect(result1.success).toBe(true);
      expect(result1.idempotent).toBeFalsy();
      const firstBalance = result1.wallet?.balance;

      const result2 = await walletService.earn(testUserId, 150, 'Bonus', idempotencyKey);
      expect(result2.success).toBe(true);
      expect(result2.idempotent).toBe(true);

      expect(result2.wallet?.balance).toBe(firstBalance);
    });

    it('should return same result for duplicate adjust requests', async () => {
      const setupKey = `setup-${randomUUID()}`;
      await walletService.earn(testUserId, 200, 'Setup', setupKey);
      
      const idempotencyKey = `adjust-idempotent-${randomUUID()}`;
      
      const result1 = await walletService.adjust(testUserId, -30, 'Admin deduction', idempotencyKey);
      expect(result1.success).toBe(true);
      expect(result1.idempotent).toBeFalsy();

      const result2 = await walletService.adjust(testUserId, -30, 'Admin deduction', idempotencyKey);
      expect(result2.success).toBe(true);
      expect(result2.idempotent).toBe(true);

      const wallet = await walletService.getWallet(testUserId);
      expect(wallet?.balance).toBe(170);
    });
  });

  describe('adjust()', () => {
    it('should allow positive adjustments', async () => {
      const idempotencyKey = `adjust-pos-${randomUUID()}`;
      const result = await walletService.adjust(testUserId, 100, 'Promo credit', idempotencyKey);

      expect(result.success).toBe(true);
      expect(result.wallet?.balance).toBe(100);
      expect(result.ledgerEntry?.entryType).toBe('ADJUST');
    });

    it('should allow negative adjustments when balance permits', async () => {
      await walletService.earn(testUserId, 300, 'Setup', `setup-${randomUUID()}`);
      
      const idempotencyKey = `adjust-neg-${randomUUID()}`;
      const result = await walletService.adjust(testUserId, -100, 'Refund clawback', idempotencyKey);

      expect(result.success).toBe(true);
      expect(result.wallet?.balance).toBe(200);
    });

    it('should reject adjustments that would result in negative balance', async () => {
      await walletService.earn(testUserId, 50, 'Setup', `setup-${randomUUID()}`);
      
      const idempotencyKey = `adjust-overdraft-${randomUUID()}`;
      const result = await walletService.adjust(testUserId, -100, 'Invalid deduction', idempotencyKey);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Adjustment would result in negative balance');
    });
  });

  describe('concurrent spend prevention', () => {
    it('should handle concurrent spend requests correctly', async () => {
      await walletService.earn(testUserId, 100, 'Setup', `setup-${randomUUID()}`);

      const spendPromises = Array.from({ length: 3 }, (_, i) =>
        walletService.spend(testUserId, 50, `Concurrent ${i}`, `concurrent-${randomUUID()}`)
      );

      const results = await Promise.all(spendPromises);

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      expect(successCount).toBe(2);
      expect(failCount).toBe(1);

      const wallet = await walletService.getWallet(testUserId);
      expect(wallet?.balance).toBe(0);
    });
  });
});

// ── Duplicate gameplay award prevention ──────────────────────────────────────

describe('duplicate gameplay award prevention', () => {
  let gpUserId: string;
  const matchId = `match-${randomUUID()}`;
  const questionId = `q-${randomUUID()}`;
  const card: CardContext = { playerName: 'Test Player', rarityType: 'base' };

  beforeAll(async () => {
    gpUserId = randomUUID();
    await db.insert(users).values({
      id: gpUserId,
      username: `gp_user_${Date.now()}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });
  });

  afterAll(async () => {
    const idempotencyKey = `award:${matchId}:${questionId}:${gpUserId}`;
    await db.delete(pointsAwards).where(eq(pointsAwards.idempotencyKey, idempotencyKey));
    await db.delete(userPointsCounters).where(eq(userPointsCounters.userId, gpUserId));
    await db.delete(matchPointsCounters).where(eq(matchPointsCounters.matchId, matchId));
    const wallet = await walletService.getWallet(gpUserId);
    if (wallet) {
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.delete(wallets).where(eq(wallets.id, wallet.id));
    }
    await db.delete(users).where(eq(users.id, gpUserId));
  });

  it('credits the wallet exactly once when awardPoints is called twice with the same matchId+questionId', async () => {
    // First call — should award points
    const result1 = await awardPoints(gpUserId, card, matchId, questionId);
    expect(result1).not.toBeNull();
    const awardedPts = result1!.finalPts;
    expect(awardedPts).toBeGreaterThan(0);

    const walletAfterFirst = await walletService.getWallet(gpUserId);
    expect(walletAfterFirst?.balance).toBe(awardedPts);
    expect(walletAfterFirst?.lifetimeEarned).toBe(awardedPts);

    // Second call with identical matchId + questionId — must be a no-op
    const result2 = await awardPoints(gpUserId, card, matchId, questionId);
    expect(result2).toBeNull();

    // Balance must not have changed
    const walletAfterSecond = await walletService.getWallet(gpUserId);
    expect(walletAfterSecond?.balance).toBe(awardedPts);
    expect(walletAfterSecond?.lifetimeEarned).toBe(awardedPts);
  });

  it('has exactly one points_awards row for the idempotency key', async () => {
    const idempotencyKey = `award:${matchId}:${questionId}:${gpUserId}`;
    const rows = await db
      .select()
      .from(pointsAwards)
      .where(eq(pointsAwards.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(1);
  });

  it('has exactly one ledger_entries row for the idempotency key', async () => {
    const idempotencyKey = `award:${matchId}:${questionId}:${gpUserId}`;
    const wallet = await walletService.getWallet(gpUserId);
    expect(wallet).toBeDefined();
    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.walletId, wallet!.id),
          eq(ledgerEntries.idempotencyKey, idempotencyKey),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
