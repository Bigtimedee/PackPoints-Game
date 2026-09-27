/**
 * Sets that must not be dealt or shown on public set pages.
 * Held pending Design mask QA; released only by a PR that removes it.
 */
export const HELD_SET_IDS = ["c2ce5d11-bc9b-43ea-888e-609fdcec76e0"] as const;

const HELD = new Set<string>(HELD_SET_IDS.map((id) => id.toLowerCase()));

export function isHeldSet(id: string | null | undefined): boolean {
  if (!id) return false;
  return HELD.has(id.trim().toLowerCase());
}

/** One boot line. Ids are the first 8 characters, comma-separated. */
export function logHeldSets(): void {
  const ids = HELD_SET_IDS.map((id) => id.slice(0, 8)).join(",");
  console.log(`[HeldSets] ids=${ids}`);
}
