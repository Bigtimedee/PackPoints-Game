/**
 * Daily 5 resume helpers.
 *
 * Positions are 1-indexed (API `daily5AnswerSchema` min 1 / max 5).
 * Status and start both return the existing entry, including `answers`.
 * The play page must rebuild from that entry instead of resetting to card 1.
 */

export const DAILY5_CARD_COUNT = 5;

export type Daily5ResumeAnswer = {
  position: number;
  selected?: string;
  correct?: boolean;
};

export type Daily5ResumeEntry = {
  score?: number | null;
  correctCount?: number | null;
  completedAt?: string | Date | null;
  answers?: Daily5ResumeAnswer[] | null;
};

export type Daily5ResumeState = {
  phase: "playing" | "complete";
  /** 1-indexed next unanswered card. Last card when the entry is complete. */
  currentPosition: number;
  score: number;
  correctCount: number;
  answeredPositions: number[];
};

export function answeredDaily5Positions(
  answers: Daily5ResumeAnswer[] | null | undefined,
): number[] {
  if (!Array.isArray(answers)) return [];
  const seen = new Set<number>();
  for (const answer of answers) {
    const position = answer?.position;
    if (
      typeof position === "number" &&
      Number.isInteger(position) &&
      position >= 1 &&
      position <= DAILY5_CARD_COUNT
    ) {
      seen.add(position);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** First 1-indexed unanswered position, or null when all five are answered. */
export function nextUnansweredDaily5Position(
  answered: Iterable<number>,
  cardCount = DAILY5_CARD_COUNT,
): number | null {
  const set = answered instanceof Set ? answered : new Set(answered);
  for (let position = 1; position <= cardCount; position++) {
    if (!set.has(position)) return position;
  }
  return null;
}

export function isDaily5PositionAnswered(
  answered: Iterable<number>,
  position: number,
): boolean {
  const set = answered instanceof Set ? answered : new Set(answered);
  return set.has(position);
}

export function resolveDaily5Resume(
  entry: Daily5ResumeEntry | null | undefined,
): Daily5ResumeState {
  const answeredPositions = answeredDaily5Positions(entry?.answers);
  const nextPosition = nextUnansweredDaily5Position(answeredPositions);
  const finishedOnServer = Boolean(entry?.completedAt);
  const allAnswered = nextPosition === null;
  const complete = finishedOnServer || allAnswered;

  return {
    phase: complete ? "complete" : "playing",
    currentPosition: nextPosition ?? DAILY5_CARD_COUNT,
    score: entry?.score ?? 0,
    correctCount: entry?.correctCount ?? 0,
    answeredPositions,
  };
}
