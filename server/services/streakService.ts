import { db } from "../db";
import {
  streakState,
  streakRewardConfig,
  streakClaimLog,
  userRiskState,
  DEFAULT_STREAK_SCHEDULE,
  DEFAULT_MILESTONE_BONUSES,
  MAX_DAILY_STREAK_REWARD,
  type StreakState,
  type StreakRewardConfig,
  type StreakClaimLog,
} from "@shared/schema";
import { eq, and, lte, gte, isNull, or, desc, sql } from "drizzle-orm";
import { walletService } from "./walletService";
import { analyticsService } from "./analyticsService";

async function isUserFrozen(userId: string): Promise<boolean> {
  try {
    const [state] = await db
      .select()
      .from(userRiskState)
      .where(eq(userRiskState.userId, userId))
      .limit(1);
    return state?.status === "FROZEN";
  } catch (e) {
    return false;
  }
}

export interface StreakInfo {
  currentDays: number;
  longestDays: number;
  lastActiveLocalDate: string | null;
  status: string;
  freezesAvailable: number;
  todayClaimed: boolean;
  nextReward: number;
  nextMilestone: { day: number; bonus: number } | null;
  timeUntilReset: number;
  recentDays: { date: string; claimed: boolean }[];
}

export interface StreakClaimResult {
  success: boolean;
  alreadyClaimed?: boolean;
  streakInfo?: StreakInfo;
  dailyReward?: number;
  milestoneBonus?: number;
  totalAwarded?: number;
  error?: string;
}

