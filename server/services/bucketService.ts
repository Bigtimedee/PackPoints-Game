import { db } from "../db";
import {
  packptsBucket,
  packptsExpirationPolicy,
  packptsSpendAllocation,
  ledgerEntries,
  type PackptsBucket,
  type PackptsExpirationPolicy,
  type BucketSourceType,
} from "@shared/schema";
import { eq, and, asc, isNull, lte, gt, sql } from "drizzle-orm";

export interface BucketCreationResult {
  success: boolean;
  bucket?: PackptsBucket;
  error?: string;
}

export interface SpendAllocationResult {
  success: boolean;
  allocations?: Array<{ bucketId: string; amount: number }>;
  error?: string;
}

export interface UserExpirationInfo {
  totalBalance: number;
  expiringNext30Days: number;
  expiringNext60Days: number;
  expiringNext90Days: number;
  nextExpirationDate: Date | null;
  nextExpirationAmount: number;
  bucketsBySource: {
    earned: number;
    purchased: number;
    bonus: number;
    adjustment: number;
  };
}

export interface WeeklyExpiration {
  weekStart: string;
  weekEnd: string;
  amount: number;
}

class BucketService {
  async getCurrentPolicy(): Promise<PackptsExpirationPolicy | null> {
    const result = await db
      .select()
      .from(packptsExpirationPolicy)
      .where(
        and(
          eq(packptsExpirationPolicy.enabled, true),
          lte(packptsExpirationPolicy.effectiveFrom, new Date())
        )
      )
      .orderBy(sql`${packptsExpirationPolicy.effectiveFrom} DESC`)
      .limit(1);

    return result.length > 0 ? result[0] : null;
  }

  calculateExpirationDate(
    sourceType: BucketSourceType,
    earnedAt: Date,
    policy: PackptsExpirationPolicy,
    overrideDays?: number
  ): Date | null {
    let daysToExpire: number | null = null;

    if (overrideDays !== undefined) {
      daysToExpire = overrideDays;
    } else {
      switch (sourceType) {
        case "EARNED":
          daysToExpire = policy.earnedDaysToExpire;
          break;
        case "PURCHASED":
          daysToExpire = policy.purchasedDaysToExpire;
          break;
        case "BONUS":
          daysToExpire = policy.bonusDefaultDaysToExpire;
          break;
        case "ADJUSTMENT":
          daysToExpire = null;
          break;
      }
    }

    if (daysToExpire === null) {
      return null;
    }

    const expiresAt = new Date(earnedAt);
    expiresAt.setDate(expiresAt.getDate() + daysToExpire);
    return expiresAt;
  }

  async createBucket(
    userId: string,
    amount: number,
    sourceType: BucketSourceType,
    ledgerEntryId: string,
    metadata?: Record<string, unknown>,
    overrideExpireDays?: number
  ): Promise<BucketCreationResult> {
    if (amount <= 0) {
      return { success: false, error: "Amount must be positive" };
    }

    const policy = await this.getCurrentPolicy();
    const earnedAt = new Date();
    let expiresAt: Date | null = null;

    if (policy) {
      expiresAt = this.calculateExpirationDate(
        sourceType,
        earnedAt,
        policy,
        overrideExpireDays
      );
    }

    const [bucket] = await db
      .insert(packptsBucket)
      .values({
        userId,
        sourceType,
        originalAmount: amount,
        remainingAmount: amount,
        earnedAt,
        expiresAt,
        createdFromLedgerEntryId: ledgerEntryId,
        status: "OPEN",
        metadata: metadata || null,
      })
      .returning();

    return { success: true, bucket };
  }

  async getUserOpenBuckets(userId: string): Promise<PackptsBucket[]> {
    return await db
      .select()
      .from(packptsBucket)
      .where(
        and(
          eq(packptsBucket.userId, userId),
          eq(packptsBucket.status, "OPEN"),
          gt(packptsBucket.remainingAmount, 0)
        )
      )
      .orderBy(
        asc(packptsBucket.expiresAt),
        asc(packptsBucket.earnedAt)
      );
  }

  async getUserOpenBucketsFIFO(userId: string): Promise<PackptsBucket[]> {
    const bucketsWithExpiry = await db
      .select()
      .from(packptsBucket)
      .where(
        and(
          eq(packptsBucket.userId, userId),
          eq(packptsBucket.status, "OPEN"),
          gt(packptsBucket.remainingAmount, 0),
          sql`${packptsBucket.expiresAt} IS NOT NULL`
        )
      )
      .orderBy(asc(packptsBucket.expiresAt), asc(packptsBucket.earnedAt));

    const bucketsWithoutExpiry = await db
      .select()
      .from(packptsBucket)
      .where(
        and(
          eq(packptsBucket.userId, userId),
          eq(packptsBucket.status, "OPEN"),
          gt(packptsBucket.remainingAmount, 0),
          isNull(packptsBucket.expiresAt)
        )
      )
      .orderBy(asc(packptsBucket.earnedAt));

    return [...bucketsWithExpiry, ...bucketsWithoutExpiry];
  }

