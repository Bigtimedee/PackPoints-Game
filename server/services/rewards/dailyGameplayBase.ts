import { db } from "../../db";
import { 
  userGameplayDailyCounters, 
  gameplayCardDailyEvents,
  ledgerEntries,
  wallets,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { DAILY_GAMEPLAY_BASE } from "../../config/rewards";

export interface DailyBaseAwardResult {
  deltaPts: number;
  newTotalPts: number;
  cardsCompleted: number;
  isDuplicate: boolean;
  isDailyCapped: boolean;
}

export interface DailyProgressResult {
  dayKey: string;
  cardsCompleted: number;
  cardsMax: number;
  basePtsAwarded: number;
  basePtsMax: number;
  remainingCards: number;
  remainingPts: number;
  progressPct: number;
}

export async function awardDailyBaseForCorrectCard(params: {
  userId: string;
  matchId?: string;
  cardId: string;
  now?: Date;
}): Promise<DailyBaseAwardResult> {
  const { userId, matchId, cardId } = params;
  const dayKey = DAILY_GAMEPLAY_BASE.dayKeyUTC(params.now ?? new Date());
  
  return await db.transaction(async (tx) => {
    const existingEvent = await tx
      .select()
      .from(gameplayCardDailyEvents)
      .where(and(
        eq(gameplayCardDailyEvents.userId, userId),
        eq(gameplayCardDailyEvents.dayKey, dayKey),
        eq(gameplayCardDailyEvents.cardId, cardId)
      ))
      .limit(1);
    
    if (existingEvent.length > 0 && existingEvent[0].isCorrect) {
      const [counter] = await tx
        .select()
        .from(userGameplayDailyCounters)
        .where(and(
          eq(userGameplayDailyCounters.userId, userId),
          eq(userGameplayDailyCounters.dayKey, dayKey)
        ))
        .limit(1);
      
      return {
        deltaPts: 0,
        newTotalPts: counter?.basePtsAwarded ?? 0,
        cardsCompleted: counter?.cardsCompleted ?? 0,
        isDuplicate: true,
        isDailyCapped: false,
      };
    }
    
    await tx.insert(gameplayCardDailyEvents).values({
      userId,
      dayKey,
      matchId: matchId ?? null,
      cardId,
      isCorrect: true,
    }).onConflictDoUpdate({
      target: [gameplayCardDailyEvents.userId, gameplayCardDailyEvents.dayKey, gameplayCardDailyEvents.cardId],
      set: {
        isCorrect: true,
        matchId: matchId ?? sql`${gameplayCardDailyEvents.matchId}`,
      }
    });
    
    let [counter] = await tx
      .select()
      .from(userGameplayDailyCounters)
      .where(and(
        eq(userGameplayDailyCounters.userId, userId),
        eq(userGameplayDailyCounters.dayKey, dayKey)
      ))
      .for("update")
      .limit(1);
    
    if (!counter) {
      await tx.insert(userGameplayDailyCounters).values({
        userId,
        dayKey,
        cardsCompleted: 0,
        basePtsAwarded: 0,
      });
      
      [counter] = await tx
        .select()
        .from(userGameplayDailyCounters)
        .where(and(
          eq(userGameplayDailyCounters.userId, userId),
          eq(userGameplayDailyCounters.dayKey, dayKey)
        ))
        .for("update")
        .limit(1);
    }
    
    const oldC = counter?.cardsCompleted ?? 0;
    const newC = Math.min(oldC + 1, DAILY_GAMEPLAY_BASE.CARDS_MAX_PER_DAY);
    const oldP = counter?.basePtsAwarded ?? 0;
    const targetP = DAILY_GAMEPLAY_BASE.pointsForCardsCompleted(newC);
    const delta = Math.max(0, targetP - oldP);
    
    const isDailyCapped = oldC >= DAILY_GAMEPLAY_BASE.CARDS_MAX_PER_DAY;
    
    await tx
      .update(userGameplayDailyCounters)
      .set({
        cardsCompleted: newC,
        basePtsAwarded: oldP + delta,
        updatedAt: new Date(),
      })
      .where(and(
        eq(userGameplayDailyCounters.userId, userId),
        eq(userGameplayDailyCounters.dayKey, dayKey)
      ));
    
    if (delta > 0) {
      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .limit(1);
      
      if (wallet) {
        const newBalance = wallet.balance + delta;
        
        await tx
          .update(wallets)
          .set({
            balance: newBalance,
            lifetimeEarned: wallet.lifetimeEarned + delta,
            updatedAt: new Date(),
          })
          .where(eq(wallets.userId, userId));
        
        await tx.insert(ledgerEntries).values({
          walletId: wallet.id,
          entryType: "EARN",
          amount: delta,
          balanceAfter: newBalance,
          reason: "Daily card completion reward",
          metadata: {
            source: "EARN_GAMEPLAY_BASE_DAILY",
            dayKey,
            cardId,
            matchId: matchId ?? null,
            cardsCompleted: newC,
          },
          idempotencyKey: `daily_base:${userId}:${dayKey}:${cardId}`,
        });
      }
    }
    
    return {
      deltaPts: delta,
      newTotalPts: oldP + delta,
      cardsCompleted: newC,
      isDuplicate: false,
      isDailyCapped,
    };
  });
}

export async function getDailyProgress(userId: string, now?: Date): Promise<DailyProgressResult> {
  const dayKey = DAILY_GAMEPLAY_BASE.dayKeyUTC(now ?? new Date());
  
  const [counter] = await db
    .select()
    .from(userGameplayDailyCounters)
    .where(and(
      eq(userGameplayDailyCounters.userId, userId),
      eq(userGameplayDailyCounters.dayKey, dayKey)
    ))
    .limit(1);
  
  const cardsCompleted = counter?.cardsCompleted ?? 0;
  const basePtsAwarded = counter?.basePtsAwarded ?? 0;
  const cardsMax = DAILY_GAMEPLAY_BASE.CARDS_MAX_PER_DAY;
  const basePtsMax = DAILY_GAMEPLAY_BASE.PTS_MAX_PER_DAY;
  
  return {
    dayKey,
    cardsCompleted,
    cardsMax,
    basePtsAwarded,
    basePtsMax,
    remainingCards: Math.max(0, cardsMax - cardsCompleted),
    remainingPts: Math.max(0, basePtsMax - basePtsAwarded),
    progressPct: Math.round((cardsCompleted / cardsMax) * 100),
  };
}
