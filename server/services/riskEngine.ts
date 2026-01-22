import { db } from "../db";
import { 
  gameplayEvents,
  riskSignals,
  riskActions,
  userRiskState,
} from "@shared/schema";
import { eq, and, gte, desc, sql, count } from "drizzle-orm";

type RiskSignal = typeof riskSignals.$inferSelect;
type RiskAction = typeof riskActions.$inferSelect;

export interface RiskAssessment {
  userId: string;
  riskScore: number;
  signals: Array<{ type: string; severity: number; count: number }>;
  recommendations: string[];
  shouldFreeze: boolean;
}

export interface PatternConfig {
  repeatPairingThreshold: number;
  fastResponsesThresholdMs: number;
  winTradingMinWinRate: number;
  highVolumeMatchesPerHour: number;
  lookbackHours: number;
}

const DEFAULT_CONFIG: PatternConfig = {
  repeatPairingThreshold: 5,
  fastResponsesThresholdMs: 500,
  winTradingMinWinRate: 0.95,
  highVolumeMatchesPerHour: 20,
  lookbackHours: 24,
};

class RiskEngineService {
  private config: PatternConfig = DEFAULT_CONFIG;

  setConfig(config: Partial<PatternConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async recordGameplayEvent(event: {
    matchId: string;
    userId: string;
    opponentId?: string;
    eventType: "QUESTION_SHOWN" | "ANSWER_SUBMITTED" | "MATCH_END";
    cardId?: string;
    answerCorrect?: boolean;
    responseTimeMs?: number;
  }): Promise<void> {
    await db.insert(gameplayEvents).values({
      matchId: event.matchId,
      userId: event.userId,
      opponentId: event.opponentId,
      eventType: event.eventType,
      cardId: event.cardId,
      answerCorrect: event.answerCorrect,
      responseTimeMs: event.responseTimeMs,
    });
  }

  async detectPatterns(userId: string): Promise<RiskAssessment> {
    const lookbackDate = new Date(Date.now() - this.config.lookbackHours * 60 * 60 * 1000);
    
    const signals: Array<{ type: string; severity: number; count: number }> = [];
    const recommendations: string[] = [];
    let totalRiskScore = 0;

    const [
      repeatPairingSignal,
      fastResponseSignal,
      highVolumeSignal,
    ] = await Promise.all([
      this.detectRepeatPairing(userId, lookbackDate),
      this.detectFastResponses(userId, lookbackDate),
      this.detectHighVolume(userId, lookbackDate),
    ]);

    if (repeatPairingSignal) {
      signals.push(repeatPairingSignal);
      totalRiskScore += repeatPairingSignal.severity * repeatPairingSignal.count;
      recommendations.push("Investigate potential collusion with repeated opponent");
    }

    if (fastResponseSignal) {
      signals.push(fastResponseSignal);
      totalRiskScore += fastResponseSignal.severity * fastResponseSignal.count;
      recommendations.push("Bot-like behavior detected - extremely fast responses");
    }

    if (highVolumeSignal) {
      signals.push(highVolumeSignal);
      totalRiskScore += highVolumeSignal.severity * highVolumeSignal.count;
      recommendations.push("Unusual match volume - possible automation");
    }

    const existingSignals = await this.getRecentSignals(userId, lookbackDate);
    for (const sig of existingSignals) {
      const existing = signals.find(s => s.type === sig.signalType);
      if (!existing) {
        signals.push({ type: sig.signalType, severity: sig.severity, count: 1 });
        totalRiskScore += sig.severity;
      }
    }

    const shouldFreeze = totalRiskScore >= 15;

    return {
      userId,
      riskScore: totalRiskScore,
      signals,
      recommendations,
      shouldFreeze,
    };
  }

  private async detectRepeatPairing(
    userId: string, 
    lookbackDate: Date
  ): Promise<{ type: string; severity: number; count: number } | null> {
    const matchEnds = await db
      .select({
        opponentId: gameplayEvents.opponentId,
        matchCount: count(),
      })
      .from(gameplayEvents)
      .where(and(
        eq(gameplayEvents.userId, userId),
        eq(gameplayEvents.eventType, "MATCH_END"),
        gte(gameplayEvents.createdAt, lookbackDate)
      ))
      .groupBy(gameplayEvents.opponentId);

    const repeatedOpponents = matchEnds.filter(
      m => m.opponentId && Number(m.matchCount) >= this.config.repeatPairingThreshold
    );

    if (repeatedOpponents.length > 0) {
      const maxCount = Math.max(...repeatedOpponents.map(r => Number(r.matchCount)));
      return { 
        type: "REPEAT_PAIRING", 
        severity: 3, 
        count: maxCount 
      };
    }

    return null;
  }

  private async detectFastResponses(
    userId: string, 
    lookbackDate: Date
  ): Promise<{ type: string; severity: number; count: number } | null> {
    const [result] = await db
      .select({
        fastCount: sql<number>`COUNT(*) FILTER (WHERE ${gameplayEvents.responseTimeMs} < ${this.config.fastResponsesThresholdMs})`,
        totalCount: count(),
      })
      .from(gameplayEvents)
      .where(and(
        eq(gameplayEvents.userId, userId),
        eq(gameplayEvents.eventType, "ANSWER_SUBMITTED"),
        gte(gameplayEvents.createdAt, lookbackDate)
      ));

    const fastCount = Number(result?.fastCount) || 0;
    const totalCount = Number(result?.totalCount) || 0;

    if (totalCount >= 10 && fastCount / totalCount > 0.5) {
      return { 
        type: "FAST_RESPONSES", 
        severity: 4, 
        count: fastCount 
      };
    }

    return null;
  }

  private async detectHighVolume(
    userId: string, 
    lookbackDate: Date
  ): Promise<{ type: string; severity: number; count: number } | null> {
    const [result] = await db
      .select({
        matchCount: sql<number>`COUNT(DISTINCT ${gameplayEvents.matchId})`,
      })
      .from(gameplayEvents)
      .where(and(
        eq(gameplayEvents.userId, userId),
        gte(gameplayEvents.createdAt, lookbackDate)
      ));

    const matchCount = Number(result?.matchCount) || 0;
    const maxAllowed = this.config.highVolumeMatchesPerHour * this.config.lookbackHours;

    if (matchCount > maxAllowed) {
      return { 
        type: "HIGH_VOLUME", 
        severity: 2, 
        count: matchCount 
      };
    }

    return null;
  }

  private async getRecentSignals(userId: string, lookbackDate: Date): Promise<RiskSignal[]> {
    return await db
      .select()
      .from(riskSignals)
      .where(and(
        eq(riskSignals.userId, userId),
        gte(riskSignals.createdAt, lookbackDate)
      ))
      .orderBy(desc(riskSignals.createdAt))
      .limit(100);
  }

  async recordSignal(
    userId: string,
    signalType: "REPEAT_PAIRING" | "WIN_TRADING" | "FAST_RESPONSES" | "HIGH_VOLUME" | "MULTI_ACCOUNT",
    severity: number,
    details?: Record<string, unknown>
  ): Promise<void> {
    await db.insert(riskSignals).values({
      userId,
      signalType,
      severity,
      details,
    });
  }

  async applyAction(
    userId: string,
    action: "THROTTLE" | "REDUCE_REWARDS" | "CAP_LOWER" | "CAPTCHA" | "FREEZE",
    reason: string,
    expiresAt?: Date
  ): Promise<void> {
    await db.insert(riskActions).values({
      userId,
      action,
      reason,
      expiresAt,
    });

    if (action === "FREEZE") {
      await db
        .insert(userRiskState)
        .values({
          userId,
          status: "FROZEN",
          reason,
          frozenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userRiskState.userId,
          set: {
            status: "FROZEN",
            reason,
            frozenAt: new Date(),
            updatedAt: new Date(),
          },
        });
    }
  }

  async unfreezeUser(userId: string, adminNote?: string): Promise<void> {
    await db
      .update(userRiskState)
      .set({
        status: "NORMAL",
        reason: adminNote || "Unfrozen by admin",
        updatedAt: new Date(),
      })
      .where(eq(userRiskState.userId, userId));
  }

  async getActiveActions(userId: string): Promise<RiskAction[]> {
    const now = new Date();
    return await db
      .select()
      .from(riskActions)
      .where(and(
        eq(riskActions.userId, userId),
        sql`(${riskActions.expiresAt} IS NULL OR ${riskActions.expiresAt} > ${now})`
      ))
      .orderBy(desc(riskActions.createdAt));
  }

  async getUserRiskState(userId: string): Promise<{ status: "NORMAL" | "FROZEN"; reason?: string } | null> {
    const [state] = await db
      .select()
      .from(userRiskState)
      .where(eq(userRiskState.userId, userId))
      .limit(1);

    if (!state) return null;
    return { status: state.status, reason: state.reason || undefined };
  }

  async runPeriodicScan(userIds: string[]): Promise<Map<string, RiskAssessment>> {
    const results = new Map<string, RiskAssessment>();
    
    for (const userId of userIds) {
      const assessment = await this.detectPatterns(userId);
      results.set(userId, assessment);
      
      if (assessment.shouldFreeze) {
        await this.applyAction(
          userId,
          "FREEZE",
          `Auto-freeze: Risk score ${assessment.riskScore} exceeded threshold`
        );
      }
    }
    
    return results;
  }
}

export const riskEngine = new RiskEngineService();
