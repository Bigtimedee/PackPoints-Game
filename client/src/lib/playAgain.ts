/** Primary complete-screen CTA: mobile-safe tap target, full width. */
export const PLAY_AGAIN_BUTTON_CLASS = "w-full min-h-11 gap-2 text-base";

export function replaySetIdFromSession(session: {
  questions?: Array<{ card?: { gameSetId?: string | null } | null }> | null;
} | null | undefined): string | null {
  const id = session?.questions?.[0]?.card?.gameSetId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function replayCardCountFromSession(session: {
  totalQuestions?: number | null;
} | null | undefined): number | null {
  const n = session?.totalQuestions;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 5 || n > 20) return null;
  return n;
}

/**
 * Daily 5 is one-shot per CT day (`Already completed`). Game Complete must not
 * claim the user can replay today's five. Next play is a different mode.
 */
export const DAILY5_NEXT_PLAY = {
  doneNote: "Today's Daily 5 is done. Come back tomorrow for a new five.",
  primary: {
    label: "Play Solo",
    href: "/game/solo",
    testId: "button-d5-play-solo",
  },
  secondary: {
    label: "Browse Sets",
    href: "/sets",
    testId: "button-d5-browse-sets",
  },
} as const;

export const MATCH_FALLBACK_PLAY = {
  label: "Play Solo",
  href: "/game/solo",
  testId: "button-play-solo",
} as const;
