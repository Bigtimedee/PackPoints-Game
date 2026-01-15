import { db } from "../db";
import {
  packptsBucket,
  packptsExpirationPolicy,
  packptsLiabilitySnapshot,
  ledgerEntries,
  wallets,
  users,
  type PackptsBucket,
  type PackptsExpirationPolicy,
  type InsertPackptsLiabilitySnapshot,
  DEFAULT_EXPIRATION_POLICY,
} from "@shared/schema";
import { eq, and, lte, gt, sql, asc, isNull, not, gte } from "drizzle-orm";
import { bucketService } from "./bucketService";

export interface ExpirationJobResult {
  success: boolean;
  expiredBuckets: number;
  totalPointsExpired: number;
  errors: string[];
}

export interface InactivityExpirationResult {
  success: boolean;
  usersAffected: number;
  bucketsExpired: number;
  totalPointsExpired: number;
  errors: string[];
}

export interface LiabilitySnapshotResult {
  success: boolean;
  snapshot?: InsertPackptsLiabilitySnapshot;
  error?: string;
}

class ExpirationEngine {
  async runExpirationJob(dryRun: boolean = false): Promise<ExpirationJobResult> {
    const errors: string[] = [];
    let expiredBuckets = 0;
    let totalPointsExpired = 0;

    const now = new Date();
    const dateKey = now.toISOString().split("T")[0];

    const expiredOpenBuckets = await db
      .select()
      .from(packptsBucket)
      .where(
        and(
          eq(packptsBucket.status, "OPEN"),
          gt(packptsBucket.remainingAmount, 0),
          sql`${packptsBucket.expiresAt} IS NOT NULL`,
          lte(packptsBucket.expiresAt, now)
        )
      )
      .orderBy(asc(packptsBucket.expiresAt));

    for (const bucket of expiredOpenBuckets) {
      const idempotencyKey = `expire_bucket_${bucket.id}_${dateKey}`;

      try {
        const existingEntry = await db
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
          .limit(1);

        if (existingEntry.length > 0) {
          continue;
        }

        if (dryRun) {
          expiredBuckets++;
          totalPointsExpired += bucket.remainingAmount;
          continue;
        }

        const [wallet] = await db
          .select()
          .from(wallets)
          .where(eq(wallets.userId, bucket.userId))
          .limit(1);

        if (!wallet) {
          errors.push(`Wallet not found for user ${bucket.userId}`);
          continue;
        }

        let expiredAmount = 0;
        
        await db.transaction(async (tx) => {
          const [freshWallet] = await tx
            .select()
            .from(wallets)
            .where(eq(wallets.userId, bucket.userId))
            .for("update")
            .limit(1);

          if (!freshWallet) {
            errors.push(`Wallet not found for user ${bucket.userId} during transaction`);
            return;
          }

          const expireAmount = Math.min(bucket.remainingAmount, freshWallet.balance);
          
          if (expireAmount <= 0) {
            return;
          }

          const newBalance = freshWallet.balance - expireAmount;
          const newRemainingAmount = bucket.remainingAmount - expireAmount;
          const newStatus = newRemainingAmount === 0 ? "EXPIRED" : "OPEN";

          await tx.insert(ledgerEntries).values({
            walletId: freshWallet.id,
            entryType: "EXPIRE",
            amount: -expireAmount,
            balanceAfter: newBalance,
            reason: `PackPTS expiration - bucket from ${new Date(bucket.earnedAt).toLocaleDateString()}`,
            metadata: {
              bucketId: bucket.id,
              sourceType: bucket.sourceType,
              originalAmount: bucket.originalAmount,
              expiredAmount: expireAmount,
              remainingInBucket: newRemainingAmount,
              expiredAt: now.toISOString(),
            },
            idempotencyKey,
          });

          await tx
            .update(wallets)
            .set({
              balance: newBalance,
              updatedAt: now,
            })
            .where(eq(wallets.id, freshWallet.id));

          await tx
            .update(packptsBucket)
            .set({
              remainingAmount: newRemainingAmount,
              status: newStatus,
              updatedAt: now,
            })
            .where(eq(packptsBucket.id, bucket.id));

          expiredAmount = expireAmount;
        });

        if (expiredAmount > 0) {
          expiredBuckets++;
          totalPointsExpired += expiredAmount;
        }
      } catch (error) {
        errors.push(`Error expiring bucket ${bucket.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      success: errors.length === 0,
      expiredBuckets,
      totalPointsExpired,
      errors,
    };
  }

  async runInactivityExpiration(dryRun: boolean = false): Promise<InactivityExpirationResult> {
    const errors: string[] = [];
    let usersAffected = 0;
    let bucketsExpired = 0;
    let totalPointsExpired = 0;

    const policy = await bucketService.getCurrentPolicy();
    
    if (!policy || !policy.inactivityEnabled) {
      return {
        success: true,
        usersAffected: 0,
        bucketsExpired: 0,
        totalPointsExpired: 0,
        errors: ["Inactivity expiration is disabled"],
      };
    }

    const now = new Date();
    const dateKey = now.toISOString().split("T")[0];
    const inactivityThreshold = new Date(now);
    inactivityThreshold.setDate(inactivityThreshold.getDate() - policy.inactivityDays);

    const minAgeDate = new Date(now);
    minAgeDate.setDate(minAgeDate.getDate() - policy.inactivityMinAgeDays);

    const usersWithOldBuckets = await db
      .selectDistinct({ userId: packptsBucket.userId })
      .from(packptsBucket)
      .where(
        and(
          eq(packptsBucket.status, "OPEN"),
          gt(packptsBucket.remainingAmount, 0),
          lte(packptsBucket.earnedAt, minAgeDate)
        )
      );

    for (const { userId } of usersWithOldBuckets) {
      try {
        const [wallet] = await db
          .select()
          .from(wallets)
          .where(eq(wallets.userId, userId))
          .limit(1);

        if (!wallet) continue;

        const lastActivity = await db
          .select({ createdAt: ledgerEntries.createdAt })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.walletId, wallet.id))
          .orderBy(sql`${ledgerEntries.createdAt} DESC`)
          .limit(1);

        const lastActivityDate = lastActivity.length > 0 && lastActivity[0].createdAt 
          ? new Date(lastActivity[0].createdAt) 
          : null;
        
        if (lastActivityDate && lastActivityDate > inactivityThreshold) {
          continue;
        }

        const eligibleBuckets = await db
          .select()
          .from(packptsBucket)
          .where(
            and(
              eq(packptsBucket.userId, userId),
              eq(packptsBucket.status, "OPEN"),
              gt(packptsBucket.remainingAmount, 0),
              lte(packptsBucket.earnedAt, minAgeDate)
            )
          );

        if (eligibleBuckets.length === 0) continue;

        let userPointsExpired = 0;
        for (const bucket of eligibleBuckets) {
          const idempotencyKey = `inactivity_expire_${bucket.id}_${dateKey}`;

          const existingEntry = await db
            .select()
            .from(ledgerEntries)
            .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
            .limit(1);

          if (existingEntry.length > 0) continue;

          if (dryRun) {
            bucketsExpired++;
            totalPointsExpired += bucket.remainingAmount;
            userPointsExpired += bucket.remainingAmount;
            continue;
          }

          const [wallet] = await db
            .select()
            .from(wallets)
            .where(eq(wallets.userId, userId))
            .limit(1);

          if (!wallet) continue;

          await db.transaction(async (tx) => {
            const newBalance = wallet.balance - bucket.remainingAmount;
            
            if (newBalance < 0) return;

            await tx.insert(ledgerEntries).values({
              walletId: wallet.id,
              entryType: "EXPIRE",
              amount: -bucket.remainingAmount,
              balanceAfter: newBalance,
              reason: `PackPTS inactivity expiration - ${policy.inactivityDays} days inactive`,
              metadata: {
                bucketId: bucket.id,
                sourceType: bucket.sourceType,
                inactivityDays: policy.inactivityDays,
                lastActivityDate: lastActivityDate?.toISOString() || null,
              },
              idempotencyKey,
            });

            await tx
              .update(wallets)
              .set({
                balance: newBalance,
                updatedAt: now,
              })
              .where(eq(wallets.id, wallet.id));

            await tx
              .update(packptsBucket)
              .set({
                remainingAmount: 0,
                status: "EXPIRED",
                updatedAt: now,
              })
              .where(eq(packptsBucket.id, bucket.id));
          });

          bucketsExpired++;
          totalPointsExpired += bucket.remainingAmount;
          userPointsExpired += bucket.remainingAmount;
        }

        if (userPointsExpired > 0) {
          usersAffected++;
        }
      } catch (error) {
        errors.push(`Error processing user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      success: errors.length === 0,
      usersAffected,
      bucketsExpired,
      totalPointsExpired,
      errors,
    };
  }

  async createLiabilitySnapshot(): Promise<LiabilitySnapshotResult> {
    const now = new Date();
    const asOfDate = now.toISOString().split("T")[0];

    const existingSnapshot = await db
      .select()
      .from(packptsLiabilitySnapshot)
      .where(eq(packptsLiabilitySnapshot.asOfDate, asOfDate))
      .limit(1);

    if (existingSnapshot.length > 0) {
      return {
        success: true,
        snapshot: existingSnapshot[0] as InsertPackptsLiabilitySnapshot,
      };
    }

    const allOpenBuckets = await db
      .select()
      .from(packptsBucket)
      .where(
        and(
          eq(packptsBucket.status, "OPEN"),
          gt(packptsBucket.remainingAmount, 0)
        )
      );

    let totalOutstanding = 0;
    let outstandingEarned = 0;
    let outstandingPurchased = 0;
    let outstandingBonus = 0;
    let expiring30d = 0;
    let expiring60d = 0;
    let expiring90d = 0;
    let aged0_30 = 0;
    let aged31_90 = 0;
    let aged91_180 = 0;
    let aged181_365 = 0;
    let aged366Plus = 0;

    const in30Days = new Date(now);
    in30Days.setDate(in30Days.getDate() + 30);
    const in60Days = new Date(now);
    in60Days.setDate(in60Days.getDate() + 60);
    const in90Days = new Date(now);
    in90Days.setDate(in90Days.getDate() + 90);

    for (const bucket of allOpenBuckets) {
      totalOutstanding += bucket.remainingAmount;

      switch (bucket.sourceType) {
        case "EARNED":
          outstandingEarned += bucket.remainingAmount;
          break;
        case "PURCHASED":
          outstandingPurchased += bucket.remainingAmount;
          break;
        case "BONUS":
          outstandingBonus += bucket.remainingAmount;
          break;
      }

      if (bucket.expiresAt) {
        const expiresAt = new Date(bucket.expiresAt);
        if (expiresAt <= in30Days) {
          expiring30d += bucket.remainingAmount;
        }
        if (expiresAt <= in60Days) {
          expiring60d += bucket.remainingAmount;
        }
        if (expiresAt <= in90Days) {
          expiring90d += bucket.remainingAmount;
        }
      }

      const earnedAt = new Date(bucket.earnedAt);
      const ageDays = Math.floor((now.getTime() - earnedAt.getTime()) / (1000 * 60 * 60 * 24));
      
      if (ageDays <= 30) {
        aged0_30 += bucket.remainingAmount;
      } else if (ageDays <= 90) {
        aged31_90 += bucket.remainingAmount;
      } else if (ageDays <= 180) {
        aged91_180 += bucket.remainingAmount;
      } else if (ageDays <= 365) {
        aged181_365 += bucket.remainingAmount;
      } else {
        aged366Plus += bucket.remainingAmount;
      }
    }

    const breakageEstimatePct = DEFAULT_EXPIRATION_POLICY.breakageEstimatePct;
    const projectedBreakage = Math.floor((totalOutstanding * breakageEstimatePct) / 100);

    const [snapshot] = await db
      .insert(packptsLiabilitySnapshot)
      .values({
        asOfDate,
        totalOutstanding,
        outstandingEarned,
        outstandingPurchased,
        outstandingBonus,
        expiring30d,
        expiring60d,
        expiring90d,
        aged0_30,
        aged31_90,
        aged91_180,
        aged181_365,
        aged366Plus,
        breakageEstimatePct,
        projectedBreakage,
        metadata: {
          bucketCount: allOpenBuckets.length,
          generatedAt: now.toISOString(),
        },
      })
      .returning();

    return {
      success: true,
      snapshot: snapshot as InsertPackptsLiabilitySnapshot,
    };
  }

  async getLatestLiabilitySnapshot(): Promise<InsertPackptsLiabilitySnapshot | null> {
    const result = await db
      .select()
      .from(packptsLiabilitySnapshot)
      .orderBy(sql`${packptsLiabilitySnapshot.asOfDate} DESC`)
      .limit(1);

    return result.length > 0 ? (result[0] as InsertPackptsLiabilitySnapshot) : null;
  }

  async getGracePeriodBuckets(userId: string): Promise<PackptsBucket[]> {
    const policy = await bucketService.getCurrentPolicy();
    if (!policy) return [];

    const now = new Date();
    const gracePeriodEnd = new Date(now);
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + policy.gracePeriodDays);

    return await db
      .select()
      .from(packptsBucket)
      .where(
        and(
          eq(packptsBucket.userId, userId),
          eq(packptsBucket.status, "OPEN"),
          gt(packptsBucket.remainingAmount, 0),
          sql`${packptsBucket.expiresAt} IS NOT NULL`,
          gt(packptsBucket.expiresAt, now),
          lte(packptsBucket.expiresAt, gracePeriodEnd)
        )
      )
      .orderBy(asc(packptsBucket.expiresAt));
  }

  async getExpirationPolicy(): Promise<PackptsExpirationPolicy | null> {
    return bucketService.getCurrentPolicy();
  }

  async updateExpirationPolicy(
    updates: Partial<PackptsExpirationPolicy>
  ): Promise<PackptsExpirationPolicy | null> {
    const currentPolicy = await bucketService.getCurrentPolicy();
    
    if (!currentPolicy) {
      return null;
    }

    const [updated] = await db
      .update(packptsExpirationPolicy)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(packptsExpirationPolicy.id, currentPolicy.id))
      .returning();

    return updated;
  }
}

export const expirationEngine = new ExpirationEngine();
