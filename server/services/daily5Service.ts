import { createHash } from "crypto";
import { db } from "../db";
import { 
  dailyChallenges, dailyChallengeCards, dailyChallengeEntries,
  playableCards, gameSets, users,
  type DailyChallenge, type DailyChallengeCard, type DailyChallengeEntry,
  type PlayableCard
} from "@shared/schema";
import { eq, and, desc, isNotNull, ne, isNull, or, not, like, sql, asc, gte } from "drizzle-orm";
import { isKnownSilhouetteUrl } from "../storage";
import { applyLedgerEntry } from "./packpts/ledgerService";

const DAILY5_TZ = process.env.GROWTH_AGENT_DAILY5_TZ || "America/New_York";
const DAILY5_START_HOUR = parseInt(process.env.GROWTH_AGENT_DAILY5_START_HOUR || "20", 10);
const DAILY5_START_MINUTE = parseInt(process.env.GROWTH_AGENT_DAILY5_START_MINUTE || "0", 10);
const SECRET_SALT = process.env.SECRET_SALT || process.env.GROWTH_AGENT_SECRET_SALT || "packpts-daily5-default-salt-change-me";

const DAILY5_MAX_POINTS = parseInt(process.env.DAILY5_MAX_POINTS || "250", 10);
const DAILY5_MIN_TIME_MS = parseInt(process.env.DAILY5_MIN_TIME_MS || "15000", 10);
const DAILY5_PERFECT_STREAK_THRESHOLD = parseInt(process.env.DAILY5_PERFECT_STREAK_THRESHOLD || "3", 10);
const DAILY5_NEW_ACCOUNT_DAYS = parseInt(process.env.DAILY5_NEW_ACCOUNT_DAYS || "7", 10);

