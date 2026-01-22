import { db } from "../../db";
import { eq, desc, and, gte } from "drizzle-orm";
import { fraudSignals, riskSnapshots, riskSuppressions } from "@shared/schema";
import { getRiskSnapshot as getSnapshotData, RiskSnapshotData } from "./snapshot";

export { getRiskSnapshot } from "./snapshot";
export type { RiskSnapshotData } from "./snapshot";

export interface PublicRiskInfo {
  tierSuggestion: "LOW" | "MEDIUM" | "HIGH";
  topReasons: string[];
}

export async function getPublicRiskInfo(userId: string): Promise<PublicRiskInfo | null> {
  const snapshot = await getSnapshotData(userId);
  if (!snapshot) {
    return null;
  }
  return {
    tierSuggestion: snapshot.tierSuggestion,
    topReasons: snapshot.topReasons,
  };
}

export async function getFullRiskSnapshot(userId: string): Promise<(typeof riskSnapshots.$inferSelect) | null> {
  const result = await db
    .select()
    .from(riskSnapshots)
    .where(eq(riskSnapshots.userId, userId))
    .limit(1);
  return result[0] || null;
}

export async function getRecentFraudSignals(
  userId: string,
  limit: number = 100
): Promise<(typeof fraudSignals.$inferSelect)[]> {
  return db
    .select()
    .from(fraudSignals)
    .where(eq(fraudSignals.userId, userId))
    .orderBy(desc(fraudSignals.createdAt))
    .limit(limit);
}

export async function createRiskSuppression(
  userId: string,
  signalType: string,
  expiresAt: Date,
  reason?: string
): Promise<typeof riskSuppressions.$inferSelect> {
  const result = await db
    .insert(riskSuppressions)
    .values({
      userId,
      signalType,
      expiresAt,
      reason: reason || null,
    })
    .onConflictDoUpdate({
      target: [riskSuppressions.userId, riskSuppressions.signalType],
      set: {
        expiresAt,
        reason: reason || null,
      },
    })
    .returning();
  return result[0];
}

export async function getActiveSuppressions(userId: string): Promise<(typeof riskSuppressions.$inferSelect)[]> {
  const now = new Date();
  return db
    .select()
    .from(riskSuppressions)
    .where(
      and(
        eq(riskSuppressions.userId, userId),
        gte(riskSuppressions.expiresAt, now)
      )
    );
}

export async function deleteRiskSuppression(userId: string, signalType: string): Promise<boolean> {
  const result = await db
    .delete(riskSuppressions)
    .where(
      eq(riskSuppressions.userId, userId)
    )
    .returning();
  return result.length > 0;
}
