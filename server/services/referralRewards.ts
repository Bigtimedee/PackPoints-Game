import { db } from "../db";
import { wallets, ledgerEntries, referralAttributions, referralLinks } from "@shared/schema";
import { eq, and, sql, gte } from "drizzle-orm";
import { bucketService } from "./bucketService";

const REFERRAL_BONUS_POINTS = 50;
const DAILY_REFERRAL_BONUS_CAP = 500;

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
    const idempotencyKey = `referral_bonus:${referrerId}:${invitedUserId}:${eventType}`;

    return await db.transaction(async (tx) => {
      const existing = await tx.select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing.length > 0) {
        return { granted: false, reason: "already_granted" };
      }

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      let [wallet] = await tx.select()
        .from(wallets)
        .where(eq(wallets.userId, referrerId))
        .for("update")
        .limit(1);

      if (!wallet) {
        const [newWallet] = await tx.insert(wallets).values({
          userId: referrerId,
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

      const todayBonuses = await tx.select({
        total: sql<number>`COALESCE(SUM(${ledgerEntries.amount}), 0)`,
      })
        .from(ledgerEntries)
        .where(and(
          eq(ledgerEntries.walletId, wallet.id),
          eq(ledgerEntries.source, "referral"),
          gte(ledgerEntries.createdAt, todayStart),
        ));

      const todayTotal = Number(todayBonuses[0]?.total || 0);
      if (todayTotal >= DAILY_REFERRAL_BONUS_CAP) {
        return { granted: false, reason: "daily_cap_reached" };
      }

      const newBalance = wallet.balance + REFERRAL_BONUS_POINTS;

      const [entry] = await tx.insert(ledgerEntries).values({
        walletId: wallet.id,
        entryType: "EARN",
        amount: REFERRAL_BONUS_POINTS,
        balanceAfter: newBalance,
        reason: `Referral bonus: invited user completed first match`,
        source: "referral",
        eventType: "referral_first_match",
        refType: "referral",
        refId: invitedUserId,
        metadata: {
          invitedUserId,
          attributionId: attribution.id,
          referralLinkId: link.id,
        },
        idempotencyKey,
      }).returning();

      await tx.update(wallets).set({
        balance: newBalance,
        lifetimeEarned: wallet.lifetimeEarned + REFERRAL_BONUS_POINTS,
        updatedAt: new Date(),
      }).where(eq(wallets.id, wallet.id));

      await bucketService.createBucket(
        referrerId,
        REFERRAL_BONUS_POINTS,
        "BONUS",
        entry.id,
        {
          source: "referral_bonus",
          invitedUserId,
          eventType,
        },
        undefined,
        tx,
      );

      console.log(`[ReferralRewards] Granted ${REFERRAL_BONUS_POINTS} pts to ${referrerId} for referring ${invitedUserId}`);
      return { granted: true };
    });
  } catch (err: any) {
    console.error("[ReferralRewards] Error:", err?.message);
    return { granted: false, reason: "error" };
  }
}
