import type { GameQuestion, GameSession, ClientGameQuestion, ClientGameSession } from "@shared/schema";
import { maskedPlayPath, revealPlayPath, type PlayScope } from "../services/playImageToken";
import { readWarmMaskPlan } from "../masking/maskPlanStore";

export type QuestionImageContext = {
  scope: PlayScope;
  sessionId: string;
  index: number;
};

function dealtCardId(card: GameQuestion["card"]): string {
  return card.playableCardId || card.id;
}

/**
 * Wire shape for a question still being guessed.
 * No raw card id, printed name, card number, team, or year+set pair.
 * A reveal URL is attached only after that question's answer was accepted.
 */
export function sanitizeQuestionForClient(q: GameQuestion, ctx: QuestionImageContext): ClientGameQuestion {
  const cardId = dealtCardId(q.card);
  const answered = (q as { answered?: boolean }).answered === true;
  const maskScope: PlayScope = ctx.scope === "ad5" ? "d5" : ctx.scope;
  const card: ClientGameQuestion["card"] = {
    imageUrl: maskedPlayPath({
      scope: maskScope,
      sessionId: ctx.sessionId,
      index: ctx.index,
      cardId,
    }),
    imageRotation: q.card.imageRotation ?? 0,
    gameSetId: q.card.gameSetId,
    maskPlan: readWarmMaskPlan(cardId),
  };
  if (answered && ctx.scope !== "match") {
    card.revealUrl = revealPlayPath({
      scope: ctx.scope,
      sessionId: ctx.sessionId,
      index: ctx.index,
      cardId,
      binder: ctx.sessionId,
    });
  }
  return {
    options: q.options,
    pointValue: q.pointValue,
    ...(answered ? { answered: true } : {}),
    card,
  };
}

export function sanitizeSessionForClient(session: GameSession): ClientGameSession {
  return {
    ...session,
    questions: session.questions.map((question, index) =>
      sanitizeQuestionForClient(question, { scope: "solo", sessionId: session.id, index }),
    ),
  };
}
