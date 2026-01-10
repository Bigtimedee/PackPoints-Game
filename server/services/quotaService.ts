import { db } from "../db";
import { dailyQuotas, featureFlags, type DailyQuota, TIER_CONFIG } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { storage } from "../storage";

export type UserTier = "FREE" | "PRO" | "LEGEND";

export interface QuotaCheckResult {
  allowed: boolean;
  tier: UserTier;
  dailyUsed: number;
  dailyLimit: number | null;
  hourlyUsed?: number;
  hourlyLimit?: number;
  reason?: string;
}

export interface QuotaConsumeResult {
  success: boolean;
  quota?: DailyQuota;
  error?: string;
}

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

class QuotaService {
  async getUserTier(userId: string): Promise<UserTier> {
    const hasLegend = await storage.hasEntitlement(userId, "legend_mode_pass");
    if (hasLegend) return "LEGEND";
    
    const hasPro = await storage.hasEntitlement(userId, "pro_subscription");
    if (hasPro) return "PRO";
    
    return "FREE";
  }

  async getOrCreateDailyQuota(userId: string, mode: string): Promise<DailyQuota> {
    const today = getTodayDateString();
    
    const existing = await db
      .select()
      .from(dailyQuotas)
      .where(
        and(
          eq(dailyQuotas.userId, userId),
          eq(dailyQuotas.quotaDate, today),
          eq(dailyQuotas.mode, mode)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }

    const [created] = await db
      .insert(dailyQuotas)
      .values({
        userId,
        quotaDate: today,
        mode,
        matchesStarted: 0,
        matchesCompleted: 0,
      })
      .returning();

    return created;
  }

  async getTotalDailyMatches(userId: string): Promise<number> {
    const today = getTodayDateString();
    
    const result = await db
      .select({ total: sql<number>`COALESCE(SUM(matches_started), 0)` })
      .from(dailyQuotas)
      .where(
        and(
          eq(dailyQuotas.userId, userId),
          eq(dailyQuotas.quotaDate, today)
        )
      );

    return Number(result[0]?.total || 0);
  }

  async checkQuota(userId: string, mode: string): Promise<QuotaCheckResult> {
    const tier = await this.getUserTier(userId);
    const config = TIER_CONFIG[tier];
    
    if (!config.allowedModes.includes(mode)) {
      return {
        allowed: false,
        tier,
        dailyUsed: 0,
        dailyLimit: config.dailyMatchLimit,
        reason: `Mode '${mode}' requires ${mode === "legend" ? "Legend Pass" : "Pro subscription"}`,
      };
    }

    const dailyUsed = await this.getTotalDailyMatches(userId);
    
    if (config.dailyMatchLimit !== null && dailyUsed >= config.dailyMatchLimit) {
      return {
        allowed: false,
        tier,
        dailyUsed,
        dailyLimit: config.dailyMatchLimit,
        reason: `Daily limit of ${config.dailyMatchLimit} matches reached`,
      };
    }

    return {
      allowed: true,
      tier,
      dailyUsed,
      dailyLimit: config.dailyMatchLimit,
    };
  }

  async incrementMatchStarted(userId: string, mode: string): Promise<QuotaConsumeResult> {
    const quota = await this.getOrCreateDailyQuota(userId, mode);
    
    try {
      const [updated] = await db
        .update(dailyQuotas)
        .set({
          matchesStarted: quota.matchesStarted + 1,
          updatedAt: new Date(),
        })
        .where(eq(dailyQuotas.id, quota.id))
        .returning();

      return { success: true, quota: updated };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to increment quota",
      };
    }
  }

  async incrementMatchCompleted(userId: string, mode: string): Promise<QuotaConsumeResult> {
    const quota = await this.getOrCreateDailyQuota(userId, mode);
    
    try {
      const [updated] = await db
        .update(dailyQuotas)
        .set({
          matchesCompleted: quota.matchesCompleted + 1,
          updatedAt: new Date(),
        })
        .where(eq(dailyQuotas.id, quota.id))
        .returning();

      return { success: true, quota: updated };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to increment quota",
      };
    }
  }

  async getFeatureFlag(key: string): Promise<{ enabled: boolean; value?: any }> {
    const result = await db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1);

    if (result.length === 0) {
      return { enabled: false };
    }

    return {
      enabled: result[0].enabled,
      value: result[0].value,
    };
  }

  async setFeatureFlag(key: string, enabled: boolean, value?: any, description?: string): Promise<void> {
    await db
      .insert(featureFlags)
      .values({
        key,
        enabled,
        value,
        description,
      })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: {
          enabled,
          value,
          updatedAt: new Date(),
        },
      });
  }

  async isFeatureEnabled(key: string): Promise<boolean> {
    const flag = await this.getFeatureFlag(key);
    return flag.enabled;
  }

  async getUserQuotaSummary(userId: string): Promise<{
    tier: UserTier;
    dailyUsed: number;
    dailyLimit: number | null;
    quotasByMode: Record<string, { started: number; completed: number }>;
  }> {
    const tier = await this.getUserTier(userId);
    const config = TIER_CONFIG[tier];
    const today = getTodayDateString();
    
    const quotas = await db
      .select()
      .from(dailyQuotas)
      .where(
        and(
          eq(dailyQuotas.userId, userId),
          eq(dailyQuotas.quotaDate, today)
        )
      );

    const quotasByMode: Record<string, { started: number; completed: number }> = {};
    let totalUsed = 0;

    for (const q of quotas) {
      quotasByMode[q.mode] = {
        started: q.matchesStarted,
        completed: q.matchesCompleted,
      };
      totalUsed += q.matchesStarted;
    }

    return {
      tier,
      dailyUsed: totalUsed,
      dailyLimit: config.dailyMatchLimit,
      quotasByMode,
    };
  }
}

export const quotaService = new QuotaService();