  async allocateSpend(
    userId: string,
    amount: number,
    spendLedgerEntryId: string,
    tx?: any
  ): Promise<SpendAllocationResult> {
    const executor = tx || db;

    const buckets = await this.getUserOpenBucketsFIFO(userId);
    let remainingToAllocate = amount;
    const allocations: Array<{ bucketId: string; amount: number }> = [];

    for (const bucket of buckets) {
      if (remainingToAllocate <= 0) break;

      const allocateAmount = Math.min(bucket.remainingAmount, remainingToAllocate);

      await executor
        .update(packptsBucket)
        .set({
          remainingAmount: bucket.remainingAmount - allocateAmount,
          status: bucket.remainingAmount - allocateAmount === 0 ? "DEPLETED" : "OPEN",
          updatedAt: new Date(),
        })
        .where(eq(packptsBucket.id, bucket.id));

      await executor.insert(packptsSpendAllocation).values({
        spendLedgerEntryId,
        bucketId: bucket.id,
        amount: allocateAmount,
      });

      allocations.push({ bucketId: bucket.id, amount: allocateAmount });
      remainingToAllocate -= allocateAmount;
    }

    if (remainingToAllocate > 0) {
      return {
        success: false,
        error: `Could only allocate ${amount - remainingToAllocate} of ${amount} from buckets`,
      };
    }

    return { success: true, allocations };
  }

  async getUserExpirationInfo(userId: string): Promise<UserExpirationInfo> {
    const now = new Date();
    const in30Days = new Date(now);
    in30Days.setDate(in30Days.getDate() + 30);
    const in60Days = new Date(now);
    in60Days.setDate(in60Days.getDate() + 60);
    const in90Days = new Date(now);
    in90Days.setDate(in90Days.getDate() + 90);

    const buckets = await db
      .select()
      .from(packptsBucket)
      .where(
        and(
          eq(packptsBucket.userId, userId),
          eq(packptsBucket.status, "OPEN"),
          gt(packptsBucket.remainingAmount, 0)
        )
      );

    let totalBalance = 0;
    let expiringNext30Days = 0;
    let expiringNext60Days = 0;
    let expiringNext90Days = 0;
    let nextExpirationDate: Date | null = null;
    let nextExpirationAmount = 0;
    const bucketsBySource = { earned: 0, purchased: 0, bonus: 0, adjustment: 0 };

    for (const bucket of buckets) {
      totalBalance += bucket.remainingAmount;

      const sourceKey = bucket.sourceType.toLowerCase() as keyof typeof bucketsBySource;
      if (bucketsBySource.hasOwnProperty(sourceKey)) {
        bucketsBySource[sourceKey] += bucket.remainingAmount;
      }

      if (bucket.expiresAt) {
        const expiresAt = new Date(bucket.expiresAt);
        
        if (expiresAt <= in30Days) {
          expiringNext30Days += bucket.remainingAmount;
        }
        if (expiresAt <= in60Days) {
          expiringNext60Days += bucket.remainingAmount;
        }
        if (expiresAt <= in90Days) {
          expiringNext90Days += bucket.remainingAmount;
        }

        if (expiresAt > now && (!nextExpirationDate || expiresAt < nextExpirationDate)) {
          nextExpirationDate = expiresAt;
          nextExpirationAmount = bucket.remainingAmount;
        } else if (nextExpirationDate && expiresAt.getTime() === nextExpirationDate.getTime()) {
          nextExpirationAmount += bucket.remainingAmount;
        }
      }
    }

    return {
      totalBalance,
      expiringNext30Days,
      expiringNext60Days,
      expiringNext90Days,
      nextExpirationDate,
      nextExpirationAmount,
      bucketsBySource,
    };
  }

  async getUpcomingExpirations(userId: string, days: number = 90): Promise<WeeklyExpiration[]> {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + days);

    const buckets = await db
      .select()
      .from(packptsBucket)
      .where(
        and(
          eq(packptsBucket.userId, userId),
          eq(packptsBucket.status, "OPEN"),
          gt(packptsBucket.remainingAmount, 0),
          sql`${packptsBucket.expiresAt} IS NOT NULL`,
          sql`${packptsBucket.expiresAt} > ${now}`,
          sql`${packptsBucket.expiresAt} <= ${endDate}`
        )
      )
      .orderBy(asc(packptsBucket.expiresAt));

    const weeklyMap = new Map<string, number>();

    for (const bucket of buckets) {
      if (!bucket.expiresAt) continue;
      
      const expiresAt = new Date(bucket.expiresAt);
      const weekStart = new Date(expiresAt);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);
      
      const weekKey = weekStart.toISOString().split("T")[0];
      weeklyMap.set(weekKey, (weeklyMap.get(weekKey) || 0) + bucket.remainingAmount);
    }

    const result: WeeklyExpiration[] = [];
    for (const [weekStartStr, amount] of weeklyMap) {
      const weekStart = new Date(weekStartStr);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      result.push({
        weekStart: weekStartStr,
        weekEnd: weekEnd.toISOString().split("T")[0],
        amount,
      });
    }

    return result.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }

  async getTotalUserBucketBalance(userId: string): Promise<number> {
    const result = await db
      .select({
        total: sql<number>`COALESCE(SUM(${packptsBucket.remainingAmount}), 0)`,
      })
      .from(packptsBucket)
      .where(
        and(
          eq(packptsBucket.userId, userId),
          eq(packptsBucket.status, "OPEN")
        )
      );

    return Number(result[0]?.total || 0);
  }

  mapLedgerTypeToSourceType(entryType: string): BucketSourceType {
    switch (entryType) {
      case "EARN":
      case "STREAK_EARN":
        return "EARNED";
      case "PURCHASE_CREDIT":
        return "PURCHASED";
      case "BONUS":
        return "BONUS";
      case "ADJUST":
        return "ADJUSTMENT";
      default:
        return "EARNED";
    }
  }
}

export const bucketService = new BucketService();
