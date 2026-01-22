import { db } from "../../db";
import { sql, and, eq, gte, lt, count, countDistinct, sum } from "drizzle-orm";
import {
  authEvents,
  deviceEvents,
  paymentEvents,
  redemptionEvents,
  gameplayEvents,
  userRollup24h,
  deviceRollup24h,
  ipRollup24h,
} from "@shared/schema";

function getWindowBounds(windowStart: Date): { start: Date; end: Date } {
  const start = new Date(windowStart);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function computeUserRollup24h(userId: string, windowStart: Date): Promise<void> {
  const { start, end } = getWindowBounds(windowStart);

  const authStats = await db
    .select({
      loginFailCount: sql<number>`count(*) filter (where ${authEvents.eventType} = 'LOGIN_FAIL')`,
      loginSuccessCount: sql<number>`count(*) filter (where ${authEvents.eventType} = 'LOGIN_SUCCESS')`,
    })
    .from(authEvents)
    .where(
      and(
        eq(authEvents.userId, userId),
        gte(authEvents.createdAt, start),
        lt(authEvents.createdAt, end)
      )
    );

  const deviceStats = await db
    .select({
      distinctDeviceCount: countDistinct(authEvents.deviceId),
      distinctIpCount: countDistinct(authEvents.ipHash),
    })
    .from(authEvents)
    .where(
      and(
        eq(authEvents.userId, userId),
        gte(authEvents.createdAt, start),
        lt(authEvents.createdAt, end)
      )
    );

  const paymentStats = await db
    .select({
      purchaseCount: sql<number>`count(*) filter (where ${paymentEvents.eventType} = 'PAID')`,
      purchaseAmountCents: sql<number>`coalesce(sum(${paymentEvents.amountCents}) filter (where ${paymentEvents.eventType} = 'PAID'), 0)`,
    })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.userId, userId),
        gte(paymentEvents.createdAt, start),
        lt(paymentEvents.createdAt, end)
      )
    );

  const redemptionStats = await db
    .select({
      applyCount: sql<number>`count(*) filter (where ${redemptionEvents.eventType} = 'APPLY')`,
      ptsApproved: sql<number>`coalesce(sum(${redemptionEvents.ptsApproved}) filter (where ${redemptionEvents.eventType} = 'APPLY'), 0)`,
    })
    .from(redemptionEvents)
    .where(
      and(
        eq(redemptionEvents.userId, userId),
        gte(redemptionEvents.createdAt, start),
        lt(redemptionEvents.createdAt, end)
      )
    );

  const gameplayStats = await db
    .select({
      matchCount: countDistinct(gameplayEvents.matchId),
      answerCount: sql<number>`count(*) filter (where ${gameplayEvents.eventType} = 'ANSWER_SUBMITTED')`,
      correctCount: sql<number>`count(*) filter (where ${gameplayEvents.answerCorrect} = true)`,
    })
    .from(gameplayEvents)
    .where(
      and(
        eq(gameplayEvents.userId, userId),
        gte(gameplayEvents.createdAt, start),
        lt(gameplayEvents.createdAt, end)
      )
    );

  const responseTimes = await db
    .select({ responseTimeMs: gameplayEvents.responseTimeMs })
    .from(gameplayEvents)
    .where(
      and(
        eq(gameplayEvents.userId, userId),
        eq(gameplayEvents.eventType, "ANSWER_SUBMITTED"),
        gte(gameplayEvents.createdAt, start),
        lt(gameplayEvents.createdAt, end)
      )
    );

  let medianResponseMs: number | null = null;
  if (responseTimes.length > 0) {
    const times = responseTimes
      .map((r) => r.responseTimeMs)
      .filter((t): t is number => t !== null)
      .sort((a, b) => a - b);
    if (times.length > 0) {
      const mid = Math.floor(times.length / 2);
      medianResponseMs = times.length % 2 === 0
        ? Math.round((times[mid - 1] + times[mid]) / 2)
        : times[mid];
    }
  }

  await db
    .insert(userRollup24h)
    .values({
      userId,
      windowStart: start,
      loginFailCount: Number(authStats[0]?.loginFailCount || 0),
      loginSuccessCount: Number(authStats[0]?.loginSuccessCount || 0),
      distinctDeviceCount: Number(deviceStats[0]?.distinctDeviceCount || 0),
      distinctIpCount: Number(deviceStats[0]?.distinctIpCount || 0),
      purchaseCount: Number(paymentStats[0]?.purchaseCount || 0),
      purchaseAmountCents: Number(paymentStats[0]?.purchaseAmountCents || 0),
      redemptionApplyCount: Number(redemptionStats[0]?.applyCount || 0),
      redemptionPtsApproved: Number(redemptionStats[0]?.ptsApproved || 0),
      gameplayMatches: Number(gameplayStats[0]?.matchCount || 0),
      gameplayAnswers: Number(gameplayStats[0]?.answerCount || 0),
      gameplayCorrect: Number(gameplayStats[0]?.correctCount || 0),
      gameplayMedianResponseMs: medianResponseMs,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userRollup24h.userId, userRollup24h.windowStart],
      set: {
        loginFailCount: Number(authStats[0]?.loginFailCount || 0),
        loginSuccessCount: Number(authStats[0]?.loginSuccessCount || 0),
        distinctDeviceCount: Number(deviceStats[0]?.distinctDeviceCount || 0),
        distinctIpCount: Number(deviceStats[0]?.distinctIpCount || 0),
        purchaseCount: Number(paymentStats[0]?.purchaseCount || 0),
        purchaseAmountCents: Number(paymentStats[0]?.purchaseAmountCents || 0),
        redemptionApplyCount: Number(redemptionStats[0]?.applyCount || 0),
        redemptionPtsApproved: Number(redemptionStats[0]?.ptsApproved || 0),
        gameplayMatches: Number(gameplayStats[0]?.matchCount || 0),
        gameplayAnswers: Number(gameplayStats[0]?.answerCount || 0),
        gameplayCorrect: Number(gameplayStats[0]?.correctCount || 0),
        gameplayMedianResponseMs: medianResponseMs,
        updatedAt: new Date(),
      },
    });
}

