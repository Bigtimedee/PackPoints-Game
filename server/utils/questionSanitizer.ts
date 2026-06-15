import type { GameQuestion, GameSession, ClientGameQuestion, ClientGameSession } from '@shared/schema';

export function sanitizeQuestionForClient(q: GameQuestion): ClientGameQuestion {
  const { correctAnswer, card, ...rest } = q;
  const { playerName, ...cardRest } = card;
  return { ...rest, card: cardRest };
}

export function sanitizeSessionForClient(session: GameSession): ClientGameSession {
  return {
    ...session,
    questions: session.questions.map(sanitizeQuestionForClient),
  };
}
