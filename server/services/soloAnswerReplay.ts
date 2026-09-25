/**
 * A second POST for the same solo question returns the stored result.
 * It must not award points again.
 */
export interface StoredSoloQuestion {
  answered?: boolean;
  userAnswer?: string | null;
  correctAnswer?: string;
  pointValue?: number;
  pointsEarned?: number;
  card?: { id?: string; playableCardId?: string | null } | null;
}

export function soloAnswerAlreadyRecorded(question: StoredSoloQuestion | null | undefined): boolean {
  if (!question) return false;
  if (question.answered === true) return true;
  return typeof question.userAnswer === "string" && question.userAnswer.length > 0;
}

export function replaySoloAnswer(question: StoredSoloQuestion): {
  correct: boolean;
  correctAnswer: string;
  pointsEarned: number;
  cardId: string | null;
} {
  const correctAnswer = typeof question.correctAnswer === "string" ? question.correctAnswer : "";
  const userAnswer = typeof question.userAnswer === "string" ? question.userAnswer : "";
  const correct = userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase() && correctAnswer.length > 0;
  const pointsEarned = typeof question.pointsEarned === "number" ? question.pointsEarned : 0;
  const cardId = question.card?.playableCardId || question.card?.id || null;
  return { correct, correctAnswer, pointsEarned, cardId };
}
