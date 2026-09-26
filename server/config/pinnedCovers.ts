/**
 * Public /sets cover pins. Design reviews this file. Change it only in a pull request.
 * Each value is card ids in display order. Eight is the maximum.
 * An empty list shows no covers. A set id that is not listed is an empty list.
 * A pin that fails the cover checks drops out. Nothing else fills that slot.
 */
export const MAX_PINNED_COVERS = 8;

export const PINNED_SET_COVERS: Readonly<Record<string, readonly string[]>> = {
  "229f0379-aa56-40a8-abe3-1af217a397e8": [],
  "91cfdf3f-a620-4e73-adc8-22b8df221716": [],
  "a09b2fe7-728e-431b-9df8-bbf2652aa3b2": [],
  "37fd025d-2ae1-4c92-b8ad-133375d0c722": [],
};

const testOverrides = new Map<string, readonly string[]>();

/** Tests pin a set without editing the Design file. Null clears that set. */
export function setPinnedCoversForTests(setId: string, cardIds: readonly string[] | null): void {
  if (cardIds == null) testOverrides.delete(setId);
  else testOverrides.set(setId, cardIds);
}

export function pinnedCoverSource(setId: string): readonly string[] {
  if (testOverrides.has(setId)) return testOverrides.get(setId) ?? [];
  return PINNED_SET_COVERS[setId] ?? [];
}

/** Configured ids, trimmed. Order is the Design order, including ids past the cap. */
export function listedPinnedCoverIds(setId: string): string[] {
  const out: string[] = [];
  for (const raw of pinnedCoverSource(setId)) {
    const id = String(raw ?? "").trim();
    if (id) out.push(id);
  }
  return out;
}
