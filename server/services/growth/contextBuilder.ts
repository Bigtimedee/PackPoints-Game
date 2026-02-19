import { db } from "../../db";
import { dailyChallenges, dailyChallengeEntries, gameSets, playableCards } from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";

const SEASONAL_MOMENTS = [
  { month: 1, day: 1, text: "Happy New Year! Start the year with a bang in PackPTS." },
  { month: 2, day: 2, text: "Groundhog Day — will your card knowledge predict a perfect score?" },
  { month: 2, day: 14, text: "Valentine's Day — show your love for the hobby!" },
  { month: 3, day: 17, text: "St. Patrick's Day — feeling lucky with today's cards?" },
  { month: 4, day: 1, text: "Opening Day vibes! Baseball season is here." },
  { month: 4, day: 15, text: "Jackie Robinson Day — honoring #42." },
  { month: 5, day: 5, text: "Cinco de Mayo celebrations!" },
  { month: 5, day: 25, text: "Memorial Day weekend — time for extra PackPTS sessions." },
  { month: 6, day: 15, text: "Mid-season baseball! All-Star break is approaching." },
  { month: 7, day: 4, text: "Independence Day — celebrate with America's pastime!" },
  { month: 7, day: 15, text: "MLB All-Star Game week!" },
  { month: 8, day: 1, text: "August heat and pennant races — the excitement builds." },
  { month: 9, day: 1, text: "September call-ups and playoff push!" },
  { month: 10, day: 1, text: "Postseason baseball! October magic begins." },
  { month: 10, day: 31, text: "Halloween — spooky good card plays tonight!" },
  { month: 11, day: 11, text: "Veterans Day — honoring those who served." },
  { month: 11, day: 28, text: "Thanksgiving — grateful for the hobby and community." },
  { month: 12, day: 25, text: "Merry Christmas! Gift yourself some PackPTS time." },
  { month: 12, day: 31, text: "New Year's Eve — finish the year strong on the leaderboard!" },
];

function getTodaySeasonalMoment(): string | null {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const match = SEASONAL_MOMENTS.find(s => s.month === month && Math.abs(s.day - day) <= 1);
  return match?.text || null;
}

async function getYesterdayWinners(): Promise<{ username: string; score: number; correct: number }[]> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

    const [challenge] = await db.select().from(dailyChallenges)
      .where(eq(dailyChallenges.date, dateStr))
      .limit(1);

    if (!challenge) return [];

    const entries = await db.select({
      username: sql<string>`COALESCE(u.username, 'Anonymous')`,
      score: dailyChallengeEntries.score,
      correctCount: dailyChallengeEntries.correctCount,
    })
      .from(dailyChallengeEntries)
      .innerJoin(sql`users u`, sql`u.id = ${dailyChallengeEntries.userId}`)
      .where(eq(dailyChallengeEntries.dailyChallengeId, challenge.id))
      .orderBy(desc(dailyChallengeEntries.score))
      .limit(3);

    return entries.map(e => ({ username: e.username, score: e.score, correct: e.correctCount }));
  } catch {
    return [];
  }
}

async function getTodayCardSetTheme(): Promise<string | null> {
  try {
    const [set] = await db.select({ setName: gameSets.setName, brand: gameSets.brand, year: gameSets.year })
      .from(gameSets)
      .where(eq(gameSets.isActive, true))
      .orderBy(sql`RANDOM()`)
      .limit(1);
    return set ? `${set.year} ${set.brand} ${set.setName}` : null;
  } catch {
    return null;
  }
}

async function getActiveSetCount(): Promise<number> {
  try {
    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(gameSets)
      .where(eq(gameSets.isActive, true));
    return Number(result?.count || 0);
  } catch {
    return 0;
  }
}

export interface ContentContext {
  date: string;
  seasonalMoment: string | null;
  yesterdayWinners: { username: string; score: number; correct: number }[];
  todaySetTheme: string | null;
  activeSetCount: number;
}

export async function buildContentContext(): Promise<ContentContext> {
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  const [yesterdayWinners, todaySetTheme, activeSetCount] = await Promise.all([
    getYesterdayWinners(),
    getTodayCardSetTheme(),
    getActiveSetCount(),
  ]);

  return {
    date,
    seasonalMoment: getTodaySeasonalMoment(),
    yesterdayWinners,
    todaySetTheme,
    activeSetCount,
  };
}

export function contextToPromptSection(ctx: ContentContext): string {
  const parts: string[] = ["\n\nIN-APP CONTEXT:"];

  parts.push(`- Date: ${ctx.date}`);

  if (ctx.seasonalMoment) {
    parts.push(`- Seasonal moment: ${ctx.seasonalMoment}`);
  }

  if (ctx.todaySetTheme) {
    parts.push(`- Today's featured card set: ${ctx.todaySetTheme}`);
  }

  if (ctx.activeSetCount > 0) {
    parts.push(`- Active card sets available: ${ctx.activeSetCount}`);
  }

  if (ctx.yesterdayWinners.length > 0) {
    const winners = ctx.yesterdayWinners
      .map((w, i) => `${i + 1}. ${w.username} (${w.score} pts, ${w.correct}/5 correct)`)
      .join(", ");
    parts.push(`- Yesterday's Daily 5 top players: ${winners}`);
  }

  return parts.join("\n");
}
