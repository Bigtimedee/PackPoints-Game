import { db } from "../../db";
import { userDailyProgress, matches, matchParticipants } from "@shared/schema";
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
  tx?: any;
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
  matchId: string;
  hostUserId: string;
  guestUserId: string;
  totalQuestions: number;
}): Promise<boolean> {
  const { matchId, hostUserId, guestUserId, totalQuestions } = params;

  return await db.transaction(async (tx) => {
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
  });
}

function getChicagoMidnightResetMs(): number {
  const now = new Date();
  const chicagoNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const chicagoTomorrow = new Date(chicagoNow);
  chicagoTomorrow.setDate(chicagoTomorrow.getDate() + 1);
  chicagoTomorrow.setHours(0, 0, 0, 0);
  return chicagoTomorrow.getTime() - chicagoNow.getTime();
}

export async function getDailyProgress(userId: string): Promise<{
  dayDate: string;
  cardsAnswered: number;
  matchesCompleted: number;
  capCards: number;
  resetInMs: number;
}> {
  const dayDate = getChicagoDate();
  const resetInMs = getChicagoMidnightResetMs();

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
    resetInMs,
  };
}

function toChicagoDate(date: Date): string {
  const chicagoTime = date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
  });
  const chicagoDate = new Date(chicagoTime);
  const year = chicagoDate.getFullYear();
  const month = String(chicagoDate.getMonth() + 1).padStart(2, "0");
  const day = String(chicagoDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function backfillProgressForFinishedMatches(): Promise<{
  matchesProcessed: number;
  matchesSkipped: number;
  errors: string[];
}> {
  const finishedMatches = await db
    .select({
      id: matches.id,
      finishedAt: matches.finishedAt,
      totalQuestions: matches.totalQuestions,
      progressApplied: matches.progressApplied,
    })
    .from(matches)
    .where(and(eq(matches.status, "FINISHED"), eq(matches.progressApplied, false)));

  let matchesProcessed = 0;
  let matchesSkipped = 0;
  const errors: string[] = [];

  for (const match of finishedMatches) {
    try {
      const participants = await db
        .select({ userId: matchParticipants.userId })
        .from(matchParticipants)
        .where(eq(matchParticipants.matchId, match.id));

      if (participants.length < 2) {
        matchesSkipped++;
        errors.push(`Match ${match.id}: only ${participants.length} participant(s)`);
        continue;
      }

      const dayDate = match.finishedAt
        ? toChicagoDate(new Date(match.finishedAt))
        : getChicagoDate();

      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(matches)
          .set({ progressApplied: true })
          .where(and(eq(matches.id, match.id), eq(matches.progressApplied, false)))
          .returning({ id: matches.id });

        if (!updated) {
          matchesSkipped++;
          return;
        }

        for (const p of participants) {
          await tx
            .insert(userDailyProgress)
            .values({
              userId: p.userId,
              dayDate,
              cardsAnswered: match.totalQuestions,
              matchesCompleted: 1,
            })
            .onConflictDoUpdate({
              target: [userDailyProgress.userId, userDailyProgress.dayDate],
              set: {
                cardsAnswered: sql`${userDailyProgress.cardsAnswered} + ${match.totalQuestions}`,
                matchesCompleted: sql`${userDailyProgress.matchesCompleted} + 1`,
                updatedAt: sql`now()`,
              },
            });
        }

        matchesProcessed++;
      });
    } catch (err: any) {
      errors.push(`Match ${match.id}: ${err.message}`);
    }
  }

  return { matchesProcessed, matchesSkipped, errors };
}