function getDateStringInTZ(tz: string, date?: Date): string {
  const d = date || new Date();
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

function getTodayDateString(): string {
  return getDateStringInTZ(DAILY5_TZ);
}

function getDailyStartEnd(dateStr: string): { startsAt: Date; endsAt: Date } {
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

function perUserChoiceSeed(challengeId: string, userId: string, position: number): string {
  return createHash("sha256").update(`${challengeId}:${userId}:${position}:${SECRET_SALT}`).digest("hex");
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
      const wrongOptions = deterministicShuffle(
        uniqueNames.filter(name => name !== correctAnswer),
        createHash("sha256").update(`${seed}:wrong:${i}`).digest("hex")
      ).slice(0, 3);
      const choices = [correctAnswer, ...wrongOptions];

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

    const maskedCards = cards.map(c => {
      const userSeed = perUserChoiceSeed(challenge.id, userId, c.position);
      const shuffledChoices = deterministicShuffle(c.choices as string[], userSeed);
      return {
        position: c.position,
        cardId: c.cardId,
        imageUrl: `/api/cards/${c.cardId}/masked-image`,
        choices: shuffledChoices,
        pointValue: c.pointValue,
      };
    });

    return { entry, cards: maskedCards };
  }

  async submitAnswer(userId: string, challengeId: string, position: number, selectedAnswer: string): Promise<{
    correct: boolean;
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
    flagged: boolean;
    correctAnswers: { position: number; correctAnswer: string }[];
    pointsCredited: number;
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

    const flagReasons: string[] = [];

    if (totalTimeMs < DAILY5_MIN_TIME_MS) {
      flagReasons.push(`completed_too_fast:${totalTimeMs}ms`);
    }

    const perfectStreak = await this.checkPerfectStreak(userId);
    if (perfectStreak >= DAILY5_PERFECT_STREAK_THRESHOLD && entry.correctCount === 5) {
      flagReasons.push(`perfect_streak:${perfectStreak + 1}_consecutive`);
    }

    const isNewAccount = await this.isNewAccount(userId);
    if (isNewAccount && entry.correctCount === 5) {
      flagReasons.push("new_account_perfect_score");
    }

    const isFlagged = flagReasons.length > 0;

    const cappedScore = Math.min(entry.score, DAILY5_MAX_POINTS);

    await db
      .update(dailyChallengeEntries)
      .set({
        completedAt: now,
        timeMs: totalTimeMs,
        score: cappedScore,
        flagged: isFlagged,
        flagReason: isFlagged ? flagReasons.join("; ") : null,
      })
      .where(eq(dailyChallengeEntries.id, entry.id));

    let pointsCredited = 0;
    if (!isFlagged && cappedScore > 0) {
      try {
        await applyLedgerEntry({
          userId,
          direction: "credit",
          amountPackpts: cappedScore,
          source: "gameplay",
          eventType: "daily5_reward",
          refType: "daily_challenge_entry",
          refId: entry.id,
          idempotencyKey: `daily5:${challengeId}:${userId}`,
          metadata: { challengeId, correctCount: entry.correctCount, timeMs: totalTimeMs },
        });
        pointsCredited = cappedScore;
        await db
          .update(dailyChallengeEntries)
          .set({ creditedAt: now })
          .where(eq(dailyChallengeEntries.id, entry.id));
        console.log(`[Daily5] Credited ${cappedScore} PackPTS to user ${userId} for challenge ${challengeId}`);
      } catch (err) {
        console.error(`[Daily5] Failed to credit PackPTS to user ${userId}:`, err);
      }
    } else if (isFlagged) {
      console.warn(`[Daily5] Entry flagged for user ${userId}: ${flagReasons.join("; ")} - points withheld`);
    }

    const cards = await db
      .select({ position: dailyChallengeCards.position, correctAnswer: dailyChallengeCards.correctAnswer })
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, challengeId))
      .orderBy(asc(dailyChallengeCards.position));

    const rank = await this.getRankForEntry(challengeId, cappedScore, totalTimeMs);

    return {
      score: cappedScore,
      correctCount: entry.correctCount,
      totalTime: totalTimeMs,
      rank,
      flagged: isFlagged,
      correctAnswers: cards.map(c => ({ position: c.position, correctAnswer: c.correctAnswer })),
      pointsCredited,
    };
  }

  private async checkPerfectStreak(userId: string): Promise<number> {
    const recentEntries = await db.execute(sql`
      SELECT dce.correct_count, dc.date
      FROM daily_challenge_entries dce
      JOIN daily_challenges dc ON dc.id = dce.daily_challenge_id
      WHERE dce.user_id = ${userId}
        AND dce.completed_at IS NOT NULL
      ORDER BY dc.date DESC
      LIMIT ${DAILY5_PERFECT_STREAK_THRESHOLD + 1}
    `);

    let streak = 0;
    for (const row of recentEntries.rows as any[]) {
      if (row.correct_count === 5) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  private async isNewAccount(userId: string): Promise<boolean> {
    const [user] = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.createdAt) return false;
    const accountAge = Date.now() - new Date(user.createdAt).getTime();
    return accountAge < DAILY5_NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000;
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
        AND (dce.flagged IS NULL OR dce.flagged = false)
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

  async getAdminStats(): Promise<{
    todayParticipants: number;
    todayFlagged: number;
    flaggedEntries: {
      userId: string;
      username: string;
      date: string;
      score: number;
      correctCount: number;
      timeMs: number | null;
      flagReason: string | null;
    }[];
    perfectStreaks: {
      userId: string;
      username: string;
      streak: number;
    }[];
    fastestCompletions: {
      userId: string;
      username: string;
      date: string;
      timeMs: number;
      correctCount: number;
    }[];
  }> {
    const today = getTodayDateString();

    const [todayChallenge] = await db
      .select()
      .from(dailyChallenges)
      .where(eq(dailyChallenges.date, today))
      .limit(1);

    let todayParticipants = 0;
    let todayFlagged = 0;

    if (todayChallenge) {
      const [pCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(dailyChallengeEntries)
        .where(and(
          eq(dailyChallengeEntries.dailyChallengeId, todayChallenge.id),
          isNotNull(dailyChallengeEntries.completedAt)
        ));
      todayParticipants = pCount?.count || 0;

      const [fCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(dailyChallengeEntries)
        .where(and(
          eq(dailyChallengeEntries.dailyChallengeId, todayChallenge.id),
          eq(dailyChallengeEntries.flagged, true)
        ));
      todayFlagged = fCount?.count || 0;
    }

    const flaggedRows = await db.execute(sql`
      SELECT dce.user_id, u.username, dc.date, dce.score, dce.correct_count, dce.time_ms, dce.flag_reason
      FROM daily_challenge_entries dce
      JOIN users u ON u.id = dce.user_id
      JOIN daily_challenges dc ON dc.id = dce.daily_challenge_id
      WHERE dce.flagged = true
      ORDER BY dc.date DESC
      LIMIT 50
    `);

    const fastRows = await db.execute(sql`
      SELECT dce.user_id, u.username, dc.date, dce.time_ms, dce.correct_count
      FROM daily_challenge_entries dce
      JOIN users u ON u.id = dce.user_id
      JOIN daily_challenges dc ON dc.id = dce.daily_challenge_id
      WHERE dce.completed_at IS NOT NULL AND dce.time_ms IS NOT NULL
      ORDER BY dce.time_ms ASC
      LIMIT 20
    `);

    const streakRows = await db.execute(sql`
      WITH user_streaks AS (
        SELECT dce.user_id, u.username, dc.date, dce.correct_count,
          ROW_NUMBER() OVER (PARTITION BY dce.user_id ORDER BY dc.date DESC) as rn
        FROM daily_challenge_entries dce
        JOIN users u ON u.id = dce.user_id
        JOIN daily_challenges dc ON dc.id = dce.daily_challenge_id
        WHERE dce.completed_at IS NOT NULL
      ),
      streak_calc AS (
        SELECT user_id, username,
          COUNT(*) FILTER (WHERE correct_count = 5 AND rn <= 10) as recent_perfects
        FROM user_streaks
        GROUP BY user_id, username
        HAVING COUNT(*) FILTER (WHERE correct_count = 5 AND rn <= 10) >= 2
      )
      SELECT user_id, username, recent_perfects as streak
      FROM streak_calc
      ORDER BY streak DESC
      LIMIT 20
    `);

    return {
      todayParticipants,
      todayFlagged,
      flaggedEntries: (flaggedRows.rows as any[]).map(r => ({
        userId: r.user_id,
        username: r.username || "Anonymous",
        date: r.date,
        score: r.score,
        correctCount: r.correct_count,
        timeMs: r.time_ms,
        flagReason: r.flag_reason,
      })),
      perfectStreaks: (streakRows.rows as any[]).map(r => ({
        userId: r.user_id,
        username: r.username || "Anonymous",
        streak: Number(r.streak),
      })),
      fastestCompletions: (fastRows.rows as any[]).map(r => ({
        userId: r.user_id,
        username: r.username || "Anonymous",
        date: r.date,
        timeMs: r.time_ms,
        correctCount: r.correct_count,
      })),
    };
  }
}

export const daily5Service = new Daily5Service();
