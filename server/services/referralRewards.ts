import { db } from "../db";
import { wallets, ledgerEntries, referralAttributions, referralLinks, appConfig } from "@shared/schema";
import { eq, and, sql, gte, or } from "drizzle-orm";
import { bucketService } from "./bucketService";

/**
 * Ambassador Tier System for Referral Program
 *
 * Tiers:
 *   Bronze: 5+ referrals → badge + 1.25x daily earn cap
 *   Silver: 25+ referrals → badge + 1.5x daily earn cap + early access flag
 *   Gold: 100+ referrals → badge + 2x daily earn cap + revenue share flag
 */

export const AMBASSADOR_TIERS = [
  {
    name: 'bronze' as const,
    label: 'Bronze Ambassador',
    minReferrals: 5,
    dailyCapMultiplier: 1.25,
    earlyAccess: false,
    revenueShare: false,
    badgeColor: '#CD7F32',
    description: '5+ successful referrals',
  },
  {
    name: 'silver' as const,
    label: 'Silver Ambassador',
    minReferrals: 25,
    dailyCapMultiplier: 1.5,
    earlyAccess: true,
    revenueShare: false,
    badgeColor: '#C0C0C0',
    description: '25+ successful referrals',
  },
  {
    name: 'gold' as const,
    label: 'Gold Ambassador',
    minReferrals: 100,
    dailyCapMultiplier: 2.0,
    earlyAccess: true,
    revenueShare: true,
    badgeColor: '#FFD700',
    description: '100+ successful referrals',
  },
] as const;

export type AmbassadorTierName = typeof AMBASSADOR_TIERS[number]['name'];

export interface AmbassadorTier {
  name: AmbassadorTierName | null;
  label: string;
  referralCount: number;
  dailyCapMultiplier: number;
  earlyAccess: boolean;
  revenueShare: boolean;
  nextTier: {
    name: string;
    referralsNeeded: number;
  } | null;
}

/**
 * Calculate a user's ambassador tier based on their referral count.
 */
export function calculateAmbassadorTier(referralCount: number): AmbassadorTier {
  // Find the highest tier the user qualifies for (tiers sorted descending)
  const qualifiedTier = [...AMBASSADOR_TIERS]
    .reverse()
    .find(t => referralCount >= t.minReferrals);

  // Find the next tier
  const nextTierDef = qualifiedTier
    ? AMBASSADOR_TIERS.find(t => t.minReferrals > qualifiedTier.minReferrals)
    : AMBASSADOR_TIERS[0];

  return {
    name: qualifiedTier?.name ?? null,
    label: qualifiedTier?.label ?? 'Member',
    referralCount,
    dailyCapMultiplier: qualifiedTier?.dailyCapMultiplier ?? 1.0,
    earlyAccess: qualifiedTier?.earlyAccess ?? false,
    revenueShare: qualifiedTier?.revenueShare ?? false,
    nextTier: nextTierDef
      ? {
          name: nextTierDef.label,
          referralsNeeded: nextTierDef.minReferrals - referralCount,
        }
      : null,
  };
}

// Default bonus amounts — overridable at runtime via appConfig keys:
//   "referral_referrer_bonus_pts"  → points credited to the referrer on FIRST_MATCH
//   "referral_referred_bonus_pts"  → points credited to the invited user on FIRST_MATCH
const DEFAULT_REFERRER_BONUS = 500;
const DEFAULT_REFERRED_BONUS = 250;
const REFERRAL_WELCOME_BONUS_POINTS = 100;
const DAILY_REFERRAL_BONUS_CAP = 1000;

async function getReferralBonusConfig(): Promise<{ referrerBonus: number; referredBonus: number }> {
  const [referrerRow, referredRow] = await Promise.all([
    db.query.appConfig.findFirst({ where: eq(appConfig.key, "referral_referrer_bonus_pts") }),
    db.query.appConfig.findFirst({ where: eq(appConfig.key, "referral_referred_bonus_pts") }),
  ]);
  return {
    referrerBonus: typeof referrerRow?.value === "number" ? referrerRow.value : DEFAULT_REFERRER_BONUS,
    referredBonus: typeof referredRow?.value === "number" ? referredRow.value : DEFAULT_REFERRED_BONUS,
  };
}

