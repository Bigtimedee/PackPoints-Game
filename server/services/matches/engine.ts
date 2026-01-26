import { db } from "../../db";
import {
  matches,
  matchParticipants,
  matchAnswers,
  matchEvents,
  matchQuestions,
  baseballCards,
  MatchStatus,
  type Match,
  type MatchParticipant,
  type MatchState,
  type GameQuestion,
  type MatchStatusType,
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";

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

export type SubmitResult =
  | { status: "ACCEPTED"; idempotent?: boolean; correct: boolean; correctAnswer: string; pointsEarned: number; advance?: AdvanceResult }
  | { status: "REJECTED"; reason: string; serverIndex?: number; serverStatus?: string };

export interface AdvanceResult {
  newIndex: number;
  finished: boolean;
  matchEnd?: MatchEndResult;
  nextQuestion?: { idx: number; card: any; choices: string[]; pointValue: number };
}

const ALLOWED_CANCEL_REASONS = ["no_ack", "disconnect_timeout", "forfeit", "deck_empty", "admin_cancel", "server_error"];

async function logEvent(matchId: string, type: string, payload: object, actorUserId?: string) {
  try {
    await db.insert(matchEvents).values({
      matchId,
      type,
      payload,
      actorUserId: actorUserId || null,
    });
  } catch (e) {
    console.error(`[MatchEngine] Failed to log event: matchId=${matchId}, type=${type}`, e);
  }
}

async function assertInvariants(match: Match, context: string): Promise<boolean> {
  const status = match.status as MatchStatusType;
  const currentIndex = match.currentQuestionIndex;
  const totalQuestions = match.totalQuestions;

  if (currentIndex < 0 || currentIndex > totalQuestions) {
    await logEvent(match.id, "ERROR", {
      context,
      invariant: "index_bounds",
      message: `currentIndex ${currentIndex} out of bounds [0, ${totalQuestions}]`,
    });
    return false;
  }

  if (status === MatchStatus.FINISHED) {
    if (match.endReason !== "completed" && match.endReason !== "forfeit") {
      await logEvent(match.id, "ERROR", {
        context,
        invariant: "finish_condition",
        message: `FINISHED status but endReason is '${match.endReason}', expected 'completed' or 'forfeit'`,
      });
      return false;
    }
    if (match.endReason === "completed" && currentIndex < totalQuestions) {
      await logEvent(match.id, "ERROR", {
        context,
        invariant: "finish_condition",
        message: `FINISHED with completed but currentIndex=${currentIndex} < totalQuestions=${totalQuestions}`,
      });
      return false;
    }
  }

  if (status === MatchStatus.CANCELLED) {
    if (!match.endReason || !ALLOWED_CANCEL_REASONS.includes(match.endReason)) {
      await logEvent(match.id, "ERROR", {
        context,
        invariant: "cancel_condition",
        message: `CANCELLED status but endReason '${match.endReason}' not in allowed reasons`,
      });
      return false;
    }
  }

  return true;
}

async function cancelMatchWithError(matchId: string, reason: string, detail?: object) {
  await db.update(matches).set({
    status: MatchStatus.CANCELLED,
    finishedAt: new Date(),
    endReason: reason,
    endDetail: detail || null,
  }).where(eq(matches.id, matchId));
  await logEvent(matchId, "END", { reason, detail });
}

export async function getMatchFromDb(matchId: string): Promise<Match | undefined> {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  return match;
}

export async function getParticipants(matchId: string): Promise<MatchParticipant[]> {
  return await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId));
}

export async function buildMatchState(matchId: string): Promise<MatchState | undefined> {
  const match = await getMatchFromDb(matchId);
  if (!match) return undefined;

  const participants = await getParticipants(matchId);
  if (participants.length === 0) return undefined;

  let questions: GameQuestion[] = [];
  try {
    questions = match.questionsData ? JSON.parse(match.questionsData) : [];
  } catch (e) {
    console.error(`[MatchEngine] Failed to parse questionsData for match ${matchId}`);
    return undefined;
  }

  const answers = await db.select().from(matchAnswers).where(eq(matchAnswers.matchId, matchId));
  const currentIdx = match.currentQuestionIndex;

  const participantStates = participants.map(p => {
    const pAnswers = answers.filter(a => a.userId === p.userId);
    const hasAnsweredCurrent = pAnswers.some(a => a.idx === currentIdx);
    return {
      userId: p.userId,
      username: p.username,
      score: p.score || 0,
      correctAnswers: p.correctAnswers || 0,
      currentQuestionIndex: p.currentQuestionIndex || 0,
      hasAnsweredCurrent,
    };
  });

  return {
    matchId: match.id,
    lobbyId: match.lobbyId,
    status: match.status as MatchStatusType,
    currentQuestionIndex: currentIdx,
    totalQuestions: match.totalQuestions,
    questions,
    participants: participantStates,
    endReason: match.endReason || undefined,
  };
}

