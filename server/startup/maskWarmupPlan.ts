import { pickCoverSlots, playerCoverIdentity } from "../services/setCovers";

/** Distinct baked players needed before /sets can fill its cover row. */
export const MASK_WARMUP_COVER_TARGET = 8;

/** Low-priority bakes at once. Live mask requests jump ahead of these. */
export const MASK_WARMUP_CONCURRENCY = 2;

export function distinctBakedPlayers(
  cards: Array<{ id: string; player: string | null }>,
  bakedIds: ReadonlySet<string>,
): number {
  const seen = new Set<string>();
  for (const card of cards) {
    if (!bakedIds.has(card.id)) continue;
    const identity = playerCoverIdentity(card.player);
    if (!identity) continue;
    seen.add(identity);
  }
  return seen.size;
}

/**
 * Version change warms every active set (covers, then the rest).
 * A finished set whose current-version cache is gone (cards remain, zero
 * baked players) is warmed again. Otherwise a set is warm once it has enough
 * distinct baked players, or once its warmup job has finished.
 */
export function setNeedsMaskWarmup(input: {
  distinctBakedPlayers: number;
  versionChanged: boolean;
  alreadyFinished: boolean;
  cardCount?: number;
  target?: number;
}): boolean {
  if (input.versionChanged) return true;
  const target = input.target ?? MASK_WARMUP_COVER_TARGET;
  if (input.alreadyFinished) {
    return (input.cardCount ?? 0) > 0 && input.distinctBakedPlayers === 0;
  }
  return input.distinctBakedPlayers < target;
}

/** Unbaked, non-failed cards. Eight distinct players first, then everyone else. */
export function orderWarmupCards<T extends { id: string; player: string | null }>(
  cards: T[],
  opts: {
    isBaked: (id: string) => boolean;
    isFailed: (id: string) => boolean;
    coverTarget?: number;
  },
): { covers: T[]; rest: T[]; ordered: T[] } {
  const pending = cards.filter((card) => !opts.isBaked(card.id) && !opts.isFailed(card.id));
  const covers = pickCoverSlots(pending, opts.coverTarget ?? MASK_WARMUP_COVER_TARGET);
  const coverIds = new Set(covers.map((card) => card.id));
  const rest = pending.filter((card) => !coverIds.has(card.id));
  return { covers, rest, ordered: [...covers, ...rest] };
}
