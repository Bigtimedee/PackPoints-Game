import { db } from "../db";
import { 
  adminAuditLog, 
  users, 
  wallets, 
  ledgerEntries, 
  purchaseEvents, 
  userEntitlements, 
  featureFlags,
  eventLog,
  type InsertAdminAuditLog 
} from "@shared/schema";
import { eq, sql, desc, ilike, and, gte, lte, count } from "drizzle-orm";
import { walletService } from "./walletService";
import { storage } from "../storage";

interface AdminActionContext {
  adminUserId: string;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
}

class AdminService {
  async logAction(
    adminUserId: string,
    action: string,
    targetUserId?: string | null,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await db.insert(adminAuditLog).values({
      adminUserId,
      action,
      targetUserId: targetUserId || null,
      metadata: metadata || null,
    });
  }

  async searchUsers(
    search: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ users: any[]; total: number; page: number; totalPages: number }> {
    const offset = (page - 1) * limit;
    
    const searchCondition = search 
      ? ilike(users.username, `%${search}%`)
      : undefined;

    const [userResults, countResult] = await Promise.all([
      db.select()
        .from(users)
        .where(searchCondition)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() })
        .from(users)
        .where(searchCondition),
    ]);

    const total = countResult[0]?.count || 0;

    return {
      users: userResults,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserWallet(userId: string): Promise<{
    wallet: any;
    ledger: any[];
  } | null> {
    const walletData = await walletService.getWalletWithHistory(userId, 50);
    if (!walletData) {
      return null;
    }
    return {
      wallet: walletData.wallet,
      ledger: walletData.recentEntries,
    };
  }

  async getPurchaseEvents(
    page: number = 1,
    limit: number = 20,
    status?: string,
    userId?: string
  ): Promise<{ events: any[]; total: number; page: number; totalPages: number }> {
    const offset = (page - 1) * limit;
    
    const conditions = [];
    if (status) conditions.push(eq(purchaseEvents.status, status));
    if (userId) conditions.push(eq(purchaseEvents.userId, userId));
    
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [events, countResult] = await Promise.all([
      db.select()
        .from(purchaseEvents)
        .where(whereClause)
        .orderBy(desc(purchaseEvents.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() })
        .from(purchaseEvents)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count || 0;

    return {
      events,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserEntitlements(userId: string): Promise<any[]> {
    return db.select()
      .from(userEntitlements)
      .where(eq(userEntitlements.userId, userId))
      .orderBy(desc(userEntitlements.createdAt));
  }

  async grantEntitlement(
    ctx: AdminActionContext,
    entitlementKey: string,
    expiresAt?: Date | null
  ): Promise<{ success: boolean; error?: string }> {
    if (!ctx.targetUserId) {
      return { success: false, error: "Target user ID required" };
    }

    try {
      await storage.grantEntitlement({
        userId: ctx.targetUserId,
        entitlementKey,
        source: "admin_grant",
        sourceReference: `admin:${ctx.adminUserId}`,
        expiresAt: expiresAt || null,
      });

      await this.logAction(ctx.adminUserId, "grant_entitlement", ctx.targetUserId, {
        entitlementKey,
        expiresAt: expiresAt?.toISOString() || null,
      });

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to grant entitlement" 
      };
    }
  }

  async revokeEntitlement(
    ctx: AdminActionContext,
    entitlementKey: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!ctx.targetUserId) {
      return { success: false, error: "Target user ID required" };
    }

    try {
      await storage.revokeEntitlement(ctx.targetUserId, entitlementKey, reason);

      await this.logAction(ctx.adminUserId, "revoke_entitlement", ctx.targetUserId, {
        entitlementKey,
        reason,
      });

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to revoke entitlement" 
      };
    }
  }

  async adjustPackPTS(
    ctx: AdminActionContext,
    amount: number,
    reason: string
  ): Promise<{ success: boolean; error?: string; newBalance?: number }> {
    if (!ctx.targetUserId) {
      return { success: false, error: "Target user ID required" };
    }

    try {
      const result = await walletService.adjust(
        ctx.targetUserId,
        amount,
        reason,
        `admin_adjust_${Date.now()}_${Math.random().toString(36).substring(7)}`
      );

      if (!result.success) {
        return { success: false, error: result.error };
      }

      await this.logAction(ctx.adminUserId, "adjust_packpts", ctx.targetUserId, {
        amount,
        reason,
        newBalance: result.wallet?.balance,
      });

      return { success: true, newBalance: result.wallet?.balance };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to adjust PackPTS" 
      };
    }
  }

  async getFeatureFlags(): Promise<any[]> {
    return db.select()
      .from(featureFlags)
      .orderBy(featureFlags.key);
  }

  async toggleFeatureFlag(
    ctx: AdminActionContext,
    key: string,
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const existing = await db.select()
        .from(featureFlags)
        .where(eq(featureFlags.key, key))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(featureFlags).values({
          key,
          enabled,
        });
      } else {
        await db.update(featureFlags)
          .set({ enabled, updatedAt: new Date() })
          .where(eq(featureFlags.key, key));
      }

      await this.logAction(ctx.adminUserId, "toggle_feature_flag", null, {
        key,
        enabled,
      });

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to toggle feature flag" 
      };
    }
  }

  async updateFeatureFlagValue(
    ctx: AdminActionContext,
    key: string,
    value: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const existing = await db.select()
        .from(featureFlags)
        .where(eq(featureFlags.key, key))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(featureFlags).values({
          key,
          enabled: true,
          value,
        });
      } else {
        await db.update(featureFlags)
          .set({ value, updatedAt: new Date() })
          .where(eq(featureFlags.key, key));
      }

      await this.logAction(ctx.adminUserId, "update_feature_flag_value", null, {
        key,
        value,
      });

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to update feature flag value" 
      };
    }
  }

  async getAuditLog(
    page: number = 1,
    limit: number = 50,
    adminUserId?: string
  ): Promise<{ entries: any[]; total: number; page: number; totalPages: number }> {
    const offset = (page - 1) * limit;
    
    const whereClause = adminUserId 
      ? eq(adminAuditLog.adminUserId, adminUserId)
      : undefined;

    const [entries, countResult] = await Promise.all([
      db.select()
        .from(adminAuditLog)
        .where(whereClause)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() })
        .from(adminAuditLog)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count || 0;

    return {
      entries,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getMetrics(date?: string): Promise<{
    dau: number;
    matchesPerUser: number;
    purchaseConversionRate: number;
    grossPurchaseCount: number;
    packptsLiability: number;
    redemptionRate: number;
  }> {
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const [
      dauResult,
      matchStartedResult,
      matchCompletedResult,
      purchaseStartedResult,
      purchaseCompletedResult,
      liabilityResult,
      redeemStartedResult,
      redeemCompletedResult,
    ] = await Promise.all([
      db.select({ count: sql<number>`COUNT(DISTINCT user_id)` })
        .from(eventLog)
        .where(and(
          gte(eventLog.createdAt, startOfDay),
          lte(eventLog.createdAt, endOfDay)
        )),
      db.select({ count: count() })
        .from(eventLog)
        .where(and(
          eq(eventLog.eventType, "match_started"),
          gte(eventLog.createdAt, startOfDay),
          lte(eventLog.createdAt, endOfDay)
        )),
      db.select({ count: count() })
        .from(eventLog)
        .where(and(
          eq(eventLog.eventType, "match_completed"),
          gte(eventLog.createdAt, startOfDay),
          lte(eventLog.createdAt, endOfDay)
        )),
      db.select({ count: count() })
        .from(eventLog)
        .where(and(
          eq(eventLog.eventType, "purchase_started"),
          gte(eventLog.createdAt, startOfDay),
          lte(eventLog.createdAt, endOfDay)
        )),
      db.select({ count: count() })
        .from(eventLog)
        .where(and(
          eq(eventLog.eventType, "purchase_completed"),
          gte(eventLog.createdAt, startOfDay),
          lte(eventLog.createdAt, endOfDay)
        )),
      db.select({ total: sql<number>`COALESCE(SUM(balance), 0)` })
        .from(wallets),
      db.select({ count: count() })
        .from(eventLog)
        .where(and(
          eq(eventLog.eventType, "redeem_started"),
          gte(eventLog.createdAt, startOfDay),
          lte(eventLog.createdAt, endOfDay)
        )),
      db.select({ count: count() })
        .from(eventLog)
        .where(and(
          eq(eventLog.eventType, "redeem_completed"),
          gte(eventLog.createdAt, startOfDay),
          lte(eventLog.createdAt, endOfDay)
        )),
    ]);

    const dau = Number(dauResult[0]?.count || 0);
    const matchesStarted = Number(matchStartedResult[0]?.count || 0);
    const matchesCompleted = Number(matchCompletedResult[0]?.count || 0);
    const purchasesStarted = Number(purchaseStartedResult[0]?.count || 0);
    const purchasesCompleted = Number(purchaseCompletedResult[0]?.count || 0);
    const liability = Number(liabilityResult[0]?.total || 0);
    const redeemsStarted = Number(redeemStartedResult[0]?.count || 0);
    const redeemsCompleted = Number(redeemCompletedResult[0]?.count || 0);

    return {
      dau,
      matchesPerUser: dau > 0 ? matchesCompleted / dau : 0,
      purchaseConversionRate: purchasesStarted > 0 ? purchasesCompleted / purchasesStarted : 0,
      grossPurchaseCount: purchasesCompleted,
      packptsLiability: liability,
      redemptionRate: redeemsStarted > 0 ? redeemsCompleted / redeemsStarted : 0,
    };
  }
}

export const adminService = new AdminService();
