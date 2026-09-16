/**
 * Solo/1v1 replace-card helpers. Daily 5 must never call this path.
 * Stamp imageFailure on the failed card's index, not a raced current index.
 */

export type ReplaceLookupCard = {
  id?: string;
  playableCardId?: string;
  gameSetId?: string | null;
  setName?: string | null;
};

export function questionMatchesFailedCard(
  question: { card?: ReplaceLookupCard } | undefined,
  failedCardId: string,
): boolean {
  const ids = [question?.card?.playableCardId, question?.card?.id].filter(
    (id): id is string => !!id,
  );
  return ids.includes(failedCardId);
}

export function findQuestionIndexByCardId(
  questions: Array<{ card?: ReplaceLookupCard }>,
  failedCardId: string,
  fallbackIndex: number,
): number {
  const idx = questions.findIndex((q) => questionMatchesFailedCard(q, failedCardId));
  return idx >= 0 ? idx : fallbackIndex;
}

export function replacementSetLookup(card: ReplaceLookupCard | undefined): {
  gameSetId: string | null;
  setName: string | null;
} {
  return {
    gameSetId: card?.gameSetId || null,
    setName: card?.setName || null,
  };
}
