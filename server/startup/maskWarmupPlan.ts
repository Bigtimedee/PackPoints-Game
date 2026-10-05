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

/**
 * Unbaked, non-failed cards. Design-pinned covers first (picks, then
 * alternates, in pinned order), then eight distinct players, then everyone
 * else. Baking pins first keeps /sets covers on the pinned order after a boot
 * cache reset instead of falling through to alternates while picks rebake.
 */
export function orderWarmupCards<T extends { id: string; player: string | null }>(
  cards: T[],
  opts: {
    isBaked: (id: string) => boolean;
    isFailed: (id: string) => boolean;
    coverTarget?: number;
    pinnedIds?: readonly string[];
  },
): { covers: T[]; rest: T[]; ordered: T[] } {
  const pending = cards.filter((card) => !opts.isBaked(card.id) && !opts.isFailed(card.id));
  const byId = new Map(pending.map((card) => [card.id, card] as const));
  const pinned: T[] = [];
  for (const id of opts.pinnedIds ?? []) {
    const card = byId.get(id);
    if (card && !pinned.includes(card)) pinned.push(card);
  }
  const pinnedSet = new Set(pinned.map((card) => card.id));
  const picked = pickCoverSlots(pending.filter((card) => !pinnedSet.has(card.id)), opts.coverTarget ?? MASK_WARMUP_COVER_TARGET);
  const covers = [...pinned, ...picked];
  const coverIds = new Set(covers.map((card) => card.id));
  const rest = pending.filter((card) => !coverIds.has(card.id));
  return { covers, rest, ordered: [...covers, ...rest] };
}