export async function grantReferralBonus(invitedUserId: string, eventType: "FIRST_MATCH"): Promise<{ granted: boolean; reason?: string }> {
  try {
    const [attribution] = await db.select()
      .from(referralAttributions)
      .where(and(
        eq(referralAttributions.invitedUserId, invitedUserId),
        eq(referralAttributions.eventType, eventType),
      ))
      .limit(1);

    if (!attribution) {
      return { granted: false, reason: "no_attribution" };
    }

    const [link] = await db.select()
      .from(referralLinks)
      .where(eq(referralLinks.id, attribution.referralLinkId))
      .limit(1);

    if (!link) {
      return { granted: false, reason: "no_link" };
    }

    const referrerId = link.createdByUserId;
    const { referrerBonus, referredBonus } = await getReferralBonusConfig();

    const referrerKey = `referral_first_match_referrer:${referrerId}:${invitedUserId}`;
    const referredKey = `referral_first_match_referred:${invitedUserId}:${referrerId}`;
    // Legacy key guard: prevents a second grant if the old one-sided bonus already ran
    const legacyKey = `referral_bonus:${referrerId}:${invitedUserId}:${eventType}`;

    return await db.transaction(async (tx) => {
      // If any credit for this pair has already been recorded, the whole event is done
      const existing = await tx.select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(or(
          eq(ledgerEntries.idempotencyKey, referrerKey),
          eq(ledgerEntries.idempotencyKey, referredKey),
          eq(ledgerEntries.idempotencyKey, legacyKey),
        ))
        .limit(1);

      if (existing.length > 0) {
        return { granted: false, reason: "already_granted" };
      }

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      // --- Credit referrer ---
      let [referrerWallet] = await tx.select()
        .from(wallets)
        .where(eq(wallets.userId, referrerId))
        .for("update")
        .limit(1);

      if (!referrerWallet) {
        const [newWallet] = await tx.insert(wallets).values({
          userId: referrerId,
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
          status: "active",
        }).returning();
        referrerWallet = newWallet;
      }

      if (referrerWallet.status === "active") {
        const todayBonuses = await tx.select({
          total: sql<number>`COALESCE(SUM(${ledgerEntries.amount}), 0)`,
        })
          .from(ledgerEntries)
          .where(and(
            eq(ledgerEntries.walletId, referrerWallet.id),
            eq(ledgerEntries.source, "referral"),
            gte(ledgerEntries.createdAt, todayStart),
          ));

        const todayTotal = Number(todayBonuses[0]?.total || 0);
        if (todayTotal < DAILY_REFERRAL_BONUS_CAP) {
          const newReferrerBalance = referrerWallet.balance + referrerBonus;
          const [referrerEntry] = await tx.insert(ledgerEntries).values({
            walletId: referrerWallet.id,
            entryType: "EARN",
            amount: referrerBonus,
            balanceAfter: newReferrerBalance,
            reason: `Referral reward: your invited player completed their first game`,
            source: "referral",
            eventType: "referral_first_match_referrer",
            refType: "referral",
            refId: invitedUserId,
            metadata: { invitedUserId, attributionId: attribution.id, referralLinkId: link.id },
            idempotencyKey: referrerKey,
          }).returning();

          await tx.update(wallets).set({
            balance: newReferrerBalance,
            lifetimeEarned: referrerWallet.lifetimeEarned + referrerBonus,
            updatedAt: new Date(),
          }).where(eq(wallets.id, referrerWallet.id));

          await bucketService.createBucket(
            referrerId,
            referrerBonus,
            "BONUS",
            referrerEntry.id,
            { source: "referral_first_match_referrer", invitedUserId, eventType },
            undefined,
            tx,
          );
        }
      }

      // --- Credit invited user ---
      let [referredWallet] = await tx.select()
        .from(wallets)
        .where(eq(wallets.userId, invitedUserId))
        .for("update")
        .limit(1);

      if (!referredWallet) {
        const [newWallet] = await tx.insert(wallets).values({
          userId: invitedUserId,
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
          status: "active",
        }).returning();
        referredWallet = newWallet;
      }

      if (referredWallet.status === "active") {
        const newReferredBalance = referredWallet.balance + referredBonus;
        const [referredEntry] = await tx.insert(ledgerEntries).values({
          walletId: referredWallet.id,
          entryType: "EARN",
          amount: referredBonus,
          balanceAfter: newReferredBalance,
          reason: `Referral reward: bonus for completing your first game via referral`,
          source: "referral",
          eventType: "referral_first_match_referred",
          refType: "referral",
          refId: referrerId,
          metadata: { referrerId, attributionId: attribution.id, referralLinkId: link.id },
          idempotencyKey: referredKey,
        }).returning();

        await tx.update(wallets).set({
          balance: newReferredBalance,
          lifetimeEarned: referredWallet.lifetimeEarned + referredBonus,
          updatedAt: new Date(),
        }).where(eq(wallets.id, referredWallet.id));

        await bucketService.createBucket(
          invitedUserId,
          referredBonus,
          "BONUS",
          referredEntry.id,
          { source: "referral_first_match_referred", referrerId, eventType },
          undefined,
          tx,
        );
      }

      console.log(`[ReferralRewards] Double-sided grant: referrer ${referrerId} +${referrerBonus}pts, invited ${invitedUserId} +${referredBonus}pts`);
      return { granted: true };
    });
  } catch (err: any) {
    console.error("[ReferralRewards] Error:", err?.message);
    return { granted: false, reason: "error" };
  }
}

