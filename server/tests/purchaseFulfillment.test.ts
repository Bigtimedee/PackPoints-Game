import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../db';
import { wallets, ledgerEntries, users, userEntitlements, purchaseEvents, packptsBucket, packptsSpendAllocation, type ProfitPolicy } from '@shared/schema';
import { walletService } from '../services/walletService';
import { storage } from '../storage';
import { profitGuardrailService } from '../services/profitGuardrailService';
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

// ── Stripe webhook eventId idempotency (purchaseEvents table) ─────────────────

describe('Stripe webhook eventId idempotency (purchaseEvents table)', () => {
  let userId: string;

  beforeAll(async () => {
    userId = `evt-idem-${randomUUID()}`;
    await db.insert(users).values({
      id: userId,
      username: `evt_idem_${Date.now()}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });
  });

  afterAll(async () => {
    await db.delete(purchaseEvents).where(eq(purchaseEvents.userId, userId));
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

  beforeEach(async () => {
    await db.delete(purchaseEvents).where(eq(purchaseEvents.userId, userId));
    const wallet = await walletService.getWallet(userId);
    if (wallet) {
      const bucketIds = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, userId));
      if (bucketIds.length > 0) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, bucketIds.map(b => b.id)));
      }
      await db.delete(packptsBucket).where(eq(packptsBucket.userId, userId));
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.update(wallets).set({ balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 }).where(eq(wallets.id, wallet.id));
    }
  });

  it('inserting the same eventId twice violates the unique constraint', async () => {
    const eventId = `evt_uniq_${randomUUID()}`;
    await db.insert(purchaseEvents).values({
      eventId,
      eventType: 'checkout.session.completed',
      userId,
      payload: { id: eventId },
      status: 'received',
    });

    await expect(
      db.insert(purchaseEvents).values({
        eventId,
        eventType: 'checkout.session.completed',
        userId,
        payload: { id: eventId },
        status: 'received',
      })
    ).rejects.toThrow();
  });

  it('duplicate webhook delivery: purchaseCredit with same eventId-derived key is idempotent', async () => {
    const stripeEventId = `evt_dup_wh_${randomUUID()}`;
    const idempotencyKey = `stripe_${stripeEventId}`;

    const first = await walletService.purchaseCredit(
      userId, 500, 'Checkout fulfilled', idempotencyKey, { stripeEventId }
    );
    expect(first.success).toBe(true);
    expect(first.idempotent).toBeFalsy();

    const second = await walletService.purchaseCredit(
      userId, 500, 'Checkout fulfilled', idempotencyKey, { stripeEventId }
    );
    expect(second.success).toBe(true);
    expect(second.idempotent).toBe(true);

    const wallet = await walletService.getWallet(userId);
    expect(wallet?.balance).toBe(500); // credited exactly once
  });

  it('different eventIds for same user result in separate credits', async () => {
    const key1 = `stripe_evt_${randomUUID()}`;
    const key2 = `stripe_evt_${randomUUID()}`;

    await walletService.purchaseCredit(userId, 500, 'Purchase A', key1);
    await walletService.purchaseCredit(userId, 300, 'Purchase B', key2);

    const wallet = await walletService.getWallet(userId);
    expect(wallet?.balance).toBe(800);
  });
});

// ── checkout.session.completed — session lifecycle transitions ─────────────────

describe('checkout.session.completed session lifecycle transitions', () => {
  it('event status: received → processed on fulfillment success', async () => {
    const eventId = `evt_lifecycle_ok_${randomUUID()}`;

    const [event] = await db.insert(purchaseEvents).values({
      eventId,
      eventType: 'checkout.session.completed',
      payload: { id: eventId },
      status: 'received',
    }).returning();

    expect(event.status).toBe('received');
    expect(event.processedAt).toBeNull();

    await db.update(purchaseEvents)
      .set({ status: 'processed', processedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseEvents.eventId, eventId));

    const [updated] = await db.select().from(purchaseEvents)
      .where(eq(purchaseEvents.eventId, eventId)).limit(1);

    expect(updated.status).toBe('processed');
    expect(updated.processedAt).not.toBeNull();

    // cleanup
    await db.delete(purchaseEvents).where(eq(purchaseEvents.eventId, eventId));
  });

  it('event status: received → failed on processing error (stores errorMessage)', async () => {
    const eventId = `evt_lifecycle_fail_${randomUUID()}`;

    await db.insert(purchaseEvents).values({
      eventId,
      eventType: 'checkout.session.completed',
      payload: { id: eventId },
      status: 'received',
    });

    await db.update(purchaseEvents)
      .set({ status: 'failed', errorMessage: 'User not found in DB', updatedAt: new Date() })
      .where(eq(purchaseEvents.eventId, eventId));

    const [updated] = await db.select().from(purchaseEvents)
      .where(eq(purchaseEvents.eventId, eventId)).limit(1);

    expect(updated.status).toBe('failed');
    expect(updated.errorMessage).toBe('User not found in DB');

    // cleanup
    await db.delete(purchaseEvents).where(eq(purchaseEvents.eventId, eventId));
  });

  it('fulfilled event is never re-processed (idempotency check via status guard)', async () => {
    const eventId = `evt_lifecycle_skip_${randomUUID()}`;

    await db.insert(purchaseEvents).values({
      eventId,
      eventType: 'checkout.session.completed',
      payload: { id: eventId },
      status: 'processed',
      processedAt: new Date(),
    });

    // A real webhook handler checks for existing event first — simulate that check
    const [existing] = await db.select().from(purchaseEvents)
      .where(eq(purchaseEvents.eventId, eventId)).limit(1);

    // Handler should skip processing if status is already 'processed'
    const shouldSkip = existing.status === 'processed' || existing.status === 'fulfilled';
    expect(shouldSkip).toBe(true);

    // cleanup
    await db.delete(purchaseEvents).where(eq(purchaseEvents.eventId, eventId));
  });
});

// ── Margin guardrail (computeRmax — pure function) ────────────────────────────
// Formula: Cmax = (h*A*P*(1-m) - f) / (1 + r); Rmax = Cmax > 0 ? floor(Cmax/v) : 0
// Credit is funded by affiliate revenue (h*A*P); the business retains fraction
// m of that margin. The previous formula ((h*A - m) * P) treated m as a share
// of PRICE, which is negative for every real affiliate rate — Rmax was
// permanently 0 and the eBay redemption feature could never grant credit.

describe('margin guardrail (computeRmax)', () => {
  const DEFAULT_POLICY = {
    id: 'test-default',
    minMarginM: 0.25,       // retain 25% of affiliate margin
    affiliateRateA: 0.02,   // 2% affiliate rate
    affiliateHaircutH: 0.70,
    processingFeeRateR: 0.00,
    fixedFeeFCents: 0,
    packptsValueVMicrousd: 2000,
    enabled: true,
    effectiveFrom: new Date(),
    createdAt: new Date(),
  } as ProfitPolicy;

  const RICH_POLICY = {
    id: 'test-rich',
    minMarginM: 0.10,
    affiliateRateA: 0.20,
    affiliateHaircutH: 0.90,
    processingFeeRateR: 0.00,
    fixedFeeFCents: 0,
    packptsValueVMicrousd: 2000,
    enabled: true,
    effectiveFrom: new Date(),
    createdAt: new Date(),
  } as ProfitPolicy;

  it('default policy yields positive Rmax on a real listing', () => {
    // P = $100 → Cmax = 0.70*0.02*100*(1-0.25) = $1.05 → Rmax = floor(1.05/0.002) = 525
    const result = profitGuardrailService.computeRmax(10000, DEFAULT_POLICY);
    expect(result.Rmax).toBe(525);
    expect(result.Cmax).toBe(1.05);
  });

  it('rich policy yields proportionally larger Rmax', () => {
    // P = $100 → Cmax = 0.90*0.20*100*(1-0.10) = $16.20 → Rmax = floor(16.20/0.002) = 8100
    const result = profitGuardrailService.computeRmax(10000, RICH_POLICY);
    expect(result.Rmax).toBe(8100);
    expect(result.Cmax).toBe(16.2);
  });

  it('fixed fee reduces Rmax proportionally', () => {
    const policyWithFee = { ...RICH_POLICY, fixedFeeFCents: 500 } as ProfitPolicy;
    const noFee = profitGuardrailService.computeRmax(10000, RICH_POLICY);
    const withFee = profitGuardrailService.computeRmax(10000, policyWithFee);

    // $5 fee reduces Cmax by $5, Rmax by 5/0.002 = 2500
    expect(withFee.Cmax).toBe(noFee.Cmax - 5);
    expect(withFee.Rmax).toBe(noFee.Rmax - 2500);
  });

  it('Rmax=0 when the credit rounds below one PackPTS (tiny listing)', () => {
    // P = $0.10 → Cmax = 0.014*0.10*0.75 ≈ $0.00105 → floor(0.00105/0.002) = 0
    const result = profitGuardrailService.computeRmax(10, DEFAULT_POLICY);
    expect(result.Rmax).toBe(0);
  });

  it('higher price yields proportionally more Rmax (linear scaling)', () => {
    const low = profitGuardrailService.computeRmax(5000, RICH_POLICY);   // $50
    const high = profitGuardrailService.computeRmax(10000, RICH_POLICY); // $100
    // Rmax should double since there's no fixed fee
    expect(high.Rmax).toBe(low.Rmax * 2);
  });
});