export async function initMatch(
  matchId: string,
  hostId: string,
  guestId: string,
  hostUsername: string,
  guestUsername: string,
  questions: GameQuestion[]
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatchFromDb(matchId);
  if (!match) return { success: false, error: "match_not_found" };
  if (match.status !== MatchStatus.LOBBY) {
    return { success: false, error: "match_already_initialized" };
  }
  if (questions.length < match.totalQuestions) {
    return { success: false, error: "insufficient_questions" };
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(matches).set({
        status: MatchStatus.INITIALIZING,
        currentQuestionIndex: 0,
        questionsData: JSON.stringify(questions),
        startedAt: null,
        finishedAt: null,
        endReason: null,
        hostUserId: hostId,
        guestUserId: guestId,
      }).where(eq(matches.id, matchId));

      await tx.update(matchParticipants).set({ ackedAt: null }).where(eq(matchParticipants.matchId, matchId));
    });

    await logEvent(matchId, "INIT", {
      questionsCount: questions.length,
      hostId,
      guestId,
    });

    return { success: true };
  } catch (e) {
    console.error(`[MatchEngine] initMatch failed for ${matchId}:`, e);
    return { success: false, error: "transaction_failed" };
  }
}

export async function ackMatch(matchId: string, userId: string): Promise<{ success: boolean; bothAcked?: boolean; error?: string }> {
  const match = await getMatchFromDb(matchId);
  if (!match) return { success: false, error: "match_not_found" };

  if (match.status === MatchStatus.ACTIVE) {
    return { success: true, bothAcked: true };
  }
  if (match.status !== MatchStatus.INITIALIZING) {
    return { success: false, error: "invalid_status" };
  }

  await db.update(matchParticipants).set({ ackedAt: new Date() }).where(
    and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.userId, userId))
  );

  await logEvent(matchId, "ACK", { userId }, userId);

  const participants = await getParticipants(matchId);
  const allAcked = participants.every(p => p.ackedAt !== null);

  if (allAcked) {
    await db.update(matches).set({
      status: MatchStatus.ACTIVE,
      startedAt: new Date(),
    }).where(eq(matches.id, matchId));

    await logEvent(matchId, "ADVANCE", { from: "INITIALIZING", to: "ACTIVE", reason: "both_acked" });
    return { success: true, bothAcked: true };
  }

  return { success: true, bothAcked: false };
}

