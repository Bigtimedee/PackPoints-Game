import { db } from "../../db";
import { 
  userGameplayDailyCounters, 
  gameplayCardDailyEvents,
  ledgerEntries,
  wallets,
  pointsAwards,
  userDailyProgress,
} from "@shared/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import { DAILY_GAMEPLAY_BASE } from "../../config/rewards";
import { isUserFrozen, computeReward, type CardContext } from "../rewardEngine";
import { bucketService } from "../bucketService";
import { getChicagoDate } from "../progress/dailyProgress";

export interface DailyBaseAwardResult {
  deltaPts: number;
  newTotalPts: number;
  cardsCompleted: number;
  isDuplicate: boolean;
  isDailyCapped: boolean;
  frozen?: boolean;
  frozenReason?: string;
  fameScore?: number;
  vintageMultiplier?: number;
  rarityMultiplier?: number;
  basePts?: number;
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
  playerName?: string;
  year?: number;
  rarityType?: "base" | "insert" | "parallel" | "sp";
}): Promise<DailyBaseAwardResult> {
  const { userId, matchId, cardId } = params;
  const dayKey = DAILY_GAMEPLAY_BASE.dayKeyUTC(params.now ?? new Date());

  const frozenCheck = await isUserFrozen(userId);
  if (frozenCheck.frozen) {
    return {
      deltaPts: 0,
      newTotalPts: 0,
      cardsCompleted: 0,
      isDuplicate: false,
      isDailyCapped: false,
      frozen: true,
      frozenReason: frozenCheck.reason,
    };
  }
  
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
    
    const isDailyCapped = oldC >= DAILY_GAMEPLAY_BASE.CARDS_MAX_PER_DAY;

    let delta: number;
    let rewardFameScore = 0.5;
    let rewardVintageMultiplier = 1.0;
    let rewardRarityMultiplier = 1.0;
    let rewardBasePts = 75;

    if (params.playerName) {
      const cardContext: CardContext = {
        cardId: cardId,
        playerName: params.playerName,
        year: params.year,
        rarityType: params.rarityType,
        sport: "baseball",
      };
      const reward = await computeReward(cardContext);
      rewardFameScore = reward.fameScore;
      rewardVintageMultiplier = reward.vintageMultiplier;
      rewardRarityMultiplier = reward.rarityMultiplier;
      rewardBasePts = reward.basePts;
      delta = isDailyCapped ? 0 : Math.min(reward.finalPts, DAILY_GAMEPLAY_BASE.PTS_MAX_PER_DAY - oldP);
      delta = Math.max(0, delta);
    } else {
      const targetP = DAILY_GAMEPLAY_BASE.pointsForCardsCompleted(newC);
      delta = Math.max(0, targetP - oldP);
    }
    
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

    const chicagoDayDate = getChicagoDate();
    await tx
      .insert(userDailyProgress)
      .values({
        userId,
        dayDate: chicagoDayDate,
        cardsAnswered: 1,
        matchesCompleted: 0,
      })
      .onConflictDoUpdate({
        target: [userDailyProgress.userId, userDailyProgress.dayDate],
        set: {
          cardsAnswered: sql`${userDailyProgress.cardsAnswered} + 1`,
          updatedAt: sql`now()`,
        },
      });
    
    if (delta > 0) {
      let [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update")
        .limit(1);
      
      if (!wallet) {
        const [newWallet] = await tx.insert(wallets).values({
          userId,
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
          status: "active",
        }).returning();
        wallet = newWallet;
      }

      if (wallet.status !== "active") {
        return {
          deltaPts: 0,
          newTotalPts: oldP,
          cardsCompleted: newC,
          isDuplicate: false,
          isDailyCapped,
        };
      }

      const idempotencyKey = `daily_base:${userId}:${dayKey}:${cardId}`;
      const newBalance = wallet.balance + delta;
      
      const insertedEntries = await tx.insert(ledgerEntries).values({
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
        idempotencyKey,
      }).onConflictDoNothing({ target: ledgerEntries.idempotencyKey }).returning();

      if (insertedEntries.length === 0) {
        return {
          deltaPts: 0,
          newTotalPts: oldP,
          cardsCompleted: newC,
          isDuplicate: true,
          isDailyCapped,
        };
      }

      await tx
        .update(wallets)
        .set({
          balance: newBalance,
          lifetimeEarned: wallet.lifetimeEarned + delta,
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, wallet.id));
      
      await bucketService.createBucket(
        userId,
        delta,
        "EARNED",
        insertedEntries[0].id,
        {
          source: "EARN_GAMEPLAY_BASE_DAILY",
          dayKey,
          cardId,
          matchId: matchId ?? null,
        },
        undefined,
        tx
      );
    }
    
    return {
      deltaPts: delta,
      newTotalPts: oldP + delta,
      cardsCompleted: newC,
      isDuplicate: false,
      isDailyCapped,
      fameScore: rewardFameScore,
      vintageMultiplier: rewardVintageMultiplier,
      rarityMultiplier: rewardRarityMultiplier,
      basePts: rewardBasePts,
    };
  });
}

