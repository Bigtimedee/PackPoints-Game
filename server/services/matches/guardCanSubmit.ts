import { MatchStatus, type MatchState, type MatchStatusType } from "@shared/schema";

export type GuardRejectionReason = 
  | "match_not_found"
  | "not_participant"
  | "match_cancelled"
  | "match_finished"
  | "match_initializing"
  | "match_not_started"
  | "stale_index"
  | "bad_payload";

export interface GuardResult {
  allowed: boolean;
  reason?: GuardRejectionReason;
  serverIndex?: number;
  serverStatus?: MatchStatusType;
}

export function guardCanSubmit(
  matchState: MatchState | undefined,
  userId: string,
  questionIndex: number
): GuardResult {
  if (!matchState) {
    return { allowed: false, reason: "match_not_found" };
  }

  const participant = matchState.participants.find(p => p.userId === userId);
  if (!participant) {
    return { allowed: false, reason: "not_participant" };
  }

  if (matchState.status === MatchStatus.CANCELLED) {
    return { 
      allowed: false, 
      reason: "match_cancelled",
      serverIndex: matchState.currentQuestionIndex,
      serverStatus: matchState.status
    };
  }

  if (matchState.status === MatchStatus.FINISHED) {
    return { 
      allowed: false, 
      reason: "match_finished",
      serverIndex: matchState.currentQuestionIndex,
      serverStatus: matchState.status
    };
  }

  if (matchState.status === MatchStatus.LOBBY) {
    return { 
      allowed: false, 
      reason: "match_not_started",
      serverIndex: matchState.currentQuestionIndex,
      serverStatus: matchState.status
    };
  }

  if (matchState.status === MatchStatus.INITIALIZING) {
    const hasQuestions = matchState.questions && matchState.questions.length > 0;
    const isFirstQuestion = questionIndex === 0 && matchState.currentQuestionIndex === 0;
    
    if (hasQuestions && isFirstQuestion) {
      return { allowed: true };
    }
    
    return { 
      allowed: false, 
      reason: "match_initializing",
      serverIndex: matchState.currentQuestionIndex,
      serverStatus: matchState.status
    };
  }

  if (matchState.status === MatchStatus.ACTIVE) {
    if (questionIndex !== matchState.currentQuestionIndex) {
      return { 
        allowed: false, 
        reason: "stale_index",
        serverIndex: matchState.currentQuestionIndex,
        serverStatus: matchState.status
      };
    }
    return { allowed: true };
  }

  return { 
    allowed: false, 
    reason: "match_not_found",
    serverIndex: matchState.currentQuestionIndex,
    serverStatus: matchState.status
  };
}