export async function computeDeviceRollup24h(deviceId: string, windowStart: Date): Promise<void> {
  const { start, end } = getWindowBounds(windowStart);

  const userStats = await db
    .select({
      distinctUserCount: countDistinct(authEvents.userId),
      signupCount: sql<number>`count(*) filter (where ${authEvents.eventType} = 'SIGNUP')`,
    })
    .from(authEvents)
    .where(
      and(
        eq(authEvents.deviceId, deviceId),
        gte(authEvents.createdAt, start),
        lt(authEvents.createdAt, end)
      )
    );

  const paymentStats = await db
    .select({
      purchaseCount: sql<number>`count(*) filter (where ${paymentEvents.eventType} = 'PAID')`,
      purchaseAmountCents: sql<number>`coalesce(sum(${paymentEvents.amountCents}) filter (where ${paymentEvents.eventType} = 'PAID'), 0)`,
    })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.deviceId, deviceId),
        gte(paymentEvents.createdAt, start),
        lt(paymentEvents.createdAt, end)
      )
    );

  await db
    .insert(deviceRollup24h)
    .values({
      deviceId,
      windowStart: start,
      distinctUserCount: Number(userStats[0]?.distinctUserCount || 0),
      signupCount: Number(userStats[0]?.signupCount || 0),
      purchaseCount: Number(paymentStats[0]?.purchaseCount || 0),
      purchaseAmountCents: Number(paymentStats[0]?.purchaseAmountCents || 0),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [deviceRollup24h.deviceId, deviceRollup24h.windowStart],
      set: {
        distinctUserCount: Number(userStats[0]?.distinctUserCount || 0),
        signupCount: Number(userStats[0]?.signupCount || 0),
        purchaseCount: Number(paymentStats[0]?.purchaseCount || 0),
        purchaseAmountCents: Number(paymentStats[0]?.purchaseAmountCents || 0),
        updatedAt: new Date(),
      },
    });
}

export async function computeIpRollup24h(ipHash: string, windowStart: Date): Promise<void> {
  const { start, end } = getWindowBounds(windowStart);

  const userStats = await db
    .select({
      distinctUserCount: countDistinct(authEvents.userId),
      signupCount: sql<number>`count(*) filter (where ${authEvents.eventType} = 'SIGNUP')`,
    })
    .from(authEvents)
    .where(
      and(
        eq(authEvents.ipHash, ipHash),
        gte(authEvents.createdAt, start),
        lt(authEvents.createdAt, end)
      )
    );

  const paymentStats = await db
    .select({
      purchaseCount: sql<number>`count(*) filter (where ${paymentEvents.eventType} = 'PAID')`,
      purchaseAmountCents: sql<number>`coalesce(sum(${paymentEvents.amountCents}) filter (where ${paymentEvents.eventType} = 'PAID'), 0)`,
    })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.ipHash, ipHash),
        gte(paymentEvents.createdAt, start),
        lt(paymentEvents.createdAt, end)
      )
    );

  await db
    .insert(ipRollup24h)
    .values({
      ipHash,
      windowStart: start,
      distinctUserCount: Number(userStats[0]?.distinctUserCount || 0),
      signupCount: Number(userStats[0]?.signupCount || 0),
      purchaseCount: Number(paymentStats[0]?.purchaseCount || 0),
      purchaseAmountCents: Number(paymentStats[0]?.purchaseAmountCents || 0),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [ipRollup24h.ipHash, ipRollup24h.windowStart],
      set: {
        distinctUserCount: Number(userStats[0]?.distinctUserCount || 0),
        signupCount: Number(userStats[0]?.signupCount || 0),
        purchaseCount: Number(paymentStats[0]?.purchaseCount || 0),
        purchaseAmountCents: Number(paymentStats[0]?.purchaseAmountCents || 0),
        updatedAt: new Date(),
      },
    });
}

export function getTodayWindowStart(): Date {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now;
}