export interface WalletBackfillResult {
  usersProcessed: number;
  totalPointsCredited: number;
  ledgerEntriesCreated: number;
  bucketsCreated: number;
  errors: Array<{ userId: string; dayKey: string; error: string }>;
  details: Array<{ userId: string; dayKey: string; pointsCredited: number; cardsCompleted: number }>;
}

export async function backfillUncreditedWalletPoints(): Promise<WalletBackfillResult> {
  const result: WalletBackfillResult = {
    usersProcessed: 0,
    totalPointsCredited: 0,
    ledgerEntriesCreated: 0,
    bucketsCreated: 0,
    errors: [],
    details: [],
  };

  const counters = await db
    .select()
    .from(userGameplayDailyCounters)
    .where(sql`${userGameplayDailyCounters.basePtsAwarded} > 0`);

  console.log(`[WalletBackfill] Found ${counters.length} counter records with points > 0`);

  for (const counter of counters) {
    try {
      const credited = await db.transaction(async (tx) => {
        let [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.userId, counter.userId))
          .for("update")
          .limit(1);

        if (!wallet) {
          const [newWallet] = await tx.insert(wallets).values({
            userId: counter.userId,
            balance: 0,
            lifetimeEarned: 0,
            lifetimeSpent: 0,
            status: "active",
          }).returning();
          wallet = newWallet;
          console.log(`[WalletBackfill] Created wallet for user ${counter.userId}`);
        }

        if (wallet.status !== "active") {
          console.log(`[WalletBackfill] Skipping user ${counter.userId} — wallet status: ${wallet.status}`);
          return 0;
        }

        const events = await tx
          .select()
          .from(gameplayCardDailyEvents)
          .where(and(
            eq(gameplayCardDailyEvents.userId, counter.userId),
            eq(gameplayCardDailyEvents.dayKey, counter.dayKey),
            eq(gameplayCardDailyEvents.isCorrect, true)
          ))
          .orderBy(asc(gameplayCardDailyEvents.createdAt), asc(gameplayCardDailyEvents.cardId));

        let dayPointsCredited = 0;

        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          const idempotencyKey = `daily_base:${counter.userId}:${counter.dayKey}:${event.cardId}`;

          const existingEntry = await tx
            .select({ id: ledgerEntries.id })
            .from(ledgerEntries)
            .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
            .limit(1);

          if (existingEntry.length > 0) {
            continue;
          }

          const cardPosition = i + 1;
          const prevPts = DAILY_GAMEPLAY_BASE.pointsForCardsCompleted(cardPosition - 1);
          const currPts = DAILY_GAMEPLAY_BASE.pointsForCardsCompleted(cardPosition);
          const delta = Math.max(0, currPts - prevPts);

          if (delta <= 0) continue;

          const [freshWallet] = await tx
            .select()
            .from(wallets)
            .where(eq(wallets.id, wallet.id))
            .for("update")
            .limit(1);

          const newBalance = freshWallet.balance + delta;

          const [insertedEntry] = await tx.insert(ledgerEntries).values({
            walletId: wallet.id,
            entryType: "EARN",
            amount: delta,
            balanceAfter: newBalance,
            reason: "Daily card completion reward (backfill)",
            metadata: {
              source: "EARN_GAMEPLAY_BASE_DAILY",
              dayKey: counter.dayKey,
              cardId: event.cardId,
              matchId: event.matchId ?? null,
              cardsCompleted: cardPosition,
              backfill: true,
            },
            idempotencyKey,
          }).returning();

          await tx
            .update(wallets)
            .set({
              balance: newBalance,
              lifetimeEarned: freshWallet.lifetimeEarned + delta,
              updatedAt: new Date(),
            })
            .where(eq(wallets.id, wallet.id));

          await bucketService.createBucket(
            counter.userId,
            delta,
            "EARNED",
            insertedEntry.id,
            {
              source: "EARN_GAMEPLAY_BASE_DAILY",
              dayKey: counter.dayKey,
              cardId: event.cardId,
              backfill: true,
            },
            undefined,
            tx
          );

          dayPointsCredited += delta;
          result.ledgerEntriesCreated++;
          result.bucketsCreated++;
        }

        return dayPointsCredited;
      });

      if (credited > 0) {
        result.totalPointsCredited += credited;
        result.details.push({
          userId: counter.userId,
          dayKey: counter.dayKey,
          pointsCredited: credited,
          cardsCompleted: counter.cardsCompleted,
        });
      }
      result.usersProcessed++;
    } catch (err: any) {
      console.error(`[WalletBackfill] Error processing user=${counter.userId}, day=${counter.dayKey}: ${err.message}`);
      result.errors.push({
        userId: counter.userId,
        dayKey: counter.dayKey,
        error: err.message,
      });
    }
  }

  console.log(`[WalletBackfill] Complete: ${result.usersProcessed} users, ${result.totalPointsCredited} pts credited, ${result.ledgerEntriesCreated} ledger entries, ${result.errors.length} errors`);
  return result;
}