export async function submitAnswer(
  matchId: string,
  userId: string,
  idx: number,
  selected: string,
  clientMsgId?: string
): Promise<SubmitResult> {
  const match = await getMatchFromDb(matchId);
  if (!match) {
    return { status: "REJECTED", reason: "match_not_found" };
  }

  const status = match.status as MatchStatusType;
  const currentIdx = match.currentQuestionIndex;

  if (status === MatchStatus.CANCELLED) {
    return { status: "REJECTED", reason: "match_cancelled", serverIndex: currentIdx, serverStatus: status };
  }
  if (status === MatchStatus.FINISHED) {
    return { status: "REJECTED", reason: "match_finished", serverIndex: currentIdx, serverStatus: status };
  }
  if (status === MatchStatus.LOBBY) {
    return { status: "REJECTED", reason: "match_not_started", serverIndex: currentIdx, serverStatus: status };
  }

  if (status === MatchStatus.INITIALIZING) {
    if (idx !== 0 || currentIdx !== 0) {
      return { status: "REJECTED", reason: "match_initializing", serverIndex: currentIdx, serverStatus: status };
    }
  }

  if (status === MatchStatus.ACTIVE || status === MatchStatus.INITIALIZING) {
    if (idx !== currentIdx) {
      return { status: "REJECTED", reason: "stale_index", serverIndex: currentIdx, serverStatus: status };
    }
  }

  const participants = await getParticipants(matchId);
  const participant = participants.find(p => p.userId === userId);
  if (!participant) {
    return { status: "REJECTED", reason: "not_participant" };
  }

  let questions: GameQuestion[] = [];
  try {
    questions = JSON.parse(match.questionsData);
  } catch (e) {
    await cancelMatchWithError(matchId, "server_error", { reason: "invalid_questions_data" });
    return { status: "REJECTED", reason: "server_error" };
  }

  if (idx >= questions.length) {
    return { status: "REJECTED", reason: "invalid_question_index", serverIndex: currentIdx, serverStatus: status };
  }

  const question = questions[idx];
  const isCorrect = selected === question.correctAnswer;
  const pointsEarned = isCorrect ? question.pointValue : 0;

  const [existingAnswer] = await db.select().from(matchAnswers).where(
    and(
      eq(matchAnswers.matchId, matchId),
      eq(matchAnswers.userId, userId),
      eq(matchAnswers.idx, idx)
    )
  );

  if (existingAnswer) {
    await logEvent(matchId, "SUBMIT", { userId, idx, idempotent: true }, userId);
    const answers = await db.select().from(matchAnswers).where(
      and(eq(matchAnswers.matchId, matchId), eq(matchAnswers.idx, idx))
    );
    const bothAnswered = answers.length >= 2;

    let advance: AdvanceResult | undefined;
    if (bothAnswered) {
      advance = await maybeAdvance(matchId, idx, questions, participants);
    }

    return {
      status: "ACCEPTED",
      idempotent: true,
      correct: existingAnswer.isCorrect,
      correctAnswer: question.correctAnswer,
      pointsEarned: existingAnswer.pointsEarned,
      advance,
    };
  }

  try {
    await db.insert(matchAnswers).values({
      matchId,
      userId,
      idx,
      selected,
      isCorrect,
      pointsEarned,
      clientMsgId: clientMsgId || null,
    });
  } catch (error: any) {
    if (error.code === "23505") {
      return {
        status: "ACCEPTED",
        idempotent: true,
        correct: isCorrect,
        correctAnswer: question.correctAnswer,
        pointsEarned,
      };
    }
    throw error;
  }

  await db.update(matchParticipants).set({
    score: sql`${matchParticipants.score} + ${pointsEarned}`,
    correctAnswers: isCorrect ? sql`${matchParticipants.correctAnswers} + 1` : matchParticipants.correctAnswers,
    currentQuestionIndex: idx,
  }).where(
    and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.userId, userId))
  );

  await logEvent(matchId, "SUBMIT", { userId, idx, selected, isCorrect, pointsEarned }, userId);

  const allAnswers = await db.select().from(matchAnswers).where(
    and(eq(matchAnswers.matchId, matchId), eq(matchAnswers.idx, idx))
  );
  const bothAnswered = allAnswers.length >= participants.length;

  let advance: AdvanceResult | undefined;
  if (bothAnswered) {
    advance = await maybeAdvance(matchId, idx, questions, participants);
  }

  return {
    status: "ACCEPTED",
    correct: isCorrect,
    correctAnswer: question.correctAnswer,
    pointsEarned,
    advance,
  };
}

async function maybeAdvance(
  matchId: string,
  currentIdx: number,
  questions: GameQuestion[],
  participants: MatchParticipant[]
): Promise<AdvanceResult> {
  const newIndex = currentIdx + 1;
  const totalQuestions = questions.length;

  await db.update(matches).set({ currentQuestionIndex: newIndex }).where(eq(matches.id, matchId));
  await logEvent(matchId, "ADVANCE", { from: currentIdx, to: newIndex });

  if (newIndex >= totalQuestions) {
    const updatedParticipants = await getParticipants(matchId);
    const sorted = [...updatedParticipants].sort((a, b) => (b.score || 0) - (a.score || 0));
    const winner = sorted.length >= 2 && sorted[0].score !== sorted[1].score ? sorted[0].username : undefined;

    await db.update(matches).set({
      status: MatchStatus.FINISHED,
      finishedAt: new Date(),
      endReason: "completed",
    }).where(eq(matches.id, matchId));

    await logEvent(matchId, "END", { reason: "completed", winner });

    const matchEnd: MatchEndResult = {
      matchId,
      reason: "completed",
      status: MatchStatus.FINISHED,
      winner,
      participants: updatedParticipants.map(p => ({
        userId: p.userId,
        username: p.username,
        score: p.score || 0,
        correctAnswers: p.correctAnswers || 0,
      })),
    };

    return { newIndex, finished: true, matchEnd };
  }

  const nextQuestion = questions[newIndex];
  return {
    newIndex,
    finished: false,
    nextQuestion: {
      idx: newIndex,
      card: nextQuestion.card,
      choices: nextQuestion.options,
      pointValue: nextQuestion.pointValue,
    },
  };
}

