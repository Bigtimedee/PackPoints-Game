/**
 * Anonymous play gate.
 *
 * Guest rounds are not users. Thresholds and escrow math live here so the
 * server can enforce them and tests can lock them without a database.
 *
 * Day key is America/Chicago (`getPackptsDayKey`), same as Daily 5.
 */

export const ANON_COOKIE_NAME = "packpts_anon";
export const ANON_FINGERPRINT_HEADER = "x-packpts-fp";
export const ANON_GATE_CODE = "ANON_GATE";

/** Completed guest rounds before the register prompt. */
export const ANON_SOFT_GAMES = 1;
/** Completed guest rounds after which another start is refused. */
export const ANON_HARD_GAMES = 2;

export type AnonPlaySurface = "daily5" | "sets" | "solo";
export type AnonGatePhase = "open" | "soft" | "hard";
export type AnonGateReason = "under_limit" | "after_first_game" | "game_cap" | "next_day";

export type AnonGateDecision = {
  phase: AnonGatePhase;
  /** False only when a new game must not start. An in-progress round is not a new start. */
  canStart: boolean;
  prompt: "none" | "soft" | "hard";
  reason: AnonGateReason;
};

export type AnonPlayerSnapshot = {
  gamesCompleted: number;
  /** Not the cap. Abandoned starts stay at 0 completed games. */
  gamesStarted: number;
  daily5Completed: number;
  setsPlaysCompleted: number;
  soloPlaysCompleted: number;
  escrowPoints: number;
  escrowCorrect: number;
  escrowAnswers: number;
  /** Chicago day of the first counted Game Complete. */
  lastPlayDay: string | null;
  /** Soft sheet already dismissed. Hard still applies. */
  softDismissed: boolean;
  claimedAt: Date | string | null;
};

export type PublicAnonGate = AnonGateDecision & {
  escrowPoints: number;
  gamesCompleted: number;
  anonymous: true;
};

/** Locked Design / Marketing strings. Do not paraphrase. */
export const ANON_GATE_COPY = {
  softTitle: "Keep your PackPTS",
  softBody: "Create a free account to save streak and resume where you left off.",
  softCta: "Create free account",
  softSecondary: "Continue once more",
  hardTitle: "Register to keep playing",
  hardBody: "You've played two games as a guest. Create a free PackPTS account to continue Daily 5 and sets.",
  hardCta: "Create free account",
  signInCta: "Sign in",
  escrowLabel: "PackPTS held",
} as const;

export function emptyAnonSnapshot(): AnonPlayerSnapshot {
  return {
    gamesCompleted: 0,
    gamesStarted: 0,
    daily5Completed: 0,
    setsPlaysCompleted: 0,
    soloPlaysCompleted: 0,
    escrowPoints: 0,
    escrowCorrect: 0,
    escrowAnswers: 0,
    lastPlayDay: null,
    softDismissed: false,
    claimedAt: null,
  };
}

/**
 * Counts Game Complete only. Abandon, preview, and /make add nothing.
 * Soft once after the first Daily 5 or /sets (or home solo) completion.
 * Hard at 2 completions, or the next America/Chicago day after the first.
 */
export function evaluateAnonGate(state: {
  gamesCompleted: number;
  lastPlayDay: string | null;
  today: string;
  softDismissed?: boolean;
}): AnonGateDecision {
  const completed = state.gamesCompleted;
  const dayAfterFirstComplete =
    state.lastPlayDay != null &&
    state.lastPlayDay !== state.today &&
    completed > 0;

  if (completed >= ANON_HARD_GAMES) {
    return { phase: "hard", canStart: false, prompt: "hard", reason: "game_cap" };
  }
  if (dayAfterFirstComplete) {
    return { phase: "hard", canStart: false, prompt: "hard", reason: "next_day" };
  }
  if (completed >= ANON_SOFT_GAMES) {
    return {
      phase: "soft",
      canStart: true,
      prompt: state.softDismissed ? "none" : "soft",
      reason: "after_first_game",
    };
  }
  return { phase: "open", canStart: true, prompt: "none", reason: "under_limit" };
}

/** A Daily 5 resume is the same round, not a new start. Solo start is always a new game. */
export function anonStartAllowed(decision: AnonGateDecision, hasInProgress: boolean): boolean {
  if (hasInProgress) return true;
  return decision.canStart;
}

export function toPublicAnonGate(
  state: Pick<AnonPlayerSnapshot, "gamesCompleted" | "lastPlayDay" | "escrowPoints"> & { softDismissed?: boolean },
  today: string,
): PublicAnonGate {
  const decision = evaluateAnonGate({
    gamesCompleted: state.gamesCompleted,
    lastPlayDay: state.lastPlayDay,
    today,
    softDismissed: state.softDismissed,
  });
  return {
    ...decision,
    escrowPoints: Math.max(0, Math.floor(state.escrowPoints)),
    gamesCompleted: state.gamesCompleted,
    anonymous: true,
  };
}

