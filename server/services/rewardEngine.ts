import { db } from "../db";
import { 
  rewardPolicy, 
  playerFame, 
  pointsAwards, 
  userPointsCounters, 
  internalPlayerStats,
  ledgerEntries,
  wallets,
  type RewardPolicy,
  type PlayerFame 
} from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export interface VintageMultipliers {
  pre1980: number;
  "1980_1999": number;
  "2000_2019": number;
  "2020_plus": number;
}

export interface RarityMultipliers {
  base: number;
  insert: number;
  parallel: number;
  sp: number;
}

export interface CardContext {
  cardId?: string;
  playerName: string;
  year?: number;
  rarityType?: "base" | "insert" | "parallel" | "sp";
  sport?: string;
}

export interface AwardResult {
  basePts: number;
  finalPts: number;
  fameScore: number;
  vintageMultiplier: number;
  rarityMultiplier: number;
  policyId: string;
  capped: boolean;
  cappedReason?: string;
}

export interface ExplainResult extends AwardResult {
  playerKey: string;
  explanation: string;
}

let cachedPolicy: RewardPolicy | null = null;
let policyCacheTime: number = 0;
const POLICY_CACHE_TTL = 60000;

export async function loadActivePolicy(): Promise<RewardPolicy> {
  const now = Date.now();
  if (cachedPolicy && now - policyCacheTime < POLICY_CACHE_TTL) {
    return cachedPolicy;
  }

  const [policy] = await db
    .select()
    .from(rewardPolicy)
    .where(eq(rewardPolicy.enabled, true))
    .orderBy(desc(rewardPolicy.effectiveFrom))
    .limit(1);

  if (!policy) {
    const defaultPolicy: RewardPolicy = {
      id: "default",
      effectiveFrom: new Date(),
      enabled: true,
      minPts: 100,
      maxPts: 200,
      gamma: 2.0,
      maxAwardCap: 250,
      vintageMultipliers: { pre1980: 1.15, "1980_1999": 1.05, "2000_2019": 1.0, "2020_plus": 0.9 },
      rarityMultipliers: { base: 1.0, insert: 1.1, parallel: 1.2, sp: 1.3 },
      dailyPointsCap: 5000,
      perMatchPointsCap: 1000,
      createdAt: new Date(),
    };
    return defaultPolicy;
  }

  cachedPolicy = policy;
  policyCacheTime = now;
  return policy;
}

