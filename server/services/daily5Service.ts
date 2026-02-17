import { createHash } from "crypto";
import { db } from "../db";
import { 
  dailyChallenges, dailyChallengeCards, dailyChallengeEntries,
  playableCards, gameSets,
  type DailyChallenge, type DailyChallengeCard, type DailyChallengeEntry,
  type PlayableCard
} from "@shared/schema";
import { eq, and, desc, isNotNull, ne, isNull, or, not, like, sql, asc } from "drizzle-orm";
import { isKnownSilhouetteUrl } from "../storage";

const DAILY5_TZ = process.env.GROWTH_AGENT_DAILY5_TZ || "America/New_York";
const DAILY5_START_HOUR = parseInt(process.env.GROWTH_AGENT_DAILY5_START_HOUR || "20", 10);
const DAILY5_START_MINUTE = parseInt(process.env.GROWTH_AGENT_DAILY5_START_MINUTE || "0", 10);
const SECRET_SALT = process.env.SECRET_SALT || process.env.GROWTH_AGENT_SECRET_SALT || "packpts-daily5-default-salt-change-me";

function getDateStringInTZ(tz: string, date?: Date): string {
  const d = date || new Date();
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

function getTodayDateString(): string {
  return getDateStringInTZ(DAILY5_TZ);
}

function getDailyStartEnd(dateStr: string): { startsAt: Date; endsAt: Date } {
  const parts = dateStr.split("-").map(Number);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: DAILY5_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });

  const baseDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  const formatted = formatter.formatToParts(baseDate);
  const tzOffset = baseDate.getTimezoneOffset();
  
  const startHourUTC = new Date(`${dateStr}T${String(DAILY5_START_HOUR).padStart(2, "0")}:${String(DAILY5_START_MINUTE).padStart(2, "0")}:00`);
  
  const tzName = DAILY5_TZ;
  const tempDate = new Date(
    new Date(`${dateStr}T${String(DAILY5_START_HOUR).padStart(2, "0")}:${String(DAILY5_START_MINUTE).padStart(2, "0")}:00`).toLocaleString("en-US", { timeZone: "UTC" })
  );

  const localStart = new Date(
    new Date(`${dateStr}T${String(DAILY5_START_HOUR).padStart(2, "0")}:${String(DAILY5_START_MINUTE).padStart(2, "0")}:00`).toLocaleString("en-US")
  );

  const utcStart = getUTCForLocalTime(dateStr, DAILY5_START_HOUR, DAILY5_START_MINUTE, DAILY5_TZ);
  const utcEnd = new Date(utcStart.getTime() + 24 * 60 * 60 * 1000);

  return { startsAt: utcStart, endsAt: utcEnd };
}