export function anonGateDeniedBody(gate: PublicAnonGate) {
  return {
    error: ANON_GATE_COPY.hardTitle,
    message: ANON_GATE_COPY.hardBody,
    code: ANON_GATE_CODE,
    phase: gate.phase,
    reason: gate.reason,
    canStart: gate.canStart,
    prompt: gate.prompt,
    escrowPoints: gate.escrowPoints,
    gamesCompleted: gate.gamesCompleted,
    anonymous: true as const,
  };
}

export function applyCompletedGame(
  row: AnonPlayerSnapshot,
  input: {
    surface: AnonPlaySurface;
    points: number;
    correct: number;
    answers: number;
    today: string;
  },
): AnonPlayerSnapshot {
  if (row.claimedAt) return row;
  const points = Math.max(0, Math.floor(input.points));
  const correct = Math.max(0, Math.floor(input.correct));
  const answers = Math.max(0, Math.floor(input.answers));
  return {
    ...row,
    gamesCompleted: row.gamesCompleted + 1,
    daily5Completed: row.daily5Completed + (input.surface === "daily5" ? 1 : 0),
    setsPlaysCompleted: row.setsPlaysCompleted + (input.surface === "sets" ? 1 : 0),
    soloPlaysCompleted: row.soloPlaysCompleted + (input.surface === "solo" ? 1 : 0),
    escrowPoints: row.escrowPoints + points,
    escrowCorrect: row.escrowCorrect + correct,
    escrowAnswers: row.escrowAnswers + answers,
    lastPlayDay: row.lastPlayDay ?? input.today,
  };
}

/** Idempotent credit: a second completion of the same round must not add points again. */
export function creditIfNew(
  row: AnonPlayerSnapshot,
  input: {
    surface: AnonPlaySurface;
    points: number;
    correct: number;
    answers: number;
    today: string;
  },
  alreadyCredited: boolean,
): { row: AnonPlayerSnapshot; applied: boolean } {
  if (alreadyCredited || row.claimedAt) return { row, applied: false };
  return { row: applyCompletedGame(row, input), applied: true };
}

export type EscrowClaimPlan = {
  alreadyClaimed: boolean;
  creditPoints: number;
  games: number;
  correct: number;
  answers: number;
};

export function planEscrowClaim(row: AnonPlayerSnapshot): EscrowClaimPlan {
  if (row.claimedAt) {
    return { alreadyClaimed: true, creditPoints: 0, games: 0, correct: 0, answers: 0 };
  }
  return {
    alreadyClaimed: false,
    creditPoints: Math.max(0, Math.floor(row.escrowPoints)),
    games: Math.max(0, row.gamesCompleted),
    correct: Math.max(0, row.escrowCorrect),
    answers: Math.max(0, row.escrowAnswers),
  };
}

export type AnonConversionRow = {
  gamesCompleted: number;
  claimedAt: Date | string | null;
};

export type AnonConversionSummary = {
  anonIdentities: number;
  anonPlayed: number;
  claimed: number;
  claimedPlayed: number;
  unclaimedPlayed: number;
  /** claimedPlayed / anonPlayed. 0 when nobody has finished a guest round. */
  conversionRate: number;
};

/** Played-guest → register. Not a registered-user count. */
export function summarizeAnonConversion(rows: AnonConversionRow[]): AnonConversionSummary {
  let anonIdentities = 0;
  let anonPlayed = 0;
  let claimed = 0;
  let claimedPlayed = 0;
  for (const row of rows) {
    anonIdentities += 1;
    const played = row.gamesCompleted > 0;
    const didClaim = row.claimedAt != null;
    if (played) anonPlayed += 1;
    if (didClaim) claimed += 1;
    if (played && didClaim) claimedPlayed += 1;
  }
  return {
    anonIdentities,
    anonPlayed,
    claimed,
    claimedPlayed,
    unclaimedPlayed: anonPlayed - claimedPlayed,
    conversionRate: anonPlayed === 0 ? 0 : claimedPlayed / anonPlayed,
  };
}

export const ANON_CONVERSION_SQL = `
SELECT
  COUNT(*)::int AS anon_identities,
  COUNT(*) FILTER (WHERE games_completed > 0)::int AS anon_played,
  COUNT(*) FILTER (WHERE claimed_at IS NOT NULL)::int AS claimed,
  COUNT(*) FILTER (WHERE games_completed > 0 AND claimed_at IS NOT NULL)::int AS claimed_played
FROM anon_players
`.trim();
