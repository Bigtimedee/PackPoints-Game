import { db } from "../../db";
import { eq, desc, and, gte } from "drizzle-orm";
import {
  authEvents,
  paymentEvents,
  redemptionEvents,
  riskSnapshots,
} from "@shared/schema";
import { computeSignalsForUser24h, writeSignals, getSignalWeight, getSignalHumanReason, ComputedSignal } from "./signals";
import { computeUserRollup24h, getTodayWindowStart } from "./rollups24h";

export interface RiskSnapshotData {
  tierSuggestion: "LOW" | "MEDIUM" | "HIGH";
  score: number;
  flags: Record<string, boolean>;
  topReasons: string[];
  lastPurchaseAt: Date | null;
  lastRedemptionApplyAt: Date | null;
  lastDeviceId: string | null;
  lastIpHash: string | null;
  lastCountry: string | null;
}

async function getLastPurchaseAt(userId: string): Promise<Date | null> {
  const result = await db
    .select({ createdAt: paymentEvents.createdAt })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.userId, userId),
        eq(paymentEvents.eventType, "PAID")
      )
    )
    .orderBy(desc(paymentEvents.createdAt))
    .limit(1);
  return result[0]?.createdAt || null;
}

async function getLastRedemptionApplyAt(userId: string): Promise<Date | null> {
  const result = await db
    .select({ createdAt: redemptionEvents.createdAt })
    .from(redemptionEvents)
    .where(
      and(
        eq(redemptionEvents.userId, userId),
        eq(redemptionEvents.eventType, "APPLY")
      )
    )
    .orderBy(desc(redemptionEvents.createdAt))
    .limit(1);
  return result[0]?.createdAt || null;
}

async function getLatestContext(userId: string): Promise<{
  deviceId: string | null;
  ipHash: string | null;
  ipCountry: string | null;
}> {
  const result = await db
    .select({
      deviceId: authEvents.deviceId,
      ipHash: authEvents.ipHash,
      ipCountry: authEvents.ipCountry,
    })
    .from(authEvents)
    .where(eq(authEvents.userId, userId))
    .orderBy(desc(authEvents.createdAt))
    .limit(1);
  
  return {
    deviceId: result[0]?.deviceId || null,
    ipHash: result[0]?.ipHash || null,
    ipCountry: result[0]?.ipCountry || null,
  };
}

function computeRiskScore(signals: ComputedSignal[]): number {
  let score = 0;
  for (const signal of signals) {
    score += getSignalWeight(signal.signalType);
  }
  return score;
}

function determineTier(score: number, signals: ComputedSignal[]): "LOW" | "MEDIUM" | "HIGH" {
  const hasDispute = signals.some(s => s.signalType === "DISPUTE_PRESENT");
  const hasMultiAccount = signals.some(s => s.signalType === "DEVICE_MULTI_ACCOUNT");

  if (score >= 60 || hasDispute || hasMultiAccount) {
    return "HIGH";
  }
  if (score >= 25) {
    return "MEDIUM";
  }
  return "LOW";
}

function buildFlags(signals: ComputedSignal[]): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const signal of signals) {
    flags[signal.signalType] = true;
  }
  return flags;
}

function buildTopReasons(signals: ComputedSignal[], maxReasons: number = 3): string[] {
  const sorted = [...signals].sort((a, b) => {
    return getSignalWeight(b.signalType) - getSignalWeight(a.signalType);
  });
  return sorted.slice(0, maxReasons).map(s => getSignalHumanReason(s.signalType));
}

export async function updateRiskSnapshot(userId: string): Promise<RiskSnapshotData> {
  const windowStart = getTodayWindowStart();
  await computeUserRollup24h(userId, windowStart);

  const signals = await computeSignalsForUser24h(userId);
  await writeSignals(userId, signals);

  const score = computeRiskScore(signals);
  const tierSuggestion = determineTier(score, signals);
  const flags = buildFlags(signals);
  const topReasons = buildTopReasons(signals);

  const lastPurchaseAt = await getLastPurchaseAt(userId);
  const lastRedemptionApplyAt = await getLastRedemptionApplyAt(userId);
  const context = await getLatestContext(userId);

  await db
    .insert(riskSnapshots)
    .values({
      userId,
      updatedAt: new Date(),
      tierSuggestion,
      score,
      flags,
      topReasons,
      lastPurchaseAt,
      lastRedemptionApplyAt,
      lastDeviceId: context.deviceId,
      lastIpHash: context.ipHash,
      lastCountry: context.ipCountry,
    })
    .onConflictDoUpdate({
      target: riskSnapshots.userId,
      set: {
        updatedAt: new Date(),
        tierSuggestion,
        score,
        flags,
        topReasons,
        lastPurchaseAt,
        lastRedemptionApplyAt,
        lastDeviceId: context.deviceId,
        lastIpHash: context.ipHash,
        lastCountry: context.ipCountry,
      },
    });

  return {
    tierSuggestion,
    score,
    flags,
    topReasons,
    lastPurchaseAt,
    lastRedemptionApplyAt,
    lastDeviceId: context.deviceId,
    lastIpHash: context.ipHash,
    lastCountry: context.ipCountry,
  };
}

export async function getRiskSnapshot(userId: string): Promise<RiskSnapshotData | null> {
  const result = await db
    .select()
    .from(riskSnapshots)
    .where(eq(riskSnapshots.userId, userId))
    .limit(1);

  if (!result[0]) {
    return null;
  }

  const row = result[0];
  return {
    tierSuggestion: row.tierSuggestion || "LOW",
    score: row.score || 0,
    flags: (row.flags as Record<string, boolean>) || {},
    topReasons: row.topReasons || [],
    lastPurchaseAt: row.lastPurchaseAt,
    lastRedemptionApplyAt: row.lastRedemptionApplyAt,
    lastDeviceId: row.lastDeviceId,
    lastIpHash: row.lastIpHash,
    lastCountry: row.lastCountry,
  };
}
