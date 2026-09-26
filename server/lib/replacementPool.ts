/** How many cold bakes a replace may attempt before it admits the pool is empty. */
export const REPLACEMENT_COLD_ATTEMPTS = 3;

/**
 * Same-set candidates already passed deal eligibility.
 * Failed mask markers are dropped. Baked v4.5 files are served before a cold bake.
 */
export function rankReplacementCandidates<T extends { id: string }>(
  cards: T[],
  opts: {
    isFailed: (card: T) => boolean;
    isBaked: (card: T) => boolean;
  },
): { baked: T[]; cold: T[] } {
  const baked: T[] = [];
  const cold: T[] = [];
  for (const card of cards) {
    if (opts.isFailed(card)) continue;
    if (opts.isBaked(card)) baked.push(card);
    else cold.push(card);
  }
  return { baked, cold };
}