export async function grantReferralWelcomeBonus(invitedUserId: string, referralLinkId: string): Promise<{ granted: boolean; reason?: string }> {
  try {
    const idempotencyKey = `referral_welcome:${invitedUserId}:${referralLinkId}`;

    return await db.transaction(async (tx) => {
      const existing = await tx.select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing.length > 0) {
        return { granted: false, reason: "already_granted" };
      }

      let [wallet] = await tx.select()
        .from(wallets)
        .where(eq(wallets.userId, invitedUserId))
        .for("update")
        .limit(1);

      if (!wallet) {
        const [newWallet] = await tx.insert(wallets).values({
          userId: invitedUserId,
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
          status: "active",
        }).returning();
        wallet = newWallet;
      }

      if (wallet.status !== "active") {
        return { granted: false, reason: "wallet_inactive" };
      }

      const newBalance = wallet.balance + REFERRAL_WELCOME_BONUS_POINTS;

      const [entry] = await tx.insert(ledgerEntries).values({
        walletId: wallet.id,
        entryType: "EARN",
        amount: REFERRAL_WELCOME_BONUS_POINTS,
        balanceAfter: newBalance,
        reason: `Welcome bonus: joined via referral link`,
        source: "referral",
        eventType: "referral_welcome",
        refType: "referral",
        refId: referralLinkId,
        metadata: {
          referralLinkId,
          invitedUserId,
        },
        idempotencyKey,
      }).returning();

      await tx.update(wallets).set({
        balance: newBalance,
        lifetimeEarned: wallet.lifetimeEarned + REFERRAL_WELCOME_BONUS_POINTS,
        updatedAt: new Date(),
      }).where(eq(wallets.id, wallet.id));

      await bucketService.createBucket(
        invitedUserId,
        REFERRAL_WELCOME_BONUS_POINTS,
        "BONUS",
        entry.id,
        {
          source: "referral_welcome",
          referralLinkId,
        },
        undefined,
        tx,
      );

      console.log(`[ReferralRewards] Granted ${REFERRAL_WELCOME_BONUS_POINTS} welcome pts to ${invitedUserId} via referral link ${referralLinkId}`);
      return { granted: true };
    });
  } catch (err: any) {
    console.error("[ReferralRewards] Welcome bonus error:", err?.message);
    return { granted: false, reason: "error" };
  }
}