export interface PointsAwardsBackfillResult {
  usersProcessed: number;
  totalPointsCredited: number;
  ledgerEntriesCreated: number;
  errors: Array<{ userId: string; error: string }>;
  details: Array<{ userId: string; pointsCredited: number; awardsProcessed: number }>;
}

export async function backfillPointsAwardsToWallet(): Promise<PointsAwardsBackfillResult> {
  const result: PointsAwardsBackfillResult = {
    usersProcessed: 0,
    totalPointsCredited: 0,
    ledgerEntriesCreated: 0,
    errors: [],
    details: [],
  };

  const userAwards = await db
    .select({
      userId: pointsAwards.userId,
      totalPts: sql<number>`SUM(${pointsAwards.finalPts})`.as("total_pts"),
      awardCount: sql<number>`COUNT(*)`.as("award_count"),
    })
    .from(pointsAwards)
    .groupBy(pointsAwards.userId);

  console.log(`[PointsAwardsBackfill] Found ${userAwards.length} users with points_awards records`);

  for (const userAward of userAwards) {
    try {
      const awards = await db
        .select()
        .from(pointsAwards)
        .where(eq(pointsAwards.userId, userAward.userId))
        .orderBy(asc(pointsAwards.createdAt));

      const credited = await db.transaction(async (tx) => {
        let [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.userId, userAward.userId))
          .for("update")
          .limit(1);

        if (!wallet) {
          const [newWallet] = await tx.insert(wallets).values({
            userId: userAward.userId,
            balance: 0,
            lifetimeEarned: 0,
            lifetimeSpent: 0,
            status: "active",
          }).returning();
          wallet = newWallet;
          console.log(`[PointsAwardsBackfill] Created wallet for user ${userAward.userId}`);
        }

        if (wallet.status !== "active") {
          console.log(`[PointsAwardsBackfill] Skipping user ${userAward.userId} — wallet status: ${wallet.status}`);
          return { pointsCredited: 0, entriesCreated: 0, pendingBuckets: [] as Array<{ userId: string; amount: number; ledgerEntryId: string; awardId: string }> };
        }

        let pointsCredited = 0;
        let entriesCreated = 0;
        const pendingBuckets: Array<{ userId: string; amount: number; ledgerEntryId: string; awardId: string }> = [];

        for (const award of awards) {
          const idempotencyKey = `points_award_backfill:${award.id}`;

          const existing = await tx
            .select({ id: ledgerEntries.id })
            .from(ledgerEntries)
            .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
            .limit(1);

          if (existing.length > 0) {
            continue;
          }

          const newBalance = wallet.balance + award.finalPts;

          const [insertedEntry] = await tx.insert(ledgerEntries).values({
            walletId: wallet.id,
            entryType: "EARN",
            amount: award.finalPts,
            balanceAfter: newBalance,
            reason: `Backfill: ${award.reason || "QUIZ_CORRECT"} (match ${award.matchId || "unknown"})`,
            idempotencyKey,
            metadata: { backfill: true, originalAwardId: award.id, matchId: award.matchId, cardId: award.cardId },
          }).returning();

          await tx
            .update(wallets)
            .set({
              balance: newBalance,
              lifetimeEarned: sql`${wallets.lifetimeEarned} + ${award.finalPts}`,
              updatedAt: new Date(),
            })
            .where(eq(wallets.id, wallet.id));

          pendingBuckets.push({
            userId: userAward.userId,
            amount: award.finalPts,
            ledgerEntryId: insertedEntry.id,
            awardId: award.id,
          });

          wallet = { ...wallet, balance: newBalance };
          pointsCredited += award.finalPts;
          entriesCreated++;
        }

        return { pointsCredited, entriesCreated, pendingBuckets };
      });

      for (const bucket of credited.pendingBuckets) {
        try {
          await bucketService.createBucket(
            bucket.userId,
            bucket.amount,
            "EARNED",
            bucket.ledgerEntryId,
            { backfill: true, originalAwardId: bucket.awardId },
          );
        } catch (bucketErr: any) {
          console.warn(`[PointsAwardsBackfill] Bucket creation failed for award ${bucket.awardId}: ${bucketErr.message}`);
        }
      }

      if (credited.pointsCredited > 0) {
        result.usersProcessed++;
        result.totalPointsCredited += credited.pointsCredited;
        result.ledgerEntriesCreated += credited.entriesCreated;
        result.details.push({
          userId: userAward.userId,
          pointsCredited: credited.pointsCredited,
          awardsProcessed: credited.entriesCreated,
        });
        console.log(`[PointsAwardsBackfill] User ${userAward.userId}: credited ${credited.pointsCredited} pts from ${credited.entriesCreated} awards`);
      }
    } catch (err: any) {
      console.error(`[PointsAwardsBackfill] Error processing user=${userAward.userId}: ${err.message}`);
      result.errors.push({ userId: userAward.userId, error: err.message });
    }
  }

  console.log(`[PointsAwardsBackfill] Complete: ${result.usersProcessed} users, ${result.totalPointsCredited} pts credited, ${result.ledgerEntriesCreated} ledger entries, ${result.errors.length} errors`);
  return result;
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
