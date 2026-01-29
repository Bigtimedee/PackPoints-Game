import { db } from "../../db";
import { telemetryCardDelivery } from "@shared/schema";

export type CardDeliveryStage = 
  | "prefetch" 
  | "validate" 
  | "validate_fail"
  | "serve" 
  | "image_fail" 
  | "replace_card"
  | "prefetch_fail"
  | "build_queue";

interface TelemetryDetail {
  reason?: string;
  cardCount?: number;
  validCount?: number;
  invalidCount?: number;
  duration_ms?: number;
  questionIdx?: number;
  replacementCardId?: string;
  error?: string;
  [key: string]: unknown;
}

export async function logCardDelivery(
  stage: CardDeliveryStage,
  options: {
    matchId?: string;
    setKey?: string;
    cardId?: string;
    detail?: TelemetryDetail;
  } = {}
): Promise<void> {
  try {
    await db.insert(telemetryCardDelivery).values({
      matchId: options.matchId || null,
      setKey: options.setKey || null,
      stage,
      cardId: options.cardId || null,
      detail: options.detail || null,
    });
  } catch (error) {
    console.error("[Telemetry] Failed to log card delivery:", error);
  }
}

export async function getCardDeliveryStats(hours: number = 24): Promise<{
  totalEvents: number;
  byStage: Record<string, number>;
  imageOkRateBySet: Array<{ setKey: string; total: number; valid: number; rate: number }>;
  replacementStats: { matchesWithReplacements: number; totalReplacements: number };
}> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const events = await db
    .select()
    .from(telemetryCardDelivery)
    .where(sql`${telemetryCardDelivery.ts} > ${cutoff}`);
  
  const byStage: Record<string, number> = {};
  const setValidation: Record<string, { valid: number; total: number }> = {};
  const matchReplacements = new Set<string>();
  let totalReplacements = 0;
  
  for (const event of events) {
    byStage[event.stage] = (byStage[event.stage] || 0) + 1;
    
    if (event.stage === "validate" && event.setKey) {
      if (!setValidation[event.setKey]) {
        setValidation[event.setKey] = { valid: 0, total: 0 };
      }
      setValidation[event.setKey].total++;
      const detail = event.detail as TelemetryDetail | null;
      if (detail?.validCount) {
        setValidation[event.setKey].valid += detail.validCount;
      }
    }
    
    if (event.stage === "replace_card") {
      totalReplacements++;
      if (event.matchId) {
        matchReplacements.add(event.matchId);
      }
    }
  }
  
  const imageOkRateBySet = Object.entries(setValidation).map(([setKey, stats]) => ({
    setKey,
    total: stats.total,
    valid: stats.valid,
    rate: stats.total > 0 ? stats.valid / stats.total : 0,
  }));
  
  return {
    totalEvents: events.length,
    byStage,
    imageOkRateBySet,
    replacementStats: {
      matchesWithReplacements: matchReplacements.size,
      totalReplacements,
    },
  };
}

import { sql } from "drizzle-orm";