export function normalizePlayerKey(name: string, sport: string = "baseball"): string {
  return `${sport}:${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export async function getFameScore(playerKey: string): Promise<number> {
  const [fame] = await db
    .select()
    .from(playerFame)
    .where(eq(playerFame.playerKey, playerKey))
    .limit(1);

  if (fame) {
    return fame.fameScore;
  }

  const parts = playerKey.split(":");
  const sport = parts[0] || "baseball";
  const normalizedName = parts.slice(1).join(":");

  await db.insert(playerFame).values({
    sport,
    playerName: normalizedName,
    playerKey,
    fameScore: 0.5,
    sourceBreakdown: { default: true },
  }).onConflictDoNothing();

  return 0.5;
}

export function getVintageMultiplier(year: number | undefined, policy: RewardPolicy): number {
  if (!year) return 1.0;
  
  const multipliers = policy.vintageMultipliers as VintageMultipliers;
  
  if (year < 1980) return multipliers.pre1980 || 1.15;
  if (year >= 1980 && year < 2000) return multipliers["1980_1999"] || 1.05;
  if (year >= 2000 && year < 2020) return multipliers["2000_2019"] || 1.0;
  return multipliers["2020_plus"] || 0.9;
}

export function getRarityMultiplier(rarityType: string | undefined, policy: RewardPolicy): number {
  if (!rarityType) return 1.0;
  
  const multipliers = policy.rarityMultipliers as RarityMultipliers;
  
  switch (rarityType) {
    case "insert": return multipliers.insert || 1.1;
    case "parallel": return multipliers.parallel || 1.2;
    case "sp": return multipliers.sp || 1.3;
    default: return multipliers.base || 1.0;
  }
}

export function computeBasePts(fameScore: number, policy: RewardPolicy): number {
  const f = Math.max(0, Math.min(1, fameScore));
  const basePts = policy.minPts + (policy.maxPts - policy.minPts) * (1 - Math.pow(f, policy.gamma));
  return Math.round(basePts);
}

export function computeFinalPts(
  basePts: number, 
  vintageMultiplier: number, 
  rarityMultiplier: number, 
  policy: RewardPolicy
): number {
  const finalPts = Math.round(basePts * vintageMultiplier * rarityMultiplier);
  return Math.min(Math.max(finalPts, policy.minPts), policy.maxAwardCap);
}

export async function computeReward(card: CardContext): Promise<AwardResult> {
  const policy = await loadActivePolicy();
  const playerKey = normalizePlayerKey(card.playerName, card.sport || "baseball");
  const fameScore = await getFameScore(playerKey);
  
  const basePts = computeBasePts(fameScore, policy);
  const vintageMultiplier = getVintageMultiplier(card.year, policy);
  const rarityMultiplier = getRarityMultiplier(card.rarityType, policy);
  const finalPts = computeFinalPts(basePts, vintageMultiplier, rarityMultiplier, policy);
  
  return {
    basePts,
    finalPts,
    fameScore,
    vintageMultiplier,
    rarityMultiplier,
    policyId: policy.id,
    capped: false,
  };
}

export async function getTodayPointsAwarded(userId: string): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  
  const [counter] = await db
    .select()
    .from(userPointsCounters)
    .where(and(
      eq(userPointsCounters.userId, userId),
      eq(userPointsCounters.date, today)
    ))
    .limit(1);
  
  return counter?.pointsAwardedToday || 0;
}

export async function updateDailyCounter(userId: string, points: number): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  
  await db
    .insert(userPointsCounters)
    .values({
      userId,
      date: today,
      pointsAwardedToday: points,
    })
    .onConflictDoUpdate({
      target: userPointsCounters.userId,
      set: {
        date: today,
        pointsAwardedToday: sql`CASE WHEN ${userPointsCounters.date} = ${today} 
          THEN ${userPointsCounters.pointsAwardedToday} + ${points}
          ELSE ${points} END`,
        updatedAt: new Date(),
      },
    });
}

export async function awardPoints(
  userId: string,
  card: CardContext,
  matchId?: string,
  questionId?: string,
  matchPointsAwarded: number = 0
): Promise<AwardResult | null> {
  const idempotencyKey = matchId && questionId 
    ? `award:${matchId}:${questionId}:${userId}` 
    : null;

  if (idempotencyKey) {
    const [existing] = await db
      .select()
      .from(pointsAwards)
      .where(eq(pointsAwards.idempotencyKey, idempotencyKey))
      .limit(1);
    
    if (existing) {
      return {
        basePts: existing.basePts,
        finalPts: existing.finalPts,
        fameScore: existing.fameScore || 0.5,
        vintageMultiplier: existing.vintageMultiplier,
        rarityMultiplier: existing.rarityMultiplier,
        policyId: existing.policyId || "",
        capped: false,
        cappedReason: "already_awarded",
      };
    }
  }

  const policy = await loadActivePolicy();
  const playerKey = normalizePlayerKey(card.playerName, card.sport || "baseball");
  
  let reward = await computeReward(card);
  let finalPts = reward.finalPts;
  let capped = false;
  let cappedReason: string | undefined;

  const todayAwarded = await getTodayPointsAwarded(userId);
  const dailyRemaining = policy.dailyPointsCap - todayAwarded;
  if (dailyRemaining <= 0) {
    return {
      ...reward,
      finalPts: 0,
      capped: true,
      cappedReason: "daily_cap_reached",
    };
  }
  if (finalPts > dailyRemaining) {
    finalPts = dailyRemaining;
    capped = true;
    cappedReason = "daily_cap_partial";
  }

  const matchRemaining = policy.perMatchPointsCap - matchPointsAwarded;
  if (matchRemaining <= 0) {
    return {
      ...reward,
      finalPts: 0,
      capped: true,
      cappedReason: "match_cap_reached",
    };
  }
  if (finalPts > matchRemaining) {
    finalPts = matchRemaining;
    capped = true;
    cappedReason = cappedReason ? `${cappedReason},match_cap_partial` : "match_cap_partial";
  }

  await db.insert(pointsAwards).values({
    userId,
    matchId,
    cardId: card.cardId,
    playerKey,
    fameScore: reward.fameScore,
    basePts: reward.basePts,
    vintageMultiplier: reward.vintageMultiplier,
    rarityMultiplier: reward.rarityMultiplier,
    finalPts,
    policyId: policy.id,
    reason: "QUIZ_CORRECT",
    idempotencyKey,
  });

  await updateDailyCounter(userId, finalPts);

  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);

  if (wallet) {
    await db
      .update(wallets)
      .set({ 
        balance: sql`${wallets.balance} + ${finalPts}`,
        updatedAt: new Date(),
      })
      .where(eq(wallets.userId, userId));

    await db.insert(ledgerEntries).values({
      walletId: wallet.id,
      entryType: "EARN",
      amount: finalPts,
      balanceAfter: wallet.balance + finalPts,
      reason: `Quiz reward: ${card.playerName}`,
      metadata: { 
        playerKey, 
        cardId: card.cardId,
        matchId,
        fameScore: reward.fameScore,
      },
    });
  }

  return {
    basePts: reward.basePts,
    finalPts,
    fameScore: reward.fameScore,
    vintageMultiplier: reward.vintageMultiplier,
    rarityMultiplier: reward.rarityMultiplier,
    policyId: policy.id,
    capped,
    cappedReason,
  };
}

export async function explainReward(card: CardContext): Promise<ExplainResult> {
  const policy = await loadActivePolicy();
  const playerKey = normalizePlayerKey(card.playerName, card.sport || "baseball");
  const fameScore = await getFameScore(playerKey);
  
  const basePts = computeBasePts(fameScore, policy);
  const vintageMultiplier = getVintageMultiplier(card.year, policy);
  const rarityMultiplier = getRarityMultiplier(card.rarityType, policy);
  const finalPts = computeFinalPts(basePts, vintageMultiplier, rarityMultiplier, policy);

  let explanation = `Base points: ${basePts} (fame score: ${(fameScore * 100).toFixed(0)}%)`;
  
  if (vintageMultiplier !== 1.0) {
    explanation += ` × ${vintageMultiplier.toFixed(2)} vintage bonus`;
  }
  if (rarityMultiplier !== 1.0) {
    explanation += ` × ${rarityMultiplier.toFixed(2)} rarity bonus`;
  }
  
  explanation += ` = ${finalPts} PackPTS`;

  if (fameScore > 0.7) {
    explanation += ". Well-known player = fewer points.";
  } else if (fameScore < 0.3) {
    explanation += ". Obscure player = more points!";
  }

  return {
    basePts,
    finalPts,
    fameScore,
    vintageMultiplier,
    rarityMultiplier,
    policyId: policy.id,
    capped: false,
    playerKey,
    explanation,
  };
}

export async function updatePlayerStats(playerKey: string, correct: boolean): Promise<void> {
  await db
    .insert(internalPlayerStats)
    .values({
      playerKey,
      attempts: 1,
      correct: correct ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: internalPlayerStats.playerKey,
      set: {
        attempts: sql`${internalPlayerStats.attempts} + 1`,
        correct: sql`${internalPlayerStats.correct} + ${correct ? 1 : 0}`,
        updatedAt: new Date(),
      },
    });
}

export async function recomputeFameFromStats(): Promise<number> {
  const stats = await db
    .select()
    .from(internalPlayerStats)
    .where(sql`${internalPlayerStats.attempts} >= 10`);

  let updated = 0;
  
  for (const stat of stats) {
    const correctRate = stat.correct / stat.attempts;
    const fameScore = Math.min(1, Math.max(0, correctRate * 1.2));
    
    await db
      .update(playerFame)
      .set({
        fameScore,
        sourceBreakdown: { internal: fameScore, correctRate, attempts: stat.attempts },
        lastUpdated: new Date(),
      })
      .where(eq(playerFame.playerKey, stat.playerKey));
    
    updated++;
  }
  
  return updated;
}

export function clearPolicyCache(): void {
  cachedPolicy = null;
  policyCacheTime = 0;
}

/**
 * Seeds the default reward policy if none exists in the database.
 * Also performs a health check on critical tables.
 * Call this at application startup to ensure gameplay works.
 */
export async function seedRewardPolicy(): Promise<void> {
  try {
    // First, check if the table exists by querying it
    const [existing] = await db
      .select()
      .from(rewardPolicy)
      .where(eq(rewardPolicy.enabled, true))
      .limit(1);
    
    if (existing) {
      console.log('[RewardEngine] Active reward policy exists');
    } else {
      await db.insert(rewardPolicy).values({
        effectiveFrom: new Date(),
        enabled: true,
        minPts: 100,
        maxPts: 200,
        gamma: 2.0,
        maxAwardCap: 250,
        vintageMultipliers: { pre1980: 1.15, "1980_1999": 1.05, "2000_2019": 1.0, "2020_plus": 0.9 },
        rarityMultipliers: { base: 1.0, insert: 1.1, parallel: 1.2, sp: 1.3 },
        dailyPointsCap: 5000,
        perMatchPointsCap: 1000,
      });
      console.log('[RewardEngine] Default reward policy seeded successfully');
    }
    
    // Health check: try to query the other critical tables
    try {
      await db.select().from(internalPlayerStats).limit(1);
    } catch (e: any) {
      console.error('[RewardEngine] WARNING: internalPlayerStats table may be missing:', e?.message);
    }
    
    try {
      await db.select().from(playerFame).limit(1);
    } catch (e: any) {
      console.error('[RewardEngine] WARNING: playerFame table may be missing:', e?.message);
    }
    
    try {
      await db.select().from(pointsAwards).limit(1);
    } catch (e: any) {
      console.error('[RewardEngine] WARNING: pointsAwards table may be missing:', e?.message);
    }
    
    console.log('[RewardEngine] Health check complete');
  } catch (error) {
    console.error('[RewardEngine] Failed to seed/check reward policy:', error);
  }
}
