/** Primary complete-screen CTA: mobile-safe tap target, full width. */
export const PLAY_AGAIN_BUTTON_CLASS = "w-full min-h-11 gap-2 text-base";

/** Written only from Play Again, before a deploy reload. Consumed once. */
export const SOLO_PLAY_AGAIN_RESUME_KEY = "packpts_solo_play_again";

export interface SoloPlayAgainResume {
  setId: string | null;
  cardCount: number;
  mode: string;
}

export function soloPlayAgainResumePayload(input: SoloPlayAgainResume): string {
  return JSON.stringify({
    setId: input.setId,
    cardCount: input.cardCount,
    mode: input.mode || "solo",
    reason: "play-again",
  });
}

export function parseSoloPlayAgainResume(raw: string | null | undefined): SoloPlayAgainResume | null {
  if (!raw) return null;
  try {
    const body = JSON.parse(raw) as {
      setId?: unknown;
      cardCount?: unknown;
      mode?: unknown;
      reason?: unknown;
    };
    if (body.reason !== "play-again") return null;
    const cardCount = typeof body.cardCount === "number" ? body.cardCount : Number(body.cardCount);
    if (!Number.isFinite(cardCount) || cardCount < 5 || cardCount > 20) return null;
    const setId = typeof body.setId === "string" && body.setId.length > 0 ? body.setId : null;
    const mode = typeof body.mode === "string" && body.mode.length > 0 ? body.mode : "solo";
    return { setId, cardCount, mode };
  } catch {
    return null;
  }
}

export function readSoloPlayAgainResume(storage: { getItem: (key: string) => string | null }): SoloPlayAgainResume | null {
  try {
    return parseSoloPlayAgainResume(storage.getItem(SOLO_PLAY_AGAIN_RESUME_KEY));
  } catch {
    return null;
  }
}

/** Drop the payload so a later refresh does not start another game. */
export function consumeSoloPlayAgainResume(storage: {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
}): SoloPlayAgainResume | null {
  const resume = readSoloPlayAgainResume(storage);
  try {
    storage.removeItem(SOLO_PLAY_AGAIN_RESUME_KEY);
  } catch {
    // private mode
  }
  return resume;
}

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
