import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../db';
import {
  users,
  wallets,
  ledgerEntries,
  referralLinks,
  referralAttributions,
  packptsBucket,
  packptsSpendAllocation,
} from '@shared/schema';
import { grantReferralBonus } from '../services/referralRewards';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

describe('grantReferralBonus — double-sided referral rewards', () => {
  let referrerId: string;
  let invitedUserId: string;
  let referralLinkId: string;

  beforeAll(async () => {
    referrerId = `test-referrer-${randomUUID()}`;
    invitedUserId = `test-invited-${randomUUID()}`;

    await db.insert(users).values([
      { id: referrerId, username: `referrer_${Date.now()}`, points: 0, gamesPlayed: 0, correctAnswers: 0, totalAnswers: 0, isAdmin: false },
      { id: invitedUserId, username: `invited_${Date.now()}`, points: 0, gamesPlayed: 0, correctAnswers: 0, totalAnswers: 0, isAdmin: false },
    ]);

    const [link] = await db.insert(referralLinks).values({
      code: `TESTREF${randomUUID().slice(0, 6)}`,
      createdByUserId: referrerId,
      purpose: 'INVITE',
      destinationPath: '/',
      isActive: true,
    }).returning();
    referralLinkId = link.id;

    await db.insert(referralAttributions).values({
      referralLinkId,
      invitedUserId,
      eventType: 'FIRST_MATCH',
    });
  });

  afterAll(async () => {
    // Clean up in FK-safe order
    for (const userId of [referrerId, invitedUserId]) {
      const wallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, userId) });
      if (wallet) {
        const buckets = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, userId));
        if (buckets.length > 0) {
          await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, buckets.map(b => b.id)));
        }
        await db.delete(packptsBucket).where(eq(packptsBucket.userId, userId));
        await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
        await db.delete(wallets).where(eq(wallets.id, wallet.id));
      }
    }
    await db.delete(referralAttributions).where(eq(referralAttributions.referralLinkId, referralLinkId));
    await db.delete(referralLinks).where(eq(referralLinks.id, referralLinkId));
    await db.delete(users).where(inArray(users.id, [referrerId, invitedUserId]));
  });

  it('credits both wallets on first qualifying event', async () => {
    const result = await grantReferralBonus(invitedUserId, 'FIRST_MATCH');
    expect(result.granted).toBe(true);

    const referrerWallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, referrerId) });
    const invitedWallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, invitedUserId) });

    expect(referrerWallet?.balance).toBeGreaterThanOrEqual(500);
    expect(invitedWallet?.balance).toBeGreaterThanOrEqual(250);
  });

  it('credits nothing on a duplicate call', async () => {
    const referrerWalletBefore = await db.query.wallets.findFirst({ where: eq(wallets.userId, referrerId) });
    const invitedWalletBefore = await db.query.wallets.findFirst({ where: eq(wallets.userId, invitedUserId) });

    const result = await grantReferralBonus(invitedUserId, 'FIRST_MATCH');
    expect(result.granted).toBe(false);
    expect(result.reason).toBe('already_granted');

    const referrerWalletAfter = await db.query.wallets.findFirst({ where: eq(wallets.userId, referrerId) });
    const invitedWalletAfter = await db.query.wallets.findFirst({ where: eq(wallets.userId, invitedUserId) });

    expect(referrerWalletAfter?.balance).toBe(referrerWalletBefore?.balance);
    expect(invitedWalletAfter?.balance).toBe(invitedWalletBefore?.balance);
  });
});
