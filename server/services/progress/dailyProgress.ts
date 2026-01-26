import { db } from "../../db";
import { userDailyProgress, matches } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

const DAILY_CARD_CAP = 200;

export function getChicagoDate(): string {
  const chicagoTime = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
  });
  const chicagoDate = new Date(chicagoTime);
  const year = chicagoDate.getFullYear();
  const month = String(chicagoDate.getMonth() + 1).padStart(2, "0");
  const day = String(chicagoDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function bumpDailyProgressForMatch(params: {
  tx?: typeof db;
  userId: string;
  cardsDelta: number;
  matchesDelta: number;
}): Promise<void> {
  const { userId, cardsDelta, matchesDelta, tx = db } = params;
  const dayDate = getChicagoDate();

  await tx
    .insert(userDailyProgress)
    .values({
      userId,
      dayDate,
      cardsAnswered: cardsDelta,
      matchesCompleted: matchesDelta,
    })
    .onConflictDoUpdate({
      target: [userDailyProgress.userId, userDailyProgress.dayDate],
      set: {
        cardsAnswered: sql`${userDailyProgress.cardsAnswered} + ${cardsDelta}`,
        matchesCompleted: sql`${userDailyProgress.matchesCompleted} + ${matchesDelta}`,
        updatedAt: sql`now()`,
      },
    });
}

export async function applyProgressForMatchIfNeeded(params: {
  tx?: typeof db;
  matchId: string;
  hostUserId: string;
  guestUserId: string;
  totalQuestions: number;
}): Promise<boolean> {
  const { matchId, hostUserId, guestUserId, totalQuestions, tx = db } = params;

  const [match] = await tx
    .select({ progressApplied: matches.progressApplied })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!match || match.progressApplied) {
    return false;
  }

  const [updated] = await tx
    .update(matches)
    .set({ progressApplied: true })
    .where(and(eq(matches.id, matchId), eq(matches.progressApplied, false)))
    .returning({ id: matches.id });

  if (!updated) {
    return false;
  }

  await Promise.all([
    bumpDailyProgressForMatch({
      tx,
      userId: hostUserId,
      cardsDelta: totalQuestions,
      matchesDelta: 1,
    }),
    bumpDailyProgressForMatch({
      tx,
      userId: guestUserId,
      cardsDelta: totalQuestions,
      matchesDelta: 1,
    }),
  ]);

  return true;
}

export async function getDailyProgress(userId: string): Promise<{
  dayDate: string;
  cardsAnswered: number;
  matchesCompleted: number;
  capCards: number;
}> {
  const dayDate = getChicagoDate();

  const [progress] = await db
    .select()
    .from(userDailyProgress)
    .where(
      and(
        eq(userDailyProgress.userId, userId),
        eq(userDailyProgress.dayDate, dayDate)
      )
    )
    .limit(1);

  return {
    dayDate,
    cardsAnswered: progress?.cardsAnswered ?? 0,
    matchesCompleted: progress?.matchesCompleted ?? 0,
    capCards: DAILY_CARD_CAP,
  };
}
