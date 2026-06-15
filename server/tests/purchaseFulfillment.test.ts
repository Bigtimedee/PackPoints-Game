import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../db';
import { wallets, ledgerEntries, users, userEntitlements, purchaseEvents, packptsBucket, packptsSpendAllocation } from '@shared/schema';
import { walletService } from '../services/walletService';
import { storage } from '../storage';
import { eq, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

describe('Purchase Fulfillment', () => {
  let testUserId: string;

  beforeAll(async () => {
    testUserId = `test-purchase-${randomUUID()}`;
    
    await db.insert(users).values({
      id: testUserId,
      username: `purchase_test_${Date.now()}`,
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
    await db.delete(userEntitlements).where(eq(userEntitlements.userId, testUserId));
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
    await db.delete(userEntitlements).where(eq(userEntitlements.userId, testUserId));
  });

  describe('PURCHASE_CREDIT ledger entries', () => {
    it('should create PURCHASE_CREDIT entry type for purchases', async () => {
      const idempotencyKey = `purchase-credit-test-${randomUUID()}`;
      const result = await walletService.purchaseCredit(
        testUserId, 
        500, 
        'Purchase: 500 PackPTS', 
        idempotencyKey,
        { stripeEventId: 'evt_test123', priceId: 'price_500', sku: 'PACKPTS_500' }
      );

      expect(result.success).toBe(true);
      expect(result.wallet?.balance).toBe(500);
      expect(result.wallet?.lifetimeEarned).toBe(500);
      expect(result.ledgerEntry?.amount).toBe(500);
      expect(result.ledgerEntry?.entryType).toBe('PURCHASE_CREDIT');
    });

    it('should reject negative or zero purchase amounts', async () => {
      const result1 = await walletService.purchaseCredit(testUserId, 0, 'Invalid', `zero-${randomUUID()}`);
      expect(result1.success).toBe(false);
      expect(result1.error).toBe('Amount must be positive');

      const result2 = await walletService.purchaseCredit(testUserId, -100, 'Invalid', `neg-${randomUUID()}`);
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('Amount must be positive');
    });
  });

  describe('Duplicate webhook delivery (idempotency)', () => {
    it('should process purchase only once for same idempotency key', async () => {
      const idempotencyKey = `stripe_event_evt_123_price_500`;
      
      const result1 = await walletService.purchaseCredit(
        testUserId, 
        500, 
        'Purchase: 500 PackPTS', 
        idempotencyKey
      );
      expect(result1.success).toBe(true);
      expect(result1.idempotent).toBeFalsy();
      expect(result1.wallet?.balance).toBe(500);

      const result2 = await walletService.purchaseCredit(
        testUserId, 
        500, 
        'Purchase: 500 PackPTS', 
        idempotencyKey
      );
      expect(result2.success).toBe(true);
      expect(result2.idempotent).toBe(true);

      const result3 = await walletService.purchaseCredit(
        testUserId, 
        500, 
        'Purchase: 500 PackPTS', 
        idempotencyKey
      );
      expect(result3.success).toBe(true);
      expect(result3.idempotent).toBe(true);

      const wallet = await walletService.getWallet(testUserId);
      expect(wallet?.balance).toBe(500);
      expect(wallet?.lifetimeEarned).toBe(500);
    });

    it('should create separate entries for different idempotency keys', async () => {
      const key1 = `stripe_event_evt_abc_price_500`;
      const key2 = `stripe_event_evt_def_price_500`;
      
      await walletService.purchaseCredit(testUserId, 500, 'Purchase 1', key1);
      await walletService.purchaseCredit(testUserId, 500, 'Purchase 2', key2);

      const wallet = await walletService.getWallet(testUserId);
      expect(wallet?.balance).toBe(1000);
    });
  });

  describe('Race conditions', () => {
    it('should handle concurrent purchase credit requests with same idempotency key', async () => {
      const idempotencyKey = `concurrent-purchase-${randomUUID()}`;
      
      const promises = Array.from({ length: 5 }, () => 
        walletService.purchaseCredit(testUserId, 1000, 'Concurrent purchase', idempotencyKey)
      );

      const results = await Promise.all(promises);
      
      const successCount = results.filter(r => r.success).length;
      const idempotentCount = results.filter(r => r.success && r.idempotent).length;
      
      expect(successCount).toBe(5);
      expect(idempotentCount).toBeGreaterThanOrEqual(4);
      
      const wallet = await walletService.getWallet(testUserId);
      expect(wallet?.balance).toBe(1000);
    });

    it('should handle concurrent purchases with different keys correctly', async () => {
      const promises = Array.from({ length: 3 }, (_, i) => 
        walletService.purchaseCredit(testUserId, 100, `Purchase ${i}`, `unique-key-${randomUUID()}`)
      );

      const results = await Promise.all(promises);
      
      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBe(3);
      
      const wallet = await walletService.getWallet(testUserId);
      expect(wallet?.balance).toBe(300);
    });
  });

  describe('Refund after credit (REVERSAL)', () => {
    it('should create REVERSAL entry when reversing a purchase', async () => {
      const originalKey = `stripe_event_evt_original_price_500`;
      const reversalKey = `stripe_refund_evt_refund_price_500`;
      
      await walletService.purchaseCredit(testUserId, 500, 'Purchase: 500 PackPTS', originalKey);
      
      const wallet1 = await walletService.getWallet(testUserId);
      expect(wallet1?.balance).toBe(500);

      const reversalResult = await walletService.reversal(
        testUserId,
        500,
        'Refund: 500 PackPTS',
        reversalKey,
        originalKey,
        { stripeRefundEventId: 'evt_refund' }
      );

      expect(reversalResult.success).toBe(true);
      expect(reversalResult.wallet?.balance).toBe(0);
      expect(reversalResult.ledgerEntry?.entryType).toBe('REVERSAL');
      expect(reversalResult.ledgerEntry?.amount).toBe(-500);
    });

    it('should fail reversal if original transaction not found', async () => {
      const nonExistentKey = `stripe_event_nonexistent_${randomUUID()}`;
      const reversalKey = `stripe_refund_${randomUUID()}`;
      
      const result = await walletService.reversal(
        testUserId,
        500,
        'Refund attempt',
        reversalKey,
        nonExistentKey
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Original transaction not found - nothing to reverse');
    });

    it('should handle duplicate refund requests idempotently', async () => {
      const originalKey = `original-for-dup-refund-${randomUUID()}`;
      const reversalKey = `reversal-dup-${randomUUID()}`;
      
      await walletService.purchaseCredit(testUserId, 1000, 'Purchase', originalKey);
      
      const result1 = await walletService.reversal(testUserId, 1000, 'Refund', reversalKey, originalKey);
      expect(result1.success).toBe(true);
      expect(result1.idempotent).toBeFalsy();

      const result2 = await walletService.reversal(testUserId, 1000, 'Refund', reversalKey, originalKey);
      expect(result2.success).toBe(true);
      expect(result2.idempotent).toBe(true);

      const wallet = await walletService.getWallet(testUserId);
      expect(wallet?.balance).toBe(0);
    });

    it('should fail reversal if balance would go negative', async () => {
      const originalKey = `original-negative-${randomUUID()}`;
      const reversalKey = `reversal-negative-${randomUUID()}`;
      
      await walletService.purchaseCredit(testUserId, 500, 'Purchase', originalKey);
      await walletService.spend(testUserId, 400, 'Spend', `spend-${randomUUID()}`);
      
      const wallet = await walletService.getWallet(testUserId);
      expect(wallet?.balance).toBe(100);

      const result = await walletService.reversal(testUserId, 500, 'Full refund', reversalKey, originalKey);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Reversal would result in negative balance');
    });

    it('should track original entry reference in reversal metadata', async () => {
      const originalKey = `original-track-${randomUUID()}`;
      const reversalKey = `reversal-track-${randomUUID()}`;
      
      await walletService.purchaseCredit(testUserId, 750, 'Purchase', originalKey);
      
      const originalEntry = await walletService.findLedgerEntryByIdempotencyKey(originalKey);
      expect(originalEntry).not.toBeNull();

      const reversalResult = await walletService.reversal(
        testUserId, 
        750, 
        'Refund', 
        reversalKey, 
        originalKey
      );

      expect(reversalResult.success).toBe(true);
      const metadata = reversalResult.ledgerEntry?.metadata as Record<string, unknown>;
      expect(metadata?.originalIdempotencyKey).toBe(originalKey);
      expect(metadata?.originalEntryId).toBe(originalEntry?.id);
    });
  });

  describe('findLedgerEntryByIdempotencyKey', () => {
    it('should find existing ledger entry', async () => {
      const key = `find-test-${randomUUID()}`;
      await walletService.purchaseCredit(testUserId, 100, 'Test', key);
      
      const entry = await walletService.findLedgerEntryByIdempotencyKey(key);
      expect(entry).not.toBeNull();
      expect(entry?.idempotencyKey).toBe(key);
      expect(entry?.amount).toBe(100);
    });

    it('should return null for non-existent key', async () => {
      const entry = await walletService.findLedgerEntryByIdempotencyKey(`nonexistent-${randomUUID()}`);
      expect(entry).toBeNull();
    });
  });

  describe('Entitlement grant and revoke', () => {
    it('should grant entitlement', async () => {
      await storage.grantEntitlement({
        userId: testUserId,
        entitlementKey: 'legend_mode',
        source: 'purchase',
        sourceReference: 'evt_test',
        expiresAt: null,
      });

      const hasEntitlement = await storage.hasEntitlement(testUserId, 'legend_mode');
      expect(hasEntitlement).toBe(true);
    });

    it('should revoke entitlement', async () => {
      await storage.grantEntitlement({
        userId: testUserId,
        entitlementKey: 'pro_subscription',
        source: 'purchase',
        sourceReference: 'evt_test',
        expiresAt: null,
      });

      const hasEntitlementBefore = await storage.hasEntitlement(testUserId, 'pro_subscription');
      expect(hasEntitlementBefore).toBe(true);

      await storage.revokeEntitlement(testUserId, 'pro_subscription', 'Refund');

      const hasEntitlementAfter = await storage.hasEntitlement(testUserId, 'pro_subscription');
      expect(hasEntitlementAfter).toBe(false);
    });

    it('should grant subscription entitlement with expiration', async () => {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      
      await storage.grantEntitlement({
        userId: testUserId,
        entitlementKey: 'monthly_sub',
        source: 'purchase',
        sourceReference: 'evt_invoice',
        expiresAt,
      });

      const hasEntitlement = await storage.hasEntitlement(testUserId, 'monthly_sub');
      expect(hasEntitlement).toBe(true);

      const entitlements = await storage.getUserEntitlements(testUserId);
      const monthlyEnt = entitlements.find(e => e.entitlementKey === 'monthly_sub');
      expect(monthlyEnt).toBeDefined();
      expect(monthlyEnt?.expiresAt).not.toBeNull();
    });
  });
});
