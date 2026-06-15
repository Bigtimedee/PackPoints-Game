import { randomUUID } from "crypto";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { eq, and } from "drizzle-orm";
import { users, lobbies, pvpMatches, matches } from "@shared/schema";
import type { GameQuestion } from "@shared/schema";
import * as matchEngine from "../matches/engine";
import { matchService } from "../matchService";

export const BOT_USER_ID = "packpts-bot-00000000-0000-0000-0000-000000000001";
export const BOT_USERNAME = "PackPTS Bot";
const BOT_DAILY_GAME_CAP = 5; // games per day where reward applies
const BOT_QUEUE_TIMEOUT_S = 60; // seconds before bot fallback triggers

export interface BotMatchResult {
  matchId: string;
  lobbyId: string;
  humanSecret: string;
}

// Accuracy the bot plays at, based on the HUMAN's ELO.
// Higher human ELO → harder bot (higher accuracy).
export function botAccuracyForElo(humanElo: number): number {
  const clampedElo = Math.max(1000, Math.min(2200, humanElo));
  // Linear scale: 1000→55%, 2200→92%
  return 0.55 + ((clampedElo - 1000) / 1200) * 0.37;
}

export async function ensureBotUser(): Promise<void> {
  await db
    .insert(users)
    .values({
      id: BOT_USER_ID,
      username: BOT_USERNAME,
      usernameNormalized: "packpts bot",
      isAdmin: false,
      isBot: true,
      status: "ACTIVE",
    })
    .onConflictDoNothing();
}

export async function getDailyBotGameCount(userId: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM pvp_matches
    WHERE (player1_id = ${userId} OR player2_id = ${userId})
      AND (player1_id = ${BOT_USER_ID} OR player2_id = ${BOT_USER_ID})
      AND created_at >= ${todayStart}
  `);
  return Number((result.rows[0] as any)?.count || 0);
}

// Schedule bot answers for a running match. Bot polls match state and submits
// calibrated answers per question.
export async function scheduleBotAnswers(
  matchId: string,
  botUserId: string,
  accuracy: number,
  totalQuestions: number
): Promise<void> {
  let lastSubmittedIdx = -1;
  let questionsSubmitted = 0;
  let pollAttempts = 0;
  const MAX_POLL_ATTEMPTS = totalQuestions * 60; // 60 polls per question max (1 poll/500ms = 30s per question)

  const poll = async () => {
    if (questionsSubmitted >= totalQuestions || pollAttempts >= MAX_POLL_ATTEMPTS) return;
    pollAttempts++;

    try {
      const matchState = await matchEngine.buildMatchState(matchId);
      if (!matchState) return; // match ended

      const { currentQuestionIndex, questionsData } = matchState as any;
      const currentIdx = typeof currentQuestionIndex === "number" ? currentQuestionIndex : 0;

      if (currentIdx > lastSubmittedIdx && currentIdx < totalQuestions) {
        lastSubmittedIdx = currentIdx;

        let questions: GameQuestion[] = [];
        try {
          questions = JSON.parse(questionsData || "[]");
        } catch {
          return;
        }

        const question = questions[currentIdx];
        if (!question) return;

        // Random thinking delay 1.5–7s
        const delayMs = 1500 + Math.random() * 5500;

        setTimeout(async () => {
          let answer: string;
          if (Math.random() < accuracy) {
            answer = question.correctAnswer;
          } else {
            const wrongOptions = question.options.filter(
              (o) => o.toLowerCase().trim() !== question.correctAnswer.toLowerCase().trim()
            );
            answer = wrongOptions.length > 0
              ? wrongOptions[Math.floor(Math.random() * wrongOptions.length)]
              : question.options[0];
          }

          try {
            await matchEngine.submitAnswer(matchId, botUserId, currentIdx, answer);
            questionsSubmitted++;
          } catch (err) {
            console.error("[Bot] submitAnswer error:", err);
          }
        }, delayMs);
      }
    } catch (err) {
      console.error("[Bot] poll error:", err);
    }

    if (questionsSubmitted < totalQuestions) {
      setTimeout(poll, 500);
    }
  };

  setTimeout(poll, 500);
}

function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = require("crypto").randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) code += chars.charAt(bytes[i] % chars.length);
  return code;
}

function generateSecret(): string {
  return require("crypto").randomBytes(24).toString("hex");
}

export async function createBotMatch(opts: {
  humanUserId: string;
  humanElo: number;
  humanUsername: string;
  gameSetId: string | null;
  totalQuestions: number;
}): Promise<BotMatchResult | null> {
  const { humanUserId, humanElo, humanUsername, gameSetId, totalQuestions } = opts;

  const dailyCount = await getDailyBotGameCount(humanUserId);
  if (dailyCount >= BOT_DAILY_GAME_CAP) {
    console.log(`[Bot] Anti-farm cap reached for user ${humanUserId.substring(0, 8)} (${dailyCount} games today)`);
    return null;
  }

  await ensureBotUser();

  const lobbyId = randomUUID();
  const joinCode = generateJoinCode();
  const humanSecret = generateSecret();
  const botSecret = generateSecret();
  const bucket = gameSetId || "random";

  await db.insert(lobbies).values({
    id: lobbyId,
    joinCode,
    hostId: humanUserId,
    hostUsername: humanUsername,
    hostSecret: humanSecret,
    guestId: BOT_USER_ID,
    guestUsername: BOT_USERNAME,
    guestSecret: botSecret,
    status: "ready",
    mode: "1v1_random",
    totalQuestions,
    gameSetId,
    createdAt: new Date(),
  });

  const result = await matchService.startMatchForRandom(lobbyId);
  if (!result.matchState) {
    console.error("[Bot] Failed to start bot match:", result.error);
    return null;
  }

  const matchId = result.matchState.matchId;

  // Record in pvp_matches
  try {
    await db.execute(sql`
      INSERT INTO pvp_matches (id, mode, bucket, player1_id, player2_id, status, created_at)
      VALUES (${matchId}, '1vRandom'::matchmaking_mode, ${bucket}, ${humanUserId}, ${BOT_USER_ID}, 'ACTIVE'::pvp_match_status, NOW())
    `);
  } catch (err) {
    console.error("[Bot] pvp_matches insert error:", err);
  }

  const accuracy = botAccuracyForElo(humanElo);
  console.log(`[Bot] Created bot match ${matchId} for user ${humanUserId.substring(0, 8)} — bot accuracy ${(accuracy * 100).toFixed(0)}%`);

  scheduleBotAnswers(matchId, BOT_USER_ID, accuracy, totalQuestions);

  return { matchId, lobbyId, humanSecret };
}

export { BOT_QUEUE_TIMEOUT_S };
