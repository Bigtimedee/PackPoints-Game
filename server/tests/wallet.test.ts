import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../db';
import { wallets, ledgerEntries, users, pointsAwards, userPointsCounters, matchPointsCounters, packptsBucket, packptsSpendAllocation, userRiskState } from '@shared/schema';
import { walletService } from '../services/walletService';
import { awardPoints, seedRewardPolicy, type CardContext } from '../services/rewardEngine';
import { expirationEngine } from '../services/expirationEngine';
import { eq, sql, and, inArray, asc } from 'drizzle-orm';
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
      const bucketIds = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, testUserId));
      if (bucketIds.length > 0) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, bucketIds.map(b => b.id)));
      }
      await db.delete(packptsBucket).where(eq(packptsBucket.userId, testUserId));
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.delete(wallets).where(eq(wallets.userId, testUserId));
    }
    await db.delete(users).where(eq(users.id, testUserId));
  });

  beforeEach(async () => {
    const wallet = await walletService.getWallet(testUserId);
    if (wallet) {
      const bucketIds = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, testUserId));
      if (bucketIds.length > 0) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, bucketIds.map(b => b.id)));
      }
      await db.delete(packptsBucket).where(eq(packptsBucket.userId, testUserId));
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
    await seedRewardPolicy();
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
    // awardPoints only credits an existing wallet, not creates one
    await db.insert(wallets).values({ userId: gpUserId, balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 });
  });

  afterAll(async () => {
    const idempotencyKey = `award:${matchId}:${questionId}:${gpUserId}`;
    await db.delete(pointsAwards).where(eq(pointsAwards.idempotencyKey, idempotencyKey));
    await db.delete(userPointsCounters).where(eq(userPointsCounters.userId, gpUserId));
    await db.delete(matchPointsCounters).where(eq(matchPointsCounters.matchId, matchId));
    const wallet = await walletService.getWallet(gpUserId);
    if (wallet) {
      const bucketIds = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, gpUserId));
      if (bucketIds.length > 0) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, bucketIds.map(b => b.id)));
      }
      await db.delete(packptsBucket).where(eq(packptsBucket.userId, gpUserId));
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

// ── Ledger balance invariant ──────────────────────────────────────────────────

