import { db } from "../../db";
import { matches, matchParticipants, matchQuestions, lobbies, MatchStatus, type Match, type MatchState, type MatchStatusType } from "@shared/schema";
import { eq, and, count } from "drizzle-orm";

export interface MatchEndResult {
  matchId: string;
  reason: string;
  status: MatchStatusType;
  winner?: string;
  participants: {
    userId: string;
    username: string;
    score: number;
    correctAnswers: number;
  }[];
}

export async function assertCanActivate(matchId: string): Promise<{ valid: boolean; error?: string }> {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) {
    return { valid: false, error: "Match not found" };
  }
  
  if (match.status !== MatchStatus.INITIALIZING) {
    return { valid: false, error: `Match status must be INITIALIZING, got ${match.status}` };
  }
  
  if (match.currentQuestionIndex !== 0) {
    return { valid: false, error: `Match currentQuestionIndex must be 0, got ${match.currentQuestionIndex}` };
  }
  
  const questionsCountResult = await db
    .select({ count: count() })
    .from(matchQuestions)
    .where(eq(matchQuestions.matchId, matchId));
  
  const questionsCount = questionsCountResult[0]?.count || 0;
  if (questionsCount < match.totalQuestions) {
    return { valid: false, error: `Match needs ${match.totalQuestions} questions, but only has ${questionsCount}` };
  }
  
  return { valid: true };
}

export async function maybeFinish(matchState: MatchState): Promise<MatchEndResult | null> {
  if (matchState.currentQuestionIndex < matchState.totalQuestions) {
    return null;
  }
  
  matchState.status = MatchStatus.FINISHED;
  matchState.endReason = "completed";
  
  const winner = determineWinner(matchState);
  matchState.winner = winner;
  
  await db.update(matches).set({ 
    status: MatchStatus.FINISHED, 
    finishedAt: new Date(), 
    endReason: "completed" 
  }).where(eq(matches.id, matchState.matchId));
  
  await db.update(lobbies).set({ status: "completed" }).where(eq(lobbies.id, matchState.lobbyId));
  
  console.log(`[StateMachine] Match ${matchState.matchId} FINISHED: winner=${winner}, endReason=completed`);
  
  return {
    matchId: matchState.matchId,
    reason: "completed",
    status: MatchStatus.FINISHED,
    winner,
    participants: matchState.participants.map(p => ({
      userId: p.userId,
      username: p.username,
      score: p.score,
      correctAnswers: p.correctAnswers,
    })),
  };
}

export async function cancelMatch(matchId: string, reason: string, lobbyId?: string): Promise<MatchEndResult | null> {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  
  if (!match) {
    console.error(`[StateMachine] cancelMatch: match ${matchId} not found`);
    return null;
  }
  
  if (match.status === MatchStatus.FINISHED || match.status === MatchStatus.CANCELLED) {
    console.warn(`[StateMachine] cancelMatch: match ${matchId} already ${match.status}`);
    return null;
  }
  
  await db.update(matches).set({
    status: MatchStatus.CANCELLED,
    finishedAt: new Date(),
    endReason: reason,
  }).where(eq(matches.id, matchId));
  
  const actualLobbyId = lobbyId || match.lobbyId;
  if (actualLobbyId) {
    await db.update(lobbies).set({ status: "cancelled" }).where(eq(lobbies.id, actualLobbyId));
  }
  
  const participants = await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId));
  
  console.log(`[StateMachine] Match ${matchId} CANCELLED: reason=${reason}`);
  
  return {
    matchId,
    reason,
    status: MatchStatus.CANCELLED,
    participants: participants.map(p => ({
      userId: p.userId,
      username: p.username,
      score: p.score,
      correctAnswers: p.correctAnswers,
    })),
  };
}

export async function activateMatch(matchId: string): Promise<{ success: boolean; error?: string }> {
  const validation = await assertCanActivate(matchId);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  await db.update(matches).set({
    status: MatchStatus.ACTIVE,
    startedAt: new Date(),
  }).where(eq(matches.id, matchId));
  
  console.log(`[StateMachine] Match ${matchId} ACTIVATED`);
  
  return { success: true };
}

export function canFinishMatch(matchState: MatchState): boolean {
  return matchState.currentQuestionIndex >= matchState.totalQuestions;
}

function determineWinner(matchState: MatchState): string | undefined {
  const sorted = [...matchState.participants].sort((a, b) => b.score - a.score);
  if (sorted.length < 2) return sorted[0]?.username;
  if (sorted[0].score === sorted[1].score) return undefined;
  return sorted[0].username;
}