export async function resync(matchId: string, userId: string): Promise<MatchState | undefined> {
  const matchState = await buildMatchState(matchId);
  if (!matchState) return undefined;

  const isParticipant = matchState.participants.some(p => p.userId === userId);
  if (!isParticipant) return undefined;

  await logEvent(matchId, "RESYNC", { userId }, userId);
  return matchState;
}

export async function markDisconnected(matchId: string, userId: string) {
  await db.update(matchParticipants).set({
    isConnected: false,
    lastSeenAt: new Date(),
  }).where(
    and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.userId, userId))
  );
}

export async function markConnected(matchId: string, userId: string) {
  await db.update(matchParticipants).set({
    isConnected: true,
    lastSeenAt: new Date(),
  }).where(
    and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.userId, userId))
  );
}

export async function updateHeartbeat(matchId: string, userId: string) {
  await db.update(matchParticipants).set({
    lastSeenAt: new Date(),
  }).where(
    and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.userId, userId))
  );
}

export async function forfeitMatch(matchId: string, forfeitingUserId: string): Promise<MatchEndResult | undefined> {
  const match = await getMatchFromDb(matchId);
  if (!match) return undefined;

  if (match.status !== MatchStatus.ACTIVE && match.status !== MatchStatus.INITIALIZING) {
    return undefined;
  }

  const participants = await getParticipants(matchId);
  const winner = participants.find(p => p.userId !== forfeitingUserId);

  await db.update(matches).set({
    status: MatchStatus.FINISHED,
    finishedAt: new Date(),
    endReason: "forfeit",
    endDetail: { forfeitedBy: forfeitingUserId },
  }).where(eq(matches.id, matchId));

  await logEvent(matchId, "END", { reason: "forfeit", forfeitedBy: forfeitingUserId, winner: winner?.username }, forfeitingUserId);

  return {
    matchId,
    reason: "forfeit",
    status: MatchStatus.FINISHED,
    winner: winner?.username,
    participants: participants.map(p => ({
      userId: p.userId,
      username: p.username,
      score: p.score || 0,
      correctAnswers: p.correctAnswers || 0,
    })),
  };
}

export async function cancelMatchForDisconnect(matchId: string, disconnectedUserId: string): Promise<MatchEndResult | undefined> {
  const match = await getMatchFromDb(matchId);
  if (!match) return undefined;

  if (match.status !== MatchStatus.ACTIVE) {
    return undefined;
  }

  const participants = await getParticipants(matchId);
  const winner = participants.find(p => p.userId !== disconnectedUserId);

  await db.update(matches).set({
    status: MatchStatus.CANCELLED,
    finishedAt: new Date(),
    endReason: "disconnect_timeout",
    endDetail: { disconnectedUserId },
  }).where(eq(matches.id, matchId));

  await logEvent(matchId, "END", { reason: "disconnect_timeout", disconnectedUserId, winner: winner?.username });

  return {
    matchId,
    reason: "disconnect_timeout",
    status: MatchStatus.CANCELLED,
    winner: winner?.username,
    participants: participants.map(p => ({
      userId: p.userId,
      username: p.username,
      score: p.score || 0,
      correctAnswers: p.correctAnswers || 0,
    })),
  };
}

export async function cancelMatchForNoAck(matchId: string): Promise<MatchEndResult | undefined> {
  const match = await getMatchFromDb(matchId);
  if (!match) return undefined;

  if (match.status !== MatchStatus.INITIALIZING) {
    return undefined;
  }
  if (match.startedAt) {
    return undefined;
  }

  const participants = await getParticipants(matchId);

  await db.update(matches).set({
    status: MatchStatus.CANCELLED,
    finishedAt: new Date(),
    endReason: "no_ack",
  }).where(eq(matches.id, matchId));

  await logEvent(matchId, "END", { reason: "no_ack" });

  return {
    matchId,
    reason: "no_ack",
    status: MatchStatus.CANCELLED,
    participants: participants.map(p => ({
      userId: p.userId,
      username: p.username,
      score: p.score || 0,
      correctAnswers: p.correctAnswers || 0,
    })),
  };
}

export async function getMatchEvents(matchId: string, limit: number = 200): Promise<any[]> {
  return await db.select().from(matchEvents).where(eq(matchEvents.matchId, matchId)).orderBy(matchEvents.ts).limit(limit);
}
