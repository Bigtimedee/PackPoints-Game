/**
 * Fire-and-forget bake of a dealt hand. Must not delay session/challenge/match start.
 * Cold volume: first GET still generates; this only races ahead of the player.
 */
export function kickPreMask(cardIds: Array<string | null | undefined>, reason: string): void {
  const unique = [...new Set(cardIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return;
  const started = Date.now();
  void import("./maskingService")
    .then(({ preMaskCards }) => preMaskCards(unique))
    .then(({ paths, timedOut }) => {
      const hits = [...paths.values()].filter(Boolean).length;
      console.log(`[PreMask] ${reason} warmed ${hits}/${unique.length} timedOut=${timedOut} in ${Date.now() - started}ms`);
    })
    .catch((err: { message?: string }) => {
      console.warn(`[PreMask] ${reason} failed:`, err?.message || err);
    });
}

export function cardIdsFromQuestions(
  questions: Array<{ card?: { id?: string | null; playableCardId?: string | null } | null }>,
): string[] {
  return questions
    .map((q) => q.card?.playableCardId || q.card?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}
