import { db } from "../../db";
import {
  matches,
  matchParticipants,
  matchAnswers,
  matchEvents,
  matchQuestions,
  baseballCards,
  MatchStatus,
  MatchResult,
  type Match,
  type MatchParticipant,
  type MatchState,
  type GameQuestion,
  type MatchStatusType,
  type MatchResultType,
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { computeAndPersistMatchResult, setForfeitResult, setDisconnectResult, type ComputedResult } from "./computeResult";
import { applyProgressForMatchIfNeeded } from "../progress/dailyProgress";

export interface MatchEndResult {
  matchId: string;
  reason: string;
  status: MatchStatusType;
  winner?: string;
  winnerUserId?: string;
  result?: MatchResultType;
  hostCorrect?: number;
  guestCorrect?: number;
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

  const winnerParticipant = match.winnerUserId 
    ? participantStates.find(p => p.userId === match.winnerUserId) 
    : undefined;

  return {
    matchId: match.id,
    lobbyId: match.lobbyId,
    status: match.status as MatchStatusType,
    currentQuestionIndex: currentIdx,
    totalQuestions: match.totalQuestions,
    questions,
    gameSetId: match.cardSetId || undefined,
    participants: participantStates,
    winner: winnerParticipant?.username,
    endReason: match.endReason || undefined,
    result: match.result as MatchResultType | undefined,
    winnerUserId: match.winnerUserId || undefined,
    hostCorrect: match.hostCorrect,
    guestCorrect: match.guestCorrect,
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

export interface AnswerStatusInfo {
  answeredCount: number;
  required: number;
}

export async function submitAnswer(
  matchId: string,
  userId: string,
  idx: number,
  selected: string,
  clientMsgId?: string
): Promise<SubmitResult & { answerStatus?: AnswerStatusInfo }> {
  // Use a transaction with FOR UPDATE to prevent race conditions
  return await db.transaction(async (tx) => {
    // 1) Load match with FOR UPDATE lock
    const [match] = await tx
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .for("update")
      .limit(1);
    
    if (!match) {
      return { status: "REJECTED" as const, reason: "match_not_found" };
    }

    const status = match.status as MatchStatusType;
    const currentIdx = match.currentQuestionIndex;

    // 2) Validate match status
    if (status === MatchStatus.CANCELLED) {
      return { status: "REJECTED" as const, reason: "match_cancelled", serverIndex: currentIdx, serverStatus: status };
    }
    if (status === MatchStatus.FINISHED) {
      return { status: "REJECTED" as const, reason: "match_finished", serverIndex: currentIdx, serverStatus: status };
    }
    if (status === MatchStatus.LOBBY) {
      return { status: "REJECTED" as const, reason: "match_not_started", serverIndex: currentIdx, serverStatus: status };
    }

    if (status === MatchStatus.INITIALIZING) {
      if (idx !== 0 || currentIdx !== 0) {
        return { status: "REJECTED" as const, reason: "match_initializing", serverIndex: currentIdx, serverStatus: status };
      }
    }

    // 3) Validate idx matches current question
    if (status === MatchStatus.ACTIVE || status === MatchStatus.INITIALIZING) {
      if (idx !== currentIdx) {
        return { status: "REJECTED" as const, reason: "stale_index", serverIndex: currentIdx, serverStatus: status };
      }
    }

    // 4) Authorize participant
    const participants = await tx.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId));
    const participant = participants.find(p => p.userId === userId);
    if (!participant) {
      return { status: "REJECTED" as const, reason: "not_participant" };
    }

    // 5) Parse questions
    let questions: GameQuestion[] = [];
    try {
      questions = JSON.parse(match.questionsData);
    } catch (e) {
      await tx.update(matches).set({
        status: MatchStatus.CANCELLED,
        finishedAt: new Date(),
        endReason: "server_error",
        endDetail: { reason: "invalid_questions_data" },
      }).where(eq(matches.id, matchId));
      return { status: "REJECTED" as const, reason: "server_error" };
    }

    if (idx >= questions.length) {
      return { status: "REJECTED" as const, reason: "invalid_question_index", serverIndex: currentIdx, serverStatus: status };
    }

    const question = questions[idx];
    const isCorrect = selected === question.correctAnswer;
    const pointsEarned = isCorrect ? question.pointValue : 0;

    // 6) Idempotent upsert - check for existing answer first
    const [existingAnswer] = await tx.select().from(matchAnswers).where(
      and(
        eq(matchAnswers.matchId, matchId),
        eq(matchAnswers.userId, userId),
        eq(matchAnswers.idx, idx)
      )
    );

    let isIdempotent = false;
    let actualIsCorrect = isCorrect;
    let actualPointsEarned = pointsEarned;

    if (existingAnswer) {
      // Already answered - this is idempotent success
      isIdempotent = true;
      actualIsCorrect = existingAnswer.isCorrect;
      actualPointsEarned = existingAnswer.pointsEarned;
    } else {
      // Try to insert - handle unique constraint violation gracefully
      try {
        await tx.insert(matchAnswers).values({
          matchId,
          userId,
          idx,
          selected,
          isCorrect,
          pointsEarned,
          clientMsgId: clientMsgId || null,
        });

        // Update participant score
        await tx.update(matchParticipants).set({
          score: sql`${matchParticipants.score} + ${pointsEarned}`,
          correctAnswers: isCorrect ? sql`${matchParticipants.correctAnswers} + 1` : matchParticipants.correctAnswers,
          currentQuestionIndex: idx,
        }).where(
          and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.userId, userId))
        );
      } catch (error: any) {
        if (error.code === "23505") {
          // Unique constraint violation - treat as idempotent success
          isIdempotent = true;
        } else {
          throw error;
        }
      }
    }

    // 7) Count answers for this idx (within transaction)
    const allAnswers = await tx.select().from(matchAnswers).where(
      and(eq(matchAnswers.matchId, matchId), eq(matchAnswers.idx, idx))
    );
    const answeredCount = allAnswers.length;
    const required = participants.length;
    const bothAnswered = answeredCount >= required;

    // Log the submit event
    await tx.insert(matchEvents).values({
      matchId,
      type: "SUBMIT",
      payload: { userId, idx, selected, isCorrect: actualIsCorrect, pointsEarned: actualPointsEarned, idempotent: isIdempotent, answeredCount },
      actorUserId: userId,
    });

    // 8) If both answered, attempt advance (atomic compare-and-swap)
    let advance: AdvanceResult | undefined;
    if (bothAnswered) {
      // Atomic advance: only succeed if currentQuestionIndex still equals idx
      const newIndex = idx + 1;
      const totalQuestions = questions.length;

      const updateResult = await tx.update(matches)
        .set({ currentQuestionIndex: newIndex })
        .where(and(eq(matches.id, matchId), eq(matches.currentQuestionIndex, idx)));

      const rowsAffected = (updateResult as any).rowCount ?? (updateResult as any).changes ?? 0;
      
      if (rowsAffected > 0) {
        // We are the advancer!
        await tx.insert(matchEvents).values({
          matchId,
          type: "ADVANCE",
          payload: { from: idx, to: newIndex, advancedBy: userId },
          actorUserId: userId,
        });

        if (newIndex >= totalQuestions) {
          // Match finished - update status
          await tx.update(matches).set({
            status: MatchStatus.FINISHED,
            finishedAt: new Date(),
            endReason: "completed",
          }).where(eq(matches.id, matchId));

          // Compute result will be done after transaction commits
          advance = { newIndex, finished: true, matchEnd: undefined };
        } else {
          // Next question
          const nextQuestion = questions[newIndex];
          advance = {
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
      } else {
        // Someone else already advanced - this is fine, just return status
        await tx.insert(matchEvents).values({
          matchId,
          type: "ADVANCE_SKIPPED",
          payload: { reason: "concurrent_advance", expectedIdx: idx, userId },
          actorUserId: userId,
        });
      }
    }

    return {
      status: "ACCEPTED" as const,
      idempotent: isIdempotent,
      correct: actualIsCorrect,
      correctAnswer: question.correctAnswer,
      pointsEarned: actualPointsEarned,
      advance,
      answerStatus: { answeredCount, required },
    };
  });
}

// Post-transaction completion handler for match finish
export async function completeMatchFinish(matchId: string, participants: MatchParticipant[], totalQuestions: number): Promise<MatchEndResult | undefined> {
  const computed = await computeAndPersistMatchResult(matchId);
  const updatedParticipants = await getParticipants(matchId);
  
  const hostParticipant = updatedParticipants.find(p => p.role === "HOST");
  const guestParticipant = updatedParticipants.find(p => p.role === "GUEST");
  
  console.log(`[MatchFinish] matchId=${matchId}, computed=${JSON.stringify(computed)}, hostParticipant=${hostParticipant?.userId}, guestParticipant=${guestParticipant?.userId}`);
  
  if (hostParticipant && guestParticipant) {
    await applyProgressForMatchIfNeeded({
      matchId,
      hostUserId: hostParticipant.userId,
      guestUserId: guestParticipant.userId,
      totalQuestions,
    });
  }
  
  // Use computed result if available, otherwise calculate from participant data as fallback
  let result = computed?.result;
  let winnerUserId = computed?.winnerUserId ?? null;
  let hostCorrect = computed?.hostCorrect ?? (hostParticipant?.correctAnswers || 0);
  let guestCorrect = computed?.guestCorrect ?? (guestParticipant?.correctAnswers || 0);
  
  // Fallback: If computed result is missing, calculate directly from participants
  if (!result && hostParticipant && guestParticipant) {
    console.log(`[MatchFinish] Fallback calculation: hostCorrect=${hostCorrect}, guestCorrect=${guestCorrect}`);
    if (hostCorrect > guestCorrect) {
      result = MatchResult.HOST_WIN;
      winnerUserId = hostParticipant.userId;
    } else if (guestCorrect > hostCorrect) {
      result = MatchResult.GUEST_WIN;
      winnerUserId = guestParticipant.userId;
    } else {
      result = MatchResult.TIE;
      winnerUserId = null;
    }
    
    // Persist the fallback result
    await db.update(matches).set({
      result,
      winnerUserId,
      hostCorrect,
      guestCorrect,
    }).where(eq(matches.id, matchId));
    
    console.log(`[MatchFinish] Persisted fallback result: result=${result}, winnerUserId=${winnerUserId}`);
  }
  
  const winnerParticipant = winnerUserId 
    ? updatedParticipants.find(p => p.userId === winnerUserId)
    : undefined;
  const winner = winnerParticipant?.username;

  console.log(`[MatchFinish] Final result: result=${result}, winner=${winner}, winnerUserId=${winnerUserId}`);

  await logEvent(matchId, "END", { 
    reason: "completed", 
    winner,
    result,
    hostCorrect,
    guestCorrect,
  });

  return {
    matchId,
    reason: "completed",
    status: MatchStatus.FINISHED,
    winner,
    winnerUserId: winnerUserId ?? undefined,
    result,
    hostCorrect,
    guestCorrect,
    participants: updatedParticipants.map(p => ({
      userId: p.userId,
      username: p.username,
      score: p.score || 0,
      correctAnswers: p.correctAnswers || 0,
    })),
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

  const computed = await setForfeitResult(matchId, forfeitingUserId);

  await logEvent(matchId, "END", { 
    reason: "forfeit", 
    forfeitedBy: forfeitingUserId, 
    winner: winner?.username,
    result: computed?.result,
    hostCorrect: computed?.hostCorrect,
    guestCorrect: computed?.guestCorrect,
  }, forfeitingUserId);

  return {
    matchId,
    reason: "forfeit",
    status: MatchStatus.FINISHED,
    winner: winner?.username,
    winnerUserId: computed?.winnerUserId ?? undefined,
    result: computed?.result,
    hostCorrect: computed?.hostCorrect,
    guestCorrect: computed?.guestCorrect,
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

  const computed = await setDisconnectResult(matchId, disconnectedUserId);

  await logEvent(matchId, "END", { 
    reason: "disconnect_timeout", 
    disconnectedUserId, 
    winner: winner?.username,
    result: computed?.result,
    hostCorrect: computed?.hostCorrect,
    guestCorrect: computed?.guestCorrect,
  });

  return {
    matchId,
    reason: "disconnect_timeout",
    status: MatchStatus.CANCELLED,
    winner: winner?.username,
    winnerUserId: computed?.winnerUserId ?? undefined,
    result: computed?.result,
    hostCorrect: computed?.hostCorrect,
    guestCorrect: computed?.guestCorrect,
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

export async function getMatchAnswers(matchId: string, idx?: number): Promise<any[]> {
  if (idx !== undefined) {
    return await db.select().from(matchAnswers).where(
      and(eq(matchAnswers.matchId, matchId), eq(matchAnswers.idx, idx))
    ).orderBy(matchAnswers.answeredAt);
  }
  return await db.select().from(matchAnswers).where(eq(matchAnswers.matchId, matchId)).orderBy(matchAnswers.idx, matchAnswers.answeredAt);
}