class StreakService {
  private getUserLocalDate(timezone: string = "America/Chicago"): string {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return formatter.format(now);
    } catch {
      const now = new Date();
      const offset = -6 * 60;
      const local = new Date(now.getTime() + offset * 60000);
      return local.toISOString().split("T")[0];
    }
  }

  private getTimeUntilMidnight(timezone: string = "America/Chicago"): number {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0");
      const minute = parseInt(parts.find(p => p.type === "minute")?.value || "0");
      const second = parseInt(parts.find(p => p.type === "second")?.value || "0");
      
      const secondsUntilMidnight = (24 - hour - 1) * 3600 + (60 - minute - 1) * 60 + (60 - second);
      return secondsUntilMidnight * 1000;
    } catch {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      return midnight.getTime() - now.getTime();
    }
  }

  private isConsecutiveDay(lastDate: string, currentDate: string): boolean {
    const last = new Date(lastDate + "T12:00:00Z");
    const current = new Date(currentDate + "T12:00:00Z");
    const diffMs = current.getTime() - last.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return diffDays === 1;
  }

  private isSameDay(date1: string, date2: string): boolean {
    return date1 === date2;
  }

  private getDaysBetween(date1: string, date2: string): number {
    const d1 = new Date(date1 + "T12:00:00Z");
    const d2 = new Date(date2 + "T12:00:00Z");
    const diffMs = d2.getTime() - d1.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  async getActiveConfig(): Promise<StreakRewardConfig | null> {
    const now = new Date();
    const configs = await db
      .select()
      .from(streakRewardConfig)
      .where(
        and(
          eq(streakRewardConfig.enabled, true),
          lte(streakRewardConfig.effectiveFrom, now),
          or(
            isNull(streakRewardConfig.effectiveUntil),
            gte(streakRewardConfig.effectiveUntil, now)
          )
        )
      )
      .orderBy(desc(streakRewardConfig.effectiveFrom))
      .limit(1);
    
    return configs.length > 0 ? configs[0] : null;
  }

  calculateDailyReward(streakDay: number, config: StreakRewardConfig | null): number {
    const schedule = (config?.jsonSchedule as Record<string, number>) || DEFAULT_STREAK_SCHEDULE;
    const dailyCap = config?.dailyCap || MAX_DAILY_STREAK_REWARD;

    const dayKey = streakDay.toString();
    if (schedule[dayKey]) {
      return Math.min(schedule[dayKey], dailyCap);
    }

    const maxKey = Math.max(...Object.keys(schedule).map(k => parseInt(k)));
    const maxReward = schedule[maxKey.toString()] || dailyCap;
    return Math.min(maxReward, dailyCap);
  }

  calculateMilestoneBonus(streakDay: number, config: StreakRewardConfig | null): number {
    const milestones = (config?.milestoneBonuses as Record<string, number>) || DEFAULT_MILESTONE_BONUSES;
    const dayKey = streakDay.toString();
    return milestones[dayKey] || 0;
  }

  getNextMilestone(currentDay: number, config: StreakRewardConfig | null): { day: number; bonus: number } | null {
    const milestones = (config?.milestoneBonuses as Record<string, number>) || DEFAULT_MILESTONE_BONUSES;
    const milestoneDays = Object.keys(milestones)
      .map(k => parseInt(k))
      .sort((a, b) => a - b);
    
    for (const day of milestoneDays) {
      if (day > currentDay) {
        return { day, bonus: milestones[day.toString()] };
      }
    }
    return null;
  }

  async getOrCreateStreakState(userId: string): Promise<StreakState> {
    const existing = await db
      .select()
      .from(streakState)
      .where(eq(streakState.userId, userId))
      .limit(1);
    
    if (existing.length > 0) {
      return existing[0];
    }

    const [newState] = await db
      .insert(streakState)
      .values({ userId })
      .onConflictDoNothing()
      .returning();
    
    if (newState) {
      return newState;
    }

    const [finalState] = await db
      .select()
      .from(streakState)
      .where(eq(streakState.userId, userId))
      .limit(1);
    return finalState;
  }

  async getStreakInfo(userId: string): Promise<StreakInfo> {
    const state = await this.getOrCreateStreakState(userId);
    const config = await this.getActiveConfig();
    const todayLocal = this.getUserLocalDate(state.timezone);

    const todayClaimed = state.lastClaimLocalDate === todayLocal;

    let effectiveCurrentDays = state.currentDays;
    let effectiveStatus = state.status;

    if (state.lastActiveLocalDate && state.lastActiveLocalDate !== todayLocal) {
      if (!this.isConsecutiveDay(state.lastActiveLocalDate, todayLocal)) {
        if (state.lastActiveLocalDate !== todayLocal) {
          const last = new Date(state.lastActiveLocalDate + "T12:00:00Z");
          const current = new Date(todayLocal + "T12:00:00Z");
          const diffMs = current.getTime() - last.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          
          if (diffDays > 1) {
            effectiveCurrentDays = 0;
            effectiveStatus = "broken";
          }
        }
      }
    }

    const nextDay = effectiveCurrentDays + 1;
    const nextReward = this.calculateDailyReward(nextDay, config);
    const nextMilestone = this.getNextMilestone(effectiveCurrentDays, config);
    const timeUntilReset = this.getTimeUntilMidnight(state.timezone);

    const recentDays = await this.getRecentClaimDays(userId, 7);

    return {
      currentDays: effectiveCurrentDays,
      longestDays: state.longestDays,
      lastActiveLocalDate: state.lastActiveLocalDate,
      status: effectiveStatus,
      freezesAvailable: state.freezesAvailable,
      todayClaimed,
      nextReward,
      nextMilestone,
      timeUntilReset,
      recentDays,
    };
  }

  async getRecentClaimDays(userId: string, days: number): Promise<{ date: string; claimed: boolean }[]> {
    const state = await this.getOrCreateStreakState(userId);
    const today = this.getUserLocalDate(state.timezone);
    const result: { date: string; claimed: boolean }[] = [];

    const claims = await db
      .select()
      .from(streakClaimLog)
      .where(eq(streakClaimLog.userId, userId))
      .orderBy(desc(streakClaimLog.localDate))
      .limit(days);

    const claimedDates = new Set(claims.map(c => c.localDate));

    for (let i = 0; i < days; i++) {
      const date = new Date(today + "T12:00:00Z");
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      result.push({
        date: dateStr,
        claimed: claimedDates.has(dateStr),
      });
    }

    return result.reverse();
  }

  async processMatchCompletion(userId: string, matchId: string): Promise<StreakClaimResult> {
    // GUARDRAIL: Check if user is frozen
    if (await isUserFrozen(userId)) {
      return { success: false, error: "Account frozen - cannot earn streak rewards" };
    }

    const state = await this.getOrCreateStreakState(userId);
    const config = await this.getActiveConfig();
    const todayLocal = this.getUserLocalDate(state.timezone);

    const idempotencyKey = `streak_${userId}_${todayLocal}`;

    // Idempotency is enforced inside the transaction under a FOR UPDATE lock on streakState,
    // preventing the race window that an outer pre-transaction check would introduce.
    return await db.transaction(async (tx) => {
      const [lockedState] = await tx
        .select()
        .from(streakState)
        .where(eq(streakState.userId, userId))
        .for("update");

      if (!lockedState) {
        return { success: false, error: "Streak state not found" };
      }

      const existingInTx = await tx
        .select()
        .from(streakClaimLog)
        .where(eq(streakClaimLog.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existingInTx.length > 0) {
        return {
          success: true,
          alreadyClaimed: true,
          streakInfo: await this.getStreakInfo(userId),
        };
      }

      let newStreakDays: number;
      let streakBroken = false;
      let usedFreeze = false;
      let freezesRemaining = lockedState.freezesAvailable;

      if (!lockedState.lastActiveLocalDate) {
        newStreakDays = 1;
      } else if (this.isSameDay(lockedState.lastActiveLocalDate, todayLocal)) {
        return {
          success: true,
          alreadyClaimed: true,
          streakInfo: await this.getStreakInfo(userId),
        };
      } else if (this.isConsecutiveDay(lockedState.lastActiveLocalDate, todayLocal)) {
        newStreakDays = lockedState.currentDays + 1;
      } else {
        const daysMissed = this.getDaysBetween(lockedState.lastActiveLocalDate, todayLocal) - 1;
        
        if (daysMissed <= lockedState.freezesAvailable && daysMissed > 0) {
          usedFreeze = true;
          freezesRemaining = lockedState.freezesAvailable - daysMissed;
          newStreakDays = lockedState.currentDays + 1;
        } else {
          streakBroken = true;
          newStreakDays = 1;
        }
      }

      const dailyReward = this.calculateDailyReward(newStreakDays, config);
      const milestoneBonus = this.calculateMilestoneBonus(newStreakDays, config);
      const totalAwarded = dailyReward + milestoneBonus;

      const newLongestDays = Math.max(lockedState.longestDays, newStreakDays);

      await tx
        .update(streakState)
        .set({
          currentDays: newStreakDays,
          longestDays: newLongestDays,
          lastActiveLocalDate: todayLocal,
          lastClaimLocalDate: todayLocal,
          freezesAvailable: freezesRemaining,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(streakState.userId, userId));

      await tx.insert(streakClaimLog).values({
        userId,
        localDate: todayLocal,
        streakDay: newStreakDays,
        dailyReward,
        milestoneBonus,
        totalAwarded,
        idempotencyKey,
        matchId,
        metadata: { 
          streakBroken, 
          previousDays: lockedState.currentDays,
          usedFreeze,
          freezesUsed: usedFreeze ? lockedState.freezesAvailable - freezesRemaining : 0,
        },
      });

      const walletIdempotencyKey = `streak_earn_${userId}_${todayLocal}`;
      const { applyLedgerEntry } = await import("./packpts/ledgerService");
      const earnResult = await applyLedgerEntry({
        userId,
        direction: "credit",
        amountPackpts: totalAwarded,
        source: "streak",
        eventType: "streak_daily_reward",
        refType: "match",
        refId: matchId,
        idempotencyKey: walletIdempotencyKey,
        metadata: {
          streakDay: newStreakDays,
          dailyReward,
          milestoneBonus,
          matchId,
        },
      });

      if (!earnResult.success) {
        console.error(`[Streak] Wallet earn failed for ${userId}: ${earnResult.error}`);
        throw new Error(`Streak reward wallet credit failed: ${earnResult.error}`);
      }

      if (streakBroken) {
        analyticsService.track(
          "streak_broken",
          userId,
          { previousDays: lockedState.currentDays }
        );
      }

      if (usedFreeze) {
        analyticsService.track(
          "streak_freeze_used",
          userId,
          { 
            freezesUsed: lockedState.freezesAvailable - freezesRemaining,
            freezesRemaining,
          }
        );
      }

      analyticsService.track(
        "streak_reward_awarded",
        userId,
        {
          streakDay: newStreakDays,
          dailyReward,
          milestoneBonus,
          totalAwarded,
          usedFreeze,
        }
      );

      return {
        success: true,
        alreadyClaimed: false,
        dailyReward,
        milestoneBonus,
        totalAwarded,
        streakInfo: {
          currentDays: newStreakDays,
          longestDays: newLongestDays,
          lastActiveLocalDate: todayLocal,
          status: "active",
          freezesAvailable: freezesRemaining,
          todayClaimed: true,
          nextReward: this.calculateDailyReward(newStreakDays + 1, config),
          nextMilestone: this.getNextMilestone(newStreakDays, config),
          timeUntilReset: this.getTimeUntilMidnight(lockedState.timezone),
          recentDays: [],
        },
      };
    });
  }

  async grantStreakFreeze(userId: string, count: number = 1): Promise<StreakState> {
    const [updated] = await db
      .update(streakState)
      .set({
        freezesAvailable: sql`${streakState.freezesAvailable} + ${count}`,
        updatedAt: new Date(),
      })
      .where(eq(streakState.userId, userId))
      .returning();
    
    return updated;
  }

  async adjustStreak(userId: string, newCurrentDays: number, adminUserId: string): Promise<StreakState> {
    const [updated] = await db
      .update(streakState)
      .set({
        currentDays: newCurrentDays,
        longestDays: sql`GREATEST(${streakState.longestDays}, ${newCurrentDays})`,
        updatedAt: new Date(),
      })
      .where(eq(streakState.userId, userId))
      .returning();

    analyticsService.track(
      "streak_incremented",
      userId,
      {
        source: "admin_adjust",
        newCurrentDays,
        adminUserId,
      }
    );

    return updated;
  }

  async getStreakStats(): Promise<{
    totalUsersWithStreak: number;
    averageCurrentStreak: number;
    usersWithActiveStreak: number;
    streakDistribution: Record<string, number>;
  }> {
    const stats = await db
      .select({
        totalUsers: sql<number>`COUNT(*)`,
        activeStreakUsers: sql<number>`COUNT(*) FILTER (WHERE current_days > 0)`,
        averageStreak: sql<number>`COALESCE(AVG(current_days) FILTER (WHERE current_days > 0), 0)`,
      })
      .from(streakState);

    const distribution = await db
      .select({
        bucket: sql<string>`CASE 
          WHEN current_days = 0 THEN '0'
          WHEN current_days BETWEEN 1 AND 7 THEN '1-7'
          WHEN current_days BETWEEN 8 AND 14 THEN '8-14'
          WHEN current_days BETWEEN 15 AND 30 THEN '15-30'
          ELSE '30+'
        END`,
        count: sql<number>`COUNT(*)`,
      })
      .from(streakState)
      .groupBy(sql`CASE 
        WHEN current_days = 0 THEN '0'
        WHEN current_days BETWEEN 1 AND 7 THEN '1-7'
        WHEN current_days BETWEEN 8 AND 14 THEN '8-14'
        WHEN current_days BETWEEN 15 AND 30 THEN '15-30'
        ELSE '30+'
      END`);

    const streakDistribution: Record<string, number> = {};
    for (const row of distribution) {
      streakDistribution[row.bucket] = Number(row.count);
    }

    return {
      totalUsersWithStreak: Number(stats[0]?.totalUsers) || 0,
      averageCurrentStreak: Number(stats[0]?.averageStreak) || 0,
      usersWithActiveStreak: Number(stats[0]?.activeStreakUsers) || 0,
      streakDistribution,
    };
  }

  async getAllConfigs(): Promise<StreakRewardConfig[]> {
    return await db
      .select()
      .from(streakRewardConfig)
      .orderBy(desc(streakRewardConfig.effectiveFrom));
  }

  async createConfig(
    jsonSchedule: Record<string, number>,
    milestoneBonuses: Record<string, number>,
    dailyCap: number = MAX_DAILY_STREAK_REWARD,
    effectiveFrom?: Date,
    effectiveUntil?: Date | null
  ): Promise<StreakRewardConfig> {
    const [config] = await db
      .insert(streakRewardConfig)
      .values({
        jsonSchedule,
        milestoneBonuses,
        dailyCap,
        effectiveFrom: effectiveFrom || new Date(),
        effectiveUntil,
        enabled: true,
      })
      .returning();
    
    return config;
  }

  async updateConfig(
    configId: string,
    updates: Partial<{
      jsonSchedule: Record<string, number>;
      milestoneBonuses: Record<string, number>;
      dailyCap: number;
      enabled: boolean;
      effectiveUntil: Date | null;
    }>
  ): Promise<StreakRewardConfig> {
    const [updated] = await db
      .update(streakRewardConfig)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(streakRewardConfig.id, configId))
      .returning();
    
    return updated;
  }

  async deleteConfig(configId: string): Promise<void> {
    await db.delete(streakRewardConfig).where(eq(streakRewardConfig.id, configId));
  }

  async getAdminStats(): Promise<{
    totalActiveStreaks: number;
    averageStreakLength: number;
    longestCurrentStreak: number;
    totalClaimsToday: number;
    totalPointsAwardedToday: number;
    freezesAvailableTotal: number;
  }> {
    const today = this.getUserLocalDate();
    
    const streakStats = await db
      .select({
        activeStreaks: sql<number>`COUNT(*) FILTER (WHERE current_days > 0)`,
        avgLength: sql<number>`COALESCE(AVG(current_days) FILTER (WHERE current_days > 0), 0)`,
        longestCurrent: sql<number>`COALESCE(MAX(current_days), 0)`,
        totalFreezes: sql<number>`COALESCE(SUM(freezes_available), 0)`,
      })
      .from(streakState);

    const claimStats = await db
      .select({
        claimsToday: sql<number>`COUNT(*)`,
        pointsToday: sql<number>`COALESCE(SUM(points_awarded), 0)`,
      })
      .from(streakClaimLog)
      .where(eq(streakClaimLog.localDate, today));

    return {
      totalActiveStreaks: Number(streakStats[0]?.activeStreaks) || 0,
      averageStreakLength: Math.round((Number(streakStats[0]?.avgLength) || 0) * 10) / 10,
      longestCurrentStreak: Number(streakStats[0]?.longestCurrent) || 0,
      totalClaimsToday: Number(claimStats[0]?.claimsToday) || 0,
      totalPointsAwardedToday: Number(claimStats[0]?.pointsToday) || 0,
      freezesAvailableTotal: Number(streakStats[0]?.totalFreezes) || 0,
    };
  }

  async getTopStreaks(limit: number = 10): Promise<{
    userId: string;
    username: string;
    currentDays: number;
    longestDays: number;
  }[]> {
    const results = await db.execute(sql`
      SELECT 
        ss.user_id,
        COALESCE(u.username, u.first_name, u.email, 'Unknown') as username,
        ss.current_days,
        ss.longest_days
      FROM streak_state ss
      LEFT JOIN users u ON ss.user_id = u.id
      WHERE ss.current_days > 0
      ORDER BY ss.current_days DESC, ss.longest_days DESC
      LIMIT ${limit}
    `);

    return results.rows.map((row: any) => ({
      userId: row.user_id,
      username: row.username || "Unknown",
      currentDays: Number(row.current_days),
      longestDays: Number(row.longest_days),
    }));
  }

  async getRewardConfigs(): Promise<{
    id: number;
    dayNumber: number;
    baseReward: number;
    milestoneBonus: number;
    createdAt: Date;
    updatedAt: Date;
  }[]> {
    const config = await this.getActiveConfig();
    if (!config) {
      return Object.entries(DEFAULT_STREAK_SCHEDULE).map(([day, reward], index) => ({
        id: index + 1,
        dayNumber: parseInt(day),
        baseReward: reward,
        milestoneBonus: DEFAULT_MILESTONE_BONUSES[day] || 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    }

    const schedule = config.jsonSchedule as Record<string, number>;
    const milestones = config.milestoneBonuses as Record<string, number>;
    
    const allDays = new Set([...Object.keys(schedule), ...Object.keys(milestones)]);
    
    return Array.from(allDays).map((day, index) => ({
      id: index + 1,
      dayNumber: parseInt(day),
      baseReward: schedule[day] || 0,
      milestoneBonus: milestones[day] || 0,
      createdAt: config.createdAt ?? new Date(),
      updatedAt: config.updatedAt ?? new Date(),
    })).sort((a, b) => a.dayNumber - b.dayNumber);
  }

  async addRewardConfig(dayNumber: number, baseReward: number, milestoneBonus: number): Promise<{
    id: number;
    dayNumber: number;
    baseReward: number;
    milestoneBonus: number;
  }> {
    let config = await this.getActiveConfig();
    
    if (!config) {
      config = await this.createConfig(
        { [dayNumber.toString()]: baseReward },
        milestoneBonus > 0 ? { [dayNumber.toString()]: milestoneBonus } : {},
      );
    } else {
      const schedule = { ...(config.jsonSchedule as Record<string, number>), [dayNumber.toString()]: baseReward };
      const milestones = { ...(config.milestoneBonuses as Record<string, number>) };
      if (milestoneBonus > 0) {
        milestones[dayNumber.toString()] = milestoneBonus;
      } else {
        delete milestones[dayNumber.toString()];
      }
      
      await this.updateConfig(config.id, { jsonSchedule: schedule, milestoneBonuses: milestones });
    }
    
    return { id: dayNumber, dayNumber, baseReward, milestoneBonus };
  }

  async updateRewardConfig(
    dayId: number,
    updates: { baseReward?: number; milestoneBonus?: number }
  ): Promise<{ id: number; dayNumber: number; baseReward: number; milestoneBonus: number } | null> {
    const config = await this.getActiveConfig();
    if (!config) return null;

    const schedule = { ...(config.jsonSchedule as Record<string, number>) };
    const milestones = { ...(config.milestoneBonuses as Record<string, number>) };
    const dayKey = dayId.toString();

    if (updates.baseReward !== undefined) {
      schedule[dayKey] = updates.baseReward;
    }
    if (updates.milestoneBonus !== undefined) {
      if (updates.milestoneBonus > 0) {
        milestones[dayKey] = updates.milestoneBonus;
      } else {
        delete milestones[dayKey];
      }
    }

    await this.updateConfig(config.id, { jsonSchedule: schedule, milestoneBonuses: milestones });
    
    return {
      id: dayId,
      dayNumber: dayId,
      baseReward: schedule[dayKey] || 0,
      milestoneBonus: milestones[dayKey] || 0,
    };
  }

  async deleteRewardConfig(dayId: number): Promise<boolean> {
    const config = await this.getActiveConfig();
    if (!config) return false;

    const schedule = { ...(config.jsonSchedule as Record<string, number>) };
    const milestones = { ...(config.milestoneBonuses as Record<string, number>) };
    const dayKey = dayId.toString();

    if (!(dayKey in schedule) && !(dayKey in milestones)) {
      return false;
    }

    delete schedule[dayKey];
    delete milestones[dayKey];

    await this.updateConfig(config.id, { jsonSchedule: schedule, milestoneBonuses: milestones });
    return true;
  }
}

export const streakService = new StreakService();