describe('ledger balance invariant', () => {
  let userId: string;

  beforeAll(async () => {
    userId = `ledger-inv-${randomUUID()}`;
    await db.insert(users).values({
      id: userId,
      username: `ledger_inv_${Date.now()}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });
  });

  afterAll(async () => {
    const wallet = await walletService.getWallet(userId);
    if (wallet) {
      const bucketIds = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, userId));
      if (bucketIds.length > 0) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, bucketIds.map(b => b.id)));
      }
      await db.delete(packptsBucket).where(eq(packptsBucket.userId, userId));
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.delete(wallets).where(eq(wallets.userId, userId));
    }
    await db.delete(users).where(eq(users.id, userId));
  });

  it('wallet.balance equals sum of all ledger entry amounts after mixed operations', async () => {
    await walletService.earn(userId, 500, 'Earn 1', `earn1-${randomUUID()}`);
    await walletService.earn(userId, 300, 'Earn 2', `earn2-${randomUUID()}`);
    await walletService.spend(userId, 200, 'Spend 1', `spend1-${randomUUID()}`);
    await walletService.adjust(userId, -50, 'Admin deduct', `adj1-${randomUUID()}`);
    await walletService.adjust(userId, 100, 'Promo', `adj2-${randomUUID()}`);

    const wallet = await walletService.getWallet(userId);
    expect(wallet).not.toBeNull();

    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.walletId, wallet!.id));
    const sumFromLedger = entries.reduce((acc, e) => acc + e.amount, 0);
    expect(wallet!.balance).toBe(sumFromLedger);
    // 500 + 300 - 200 - 50 + 100 = 650
    expect(wallet!.balance).toBe(650);
  });
});

// ── Frozen account cannot earn or spend ──────────────────────────────────────

describe('frozen account cannot earn or spend', () => {
  let userId: string;

  beforeAll(async () => {
    userId = `frozen-${randomUUID()}`;
    await db.insert(users).values({
      id: userId,
      username: `frozen_${Date.now()}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });
  });

  afterAll(async () => {
    const wallet = await walletService.getWallet(userId);
    if (wallet) {
      const bucketIds = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, userId));
      if (bucketIds.length > 0) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, bucketIds.map(b => b.id)));
      }
      await db.delete(packptsBucket).where(eq(packptsBucket.userId, userId));
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.delete(wallets).where(eq(wallets.userId, userId));
    }
    await db.delete(userRiskState).where(eq(userRiskState.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  beforeEach(async () => {
    await db.delete(userRiskState).where(eq(userRiskState.userId, userId));
    await db.update(wallets).set({ status: 'active' }).where(eq(wallets.userId, userId));
  });

  it('earn fails when userRiskState is FROZEN', async () => {
    await db.insert(userRiskState).values({ userId, status: 'FROZEN', reason: 'fraud test' });
    const result = await walletService.earn(userId, 100, 'Test', `earn-frozen-${randomUUID()}`);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/frozen/i);
  });

  it('spend fails when userRiskState is FROZEN', async () => {
    // Fund the wallet first while unfrozen
    await walletService.earn(userId, 200, 'Setup', `setup-frozen-${randomUUID()}`);
    await db.insert(userRiskState).values({ userId, status: 'FROZEN', reason: 'fraud test' });
    const result = await walletService.spend(userId, 50, 'Test', `spend-frozen-${randomUUID()}`);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/frozen/i);
  });

  it('earn fails when wallet.status is not active', async () => {
    const wallet = await walletService.getOrCreateWallet(userId);
    await db.update(wallets).set({ status: 'frozen' }).where(eq(wallets.id, wallet.id));
    const result = await walletService.earn(userId, 100, 'Test', `earn-inactive-${randomUUID()}`);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/frozen/i);
  });

  it('spend fails when wallet.status is not active', async () => {
    const wallet = await walletService.getOrCreateWallet(userId);
    await db.update(wallets).set({ balance: 500, status: 'frozen' }).where(eq(wallets.id, wallet.id));
    const result = await walletService.spend(userId, 100, 'Test', `spend-inactive-${randomUUID()}`);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/frozen/i);
  });
});

// ── FIFO bucket depletion ─────────────────────────────────────────────────────