function getUTCForLocalTime(dateStr: string, hour: number, minute: number, tz: string): Date {
  const testDate = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
  
  const utcStr = testDate.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = testDate.toLocaleString("en-US", { timeZone: tz });
  
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  const offsetMs = utcDate.getTime() - tzDate.getTime();
  
  const localMs = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`).getTime();
  return new Date(localMs + offsetMs);
}

function deterministicSeed(dateStr: string, setId: string): string {
  return createHash("sha256").update(`${dateStr}:${setId}:${SECRET_SALT}`).digest("hex");
}

function deterministicShuffle<T>(arr: T[], seed: string): T[] {
  const result = [...arr];
  let hashIndex = 0;
  const hashBytes = Buffer.from(seed, "hex");

  for (let i = result.length - 1; i > 0; i--) {
    const byte1 = hashBytes[hashIndex % hashBytes.length];
    const byte2 = hashBytes[(hashIndex + 1) % hashBytes.length];
    hashIndex += 2;
    const j = ((byte1 << 8) | byte2) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export class Daily5Service {
  async getOrCreateTodayChallenge(): Promise<DailyChallenge | null> {
    const today = getTodayDateString();
    
    const [existing] = await db
      .select()
      .from(dailyChallenges)
      .where(eq(dailyChallenges.date, today))
      .limit(1);

    if (existing) return existing;

    return this.createChallengeForDate(today);
  }

  async createChallengeForDate(dateStr: string): Promise<DailyChallenge | null> {
    const [existingCheck] = await db
      .select()
      .from(dailyChallenges)
      .where(eq(dailyChallenges.date, dateStr))
      .limit(1);
    if (existingCheck) return existingCheck;

    const [activeSet] = await db
      .select()
      .from(gameSets)
      .where(eq(gameSets.isActive, true))
      .orderBy(desc(gameSets.cardsImportedCount))
      .limit(1);

    if (!activeSet) {
      console.error("[Daily5] No active game set found");
      return null;
    }

    const seed = deterministicSeed(dateStr, activeSet.id);
    const { startsAt, endsAt } = getDailyStartEnd(dateStr);

    const [challenge] = await db
      .insert(dailyChallenges)
      .values({
        date: dateStr,
        mode: "DAILY5",
        setId: activeSet.id,
        seed,
        startsAt,
        endsAt,
        status: "SCHEDULED",
      })
      .onConflictDoNothing()
      .returning();

    if (!challenge) {
      const [existing] = await db
        .select()
        .from(dailyChallenges)
        .where(eq(dailyChallenges.date, dateStr))
        .limit(1);
      return existing || null;
    }

    await this.selectCardsForChallenge(challenge, activeSet.id, seed);

    console.log(`[Daily5] Created challenge for ${dateStr} with set ${activeSet.setName}, starts at ${startsAt.toISOString()}`);
    return challenge;
  }

  private async selectCardsForChallenge(challenge: DailyChallenge, setId: string, seed: string): Promise<void> {
    const candidates = await db
      .select()
      .from(playableCards)
      .where(
        and(
          eq(playableCards.gameSetId, setId),
          eq(playableCards.isPlayable, true),
          or(isNull(playableCards.contentVerified), eq(playableCards.contentVerified, true)),
          isNotNull(playableCards.imageUrl),
          ne(playableCards.imageUrl, ""),
          not(like(playableCards.imageUrl, "%null%")),
          like(playableCards.imageUrl, "https://%"),
          not(like(playableCards.imageUrl, "%s3.amazonaws.com/appforest_uf%05-Baseball%")),
          not(like(playableCards.imageUrl, "%s3.amazonaws.com/appforest_uf%05-Football%")),
          not(like(playableCards.imageUrl, "%s3.amazonaws.com/appforest_uf%05-Basketball%")),
          isNotNull(playableCards.player),
          ne(playableCards.player, ""),
          or(
            isNull(playableCards.imageReviewStatus),
            ne(playableCards.imageReviewStatus, "rejected")
          )
        )
      );

    const filtered = candidates.filter(c => !isKnownSilhouetteUrl(c.imageUrl));
    if (filtered.length < 5) {
      console.error(`[Daily5] Not enough playable cards (${filtered.length}) for date ${challenge.date}`);
      return;
    }

    const shuffled = deterministicShuffle(filtered, seed);
    const selected = shuffled.slice(0, 5);

    const allPlayerNames = candidates
      .map(c => c.player)
      .filter((p): p is string => !!p);
    const uniqueNames = Array.from(new Set(allPlayerNames));

    for (let i = 0; i < selected.length; i++) {
      const card = selected[i];
      const correctAnswer = card.player || "Unknown";
      const wrongOptions = uniqueNames
        .filter(name => name !== correctAnswer)
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);
      const choices = [correctAnswer, ...wrongOptions].sort(() => Math.random() - 0.5);

      await db.insert(dailyChallengeCards).values({
        dailyChallengeId: challenge.id,
        position: i + 1,
        cardId: card.id,
        correctAnswer,
        choices,
        pointValue: 100,
      });
    }
  }

  async updateChallengeStatuses(): Promise<void> {
    const now = new Date();

    await db
      .update(dailyChallenges)
      .set({ status: "ACTIVE" })
      .where(
        and(
          eq(dailyChallenges.status, "SCHEDULED"),
          sql`${dailyChallenges.startsAt} <= ${now}`
        )
      );

    await db
      .update(dailyChallenges)
      .set({ status: "CLOSED" })
      .where(
        and(
          eq(dailyChallenges.status, "ACTIVE"),
          sql`${dailyChallenges.endsAt} <= ${now}`
        )
      );
  }

  async getStatus(userId?: string): Promise<{
    challenge: DailyChallenge | null;
    hasPlayed: boolean;
    entry: DailyChallengeEntry | null;
    timeUntilStart?: number;
    timeUntilEnd?: number;
  }> {
    await this.updateChallengeStatuses();
    const challenge = await this.getOrCreateTodayChallenge();
    if (!challenge) {
      return { challenge: null, hasPlayed: false, entry: null };
    }

    await this.updateChallengeStatuses();

    const [freshChallenge] = await db
      .select()
      .from(dailyChallenges)
      .where(eq(dailyChallenges.id, challenge.id))
      .limit(1);

    let hasPlayed = false;
    let entry: DailyChallengeEntry | null = null;
    if (userId) {
      const [userEntry] = await db
        .select()
        .from(dailyChallengeEntries)
        .where(
          and(
            eq(dailyChallengeEntries.dailyChallengeId, freshChallenge.id),
            eq(dailyChallengeEntries.userId, userId)
          )
        )
        .limit(1);
      if (userEntry) {
        hasPlayed = !!userEntry.completedAt;
        entry = userEntry;
      }
    }

    const now = Date.now();
    const startsAt = new Date(freshChallenge.startsAt).getTime();
    const endsAt = new Date(freshChallenge.endsAt).getTime();

    return {
      challenge: freshChallenge,
      hasPlayed,
      entry,
      timeUntilStart: startsAt > now ? startsAt - now : 0,
      timeUntilEnd: endsAt > now ? endsAt - now : 0,
    };
  }

  async startChallenge(userId: string): Promise<{
    entry: DailyChallengeEntry;
    cards: { position: number; cardId: string; imageUrl: string; choices: string[]; pointValue: number }[];
  }> {
    await this.updateChallengeStatuses();
    const challenge = await this.getOrCreateTodayChallenge();
    if (!challenge) throw new Error("No challenge available today");

    const [fresh] = await db
      .select()
      .from(dailyChallenges)
      .where(eq(dailyChallenges.id, challenge.id))
      .limit(1);

    if (fresh.status !== "ACTIVE") {
      throw new Error(`Challenge is ${fresh.status}, not active`);
    }

    const [existingEntry] = await db
      .select()
      .from(dailyChallengeEntries)
      .where(
        and(
          eq(dailyChallengeEntries.dailyChallengeId, challenge.id),
          eq(dailyChallengeEntries.userId, userId)
        )
      )
      .limit(1);

    if (existingEntry?.completedAt) {
      throw new Error("You have already completed today's Daily 5");
    }

    let entry = existingEntry;
    if (!entry) {
      const [newEntry] = await db
        .insert(dailyChallengeEntries)
        .values({
          dailyChallengeId: challenge.id,
          userId,
          score: 0,
          correctCount: 0,
          answers: [],
        })
        .onConflictDoNothing()
        .returning();

      if (!newEntry) {
        const [existing] = await db
          .select()
          .from(dailyChallengeEntries)
          .where(
            and(
              eq(dailyChallengeEntries.dailyChallengeId, challenge.id),
              eq(dailyChallengeEntries.userId, userId)
            )
          )
          .limit(1);
        entry = existing;
      } else {
        entry = newEntry;
      }
    }

    if (!entry) throw new Error("Failed to create entry");

    const cards = await db
      .select()
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id))
      .orderBy(asc(dailyChallengeCards.position));

    const maskedCards = cards.map(c => ({
      position: c.position,
      cardId: c.cardId,
      imageUrl: `/api/cards/${c.cardId}/masked-image`,
      choices: c.choices,
      pointValue: c.pointValue,
    }));

    return { entry, cards: maskedCards };
  }

  async submitAnswer(userId: string, challengeId: string, position: number, selectedAnswer: string): Promise<{
    correct: boolean;
    correctAnswer: string;
    pointsEarned: number;
    score: number;
    correctCount: number;
  }> {
    const [entry] = await db
      .select()
      .from(dailyChallengeEntries)
      .where(
        and(
          eq(dailyChallengeEntries.dailyChallengeId, challengeId),
          eq(dailyChallengeEntries.userId, userId)
        )
      )
      .limit(1);

    if (!entry) throw new Error("No entry found - start the challenge first");
    if (entry.completedAt) throw new Error("Challenge already completed");

    const answers = (entry.answers || []) as { position: number; selected: string; correct: boolean; timeMs?: number }[];
    if (answers.some(a => a.position === position)) {
      throw new Error(`Position ${position} already answered`);
    }

    const [card] = await db
      .select()
      .from(dailyChallengeCards)
      .where(
        and(
          eq(dailyChallengeCards.dailyChallengeId, challengeId),
          eq(dailyChallengeCards.position, position)
        )
      )
      .limit(1);

    if (!card) throw new Error(`No card at position ${position}`);

    const correct = selectedAnswer === card.correctAnswer;
    const pointsEarned = correct ? card.pointValue : 0;

    const newAnswers = [...answers, { position, selected: selectedAnswer, correct }];
    const newScore = entry.score + pointsEarned;
    const newCorrectCount = entry.correctCount + (correct ? 1 : 0);

    await db
      .update(dailyChallengeEntries)
      .set({
        answers: newAnswers,
        score: newScore,
        correctCount: newCorrectCount,
      })
      .where(eq(dailyChallengeEntries.id, entry.id));

    return {
      correct,
      correctAnswer: card.correctAnswer,
      pointsEarned,
      score: newScore,
      correctCount: newCorrectCount,
    };
  }

  async finishChallenge(userId: string, challengeId: string): Promise<{
    score: number;
    correctCount: number;
    totalTime: number;
    rank: number;
  }> {
    const [entry] = await db
      .select()
      .from(dailyChallengeEntries)
      .where(
        and(
          eq(dailyChallengeEntries.dailyChallengeId, challengeId),
          eq(dailyChallengeEntries.userId, userId)
        )
      )
      .limit(1);

    if (!entry) throw new Error("No entry found");
    if (entry.completedAt) throw new Error("Already completed");

    const now = new Date();
    const startedAt = entry.startedAt ? new Date(entry.startedAt) : now;
    const totalTimeMs = now.getTime() - startedAt.getTime();

    await db
      .update(dailyChallengeEntries)
      .set({
        completedAt: now,
        timeMs: totalTimeMs,
      })
      .where(eq(dailyChallengeEntries.id, entry.id));

    const rank = await this.getRankForEntry(challengeId, entry.score, totalTimeMs);

    return {
      score: entry.score,
      correctCount: entry.correctCount,
      totalTime: totalTimeMs,
      rank,
    };
  }

  private async getRankForEntry(challengeId: string, score: number, timeMs: number): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(dailyChallengeEntries)
      .where(
        and(
          eq(dailyChallengeEntries.dailyChallengeId, challengeId),
          isNotNull(dailyChallengeEntries.completedAt),
          sql`(${dailyChallengeEntries.score} > ${score} OR (${dailyChallengeEntries.score} = ${score} AND ${dailyChallengeEntries.timeMs} < ${timeMs}))`
        )
      );

    return (result?.count || 0) + 1;
  }

  async getLeaderboard(dateStr?: string, limit: number = 100): Promise<{
    entries: {
      rank: number;
      userId: string;
      username: string;
      score: number;
      correctCount: number;
      timeMs: number | null;
    }[];
    date: string;
    totalEntries: number;
  }> {
    const date = dateStr || getTodayDateString();

    const [challenge] = await db
      .select()
      .from(dailyChallenges)
      .where(eq(dailyChallenges.date, date))
      .limit(1);

    if (!challenge) {
      return { entries: [], date, totalEntries: 0 };
    }

    const entries = await db.execute(sql`
      SELECT 
        dce.user_id,
        u.username,
        dce.score,
        dce.correct_count,
        dce.time_ms,
        ROW_NUMBER() OVER (ORDER BY dce.score DESC, dce.time_ms ASC NULLS LAST) as rank
      FROM daily_challenge_entries dce
      JOIN users u ON u.id = dce.user_id
      WHERE dce.daily_challenge_id = ${challenge.id}
        AND dce.completed_at IS NOT NULL
      ORDER BY dce.score DESC, dce.time_ms ASC NULLS LAST
      LIMIT ${limit}
    `);

    const [totalResult] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(dailyChallengeEntries)
      .where(
        and(
          eq(dailyChallengeEntries.dailyChallengeId, challenge.id),
          isNotNull(dailyChallengeEntries.completedAt)
        )
      );

    return {
      entries: (entries.rows as any[]).map(row => ({
        rank: Number(row.rank),
        userId: row.user_id,
        username: row.username || "Anonymous",
        score: row.score,
        correctCount: row.correct_count,
        timeMs: row.time_ms,
      })),
      date,
      totalEntries: totalResult?.count || 0,
    };
  }

  async getYesterdayResults(): Promise<{
    date: string;
    winners: { username: string; score: number; correctCount: number }[];
    totalParticipants: number;
    challenge: DailyChallenge | null;
  } | null> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = getDateStringInTZ(DAILY5_TZ, yesterday);

    const [challenge] = await db
      .select()
      .from(dailyChallenges)
      .where(eq(dailyChallenges.date, dateStr))
      .limit(1);

    if (!challenge) return null;

    const lb = await this.getLeaderboard(dateStr, 3);
    return {
      date: dateStr,
      winners: lb.entries.map(e => ({
        username: e.username,
        score: e.score,
        correctCount: e.correctCount,
      })),
      totalParticipants: lb.totalEntries,
      challenge,
    };
  }
}

export const daily5Service = new Daily5Service();