describe('FIFO bucket depletion', () => {
  let userId: string;

  beforeAll(async () => {
    userId = `fifo-${randomUUID()}`;
    await db.insert(users).values({
      id: userId,
      username: `fifo_${Date.now()}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });
  });

  afterAll(async () => {
    const wallet = await walletService.getWallet(userId);
    if (wallet) {
      const bucketIds = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, userId));
      if (bucketIds.length > 0) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, bucketIds.map(b => b.id)));
      }
      await db.delete(packptsBucket).where(eq(packptsBucket.userId, userId));
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.delete(wallets).where(eq(wallets.userId, userId));
    }
    await db.delete(users).where(eq(users.id, userId));
  });

  it('spend depletes oldest (first-earned) bucket first', async () => {
    // Two sequential earns — DB round-trip guarantees different earnedAt
    await walletService.earn(userId, 200, 'Bucket A', `fifo-a-${randomUUID()}`);
    await walletService.earn(userId, 100, 'Bucket B', `fifo-b-${randomUUID()}`);

    const spendKey = `fifo-spend-${randomUUID()}`;
    const result = await walletService.spend(userId, 250, 'FIFO spend', spendKey);
    expect(result.success).toBe(true);
    expect(result.wallet?.balance).toBe(50);

    const buckets = await db.select().from(packptsBucket)
      .where(eq(packptsBucket.userId, userId))
      .orderBy(asc(packptsBucket.earnedAt));

    expect(buckets).toHaveLength(2);
    // Oldest bucket (A=200) depleted first
    expect(buckets[0].remainingAmount).toBe(0);
    expect(buckets[0].status).toBe('DEPLETED');
    // Newest bucket (B=100) partially used: 50 spent from it
    expect(buckets[1].remainingAmount).toBe(50);
    expect(buckets[1].status).toBe('OPEN');
  });

  it('spend allocations sum to the total amount spent', async () => {
    // Earn 100 more (previous spend left 50 in wallet)
    const earnKey = `fifo-extra-${randomUUID()}`;
    await walletService.earn(userId, 100, 'Extra', earnKey);

    const spendKey = `fifo-alloc-${randomUUID()}`;
    await walletService.spend(userId, 100, 'Alloc check', spendKey);

    const wallet = await walletService.getWallet(userId);
    const spendEntry = await db.select().from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, spendKey))
      .limit(1);
    expect(spendEntry).toHaveLength(1);

    const allocations = await db.select().from(packptsSpendAllocation)
      .where(eq(packptsSpendAllocation.spendLedgerEntryId, spendEntry[0].id));
    const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
    expect(totalAllocated).toBe(100);
  });
});

// ── EXPIRE entry reconciliation ───────────────────────────────────────────────

describe('EXPIRE entry reconciliation', () => {
  let userId: string;

  beforeAll(async () => {
    userId = `expire-${randomUUID()}`;
    await db.insert(users).values({
      id: userId,
      username: `expire_${Date.now()}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });
  });

  afterAll(async () => {
    const wallet = await walletService.getWallet(userId);
    if (wallet) {
      const bucketIds = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, userId));
      if (bucketIds.length > 0) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, bucketIds.map(b => b.id)));
      }
      await db.delete(packptsBucket).where(eq(packptsBucket.userId, userId));
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.delete(wallets).where(eq(wallets.userId, userId));
    }
    await db.delete(users).where(eq(users.id, userId));
  });

  it('expiration engine creates EXPIRE ledger entry and balance invariant holds', async () => {
    await walletService.earn(userId, 150, 'Expires soon', `expire-earn-${randomUUID()}`);
    const walletBefore = await walletService.getWallet(userId);
    expect(walletBefore!.balance).toBe(150);

    // Force bucket to appear expired by backdating expiresAt
    await db.update(packptsBucket)
      .set({ expiresAt: new Date('2020-01-01') })
      .where(eq(packptsBucket.userId, userId));

    const result = await expirationEngine.runExpirationJob(false);
    expect(result.success).toBe(true);
    expect(result.totalPointsExpired).toBeGreaterThanOrEqual(150);

    const walletAfter = await walletService.getWallet(userId);
    expect(walletAfter!.balance).toBe(0);

    // EXPIRE ledger entry must exist
    const entries = await db.select().from(ledgerEntries)
      .where(eq(ledgerEntries.walletId, walletBefore!.id));
    const expireEntry = entries.find(e => e.entryType === 'EXPIRE');
    expect(expireEntry).toBeDefined();
    expect(expireEntry!.amount).toBe(-150);

    // Balance invariant: wallet.balance === sum(ledger amounts)
    const sumFromLedger = entries.reduce((acc, e) => acc + e.amount, 0);
    expect(walletAfter!.balance).toBe(sumFromLedger);
  });

  it('expirationEngine is idempotent: re-running does not double-expire', async () => {
    // The same bucket is already EXPIRED from the previous test.
    // Running again should produce no new expirations for this user.
    const walletBefore = await walletService.getWallet(userId);
    await expirationEngine.runExpirationJob(false);
    const walletAfter = await walletService.getWallet(userId);
    expect(walletAfter!.balance).toBe(walletBefore!.balance);
  });
});
