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
  /** Starts, including abandoned rounds. The cap uses the larger of this and gamesCompleted. */
  gamesStarted: number;
  daily5Completed: number;
  setsPlaysCompleted: number;
  soloPlaysCompleted: number;
  escrowPoints: number;
  escrowCorrect: number;
  escrowAnswers: number;
  lastPlayDay: string | null;
  claimedAt: Date | string | null;
};

export type PublicAnonGate = AnonGateDecision & {
  escrowPoints: number;
  gamesCompleted: number;
  anonymous: true;
};

export const ANON_GATE_COPY = {
  softTitle: "Save your PackPTS",
  softBody:
    "You finished a guest round. Create a free account or sign in and we will add these PackPTS to your wallet. You can play one more round before registering.",
  softBanner: "Guest round saved. One more round, then create a free account to keep playing.",
  softCta: "Create account and claim PackPTS",
  softSecondary: "Play one more round",
  hardTitle: "Register to keep playing",
  hardBody:
    "Guest play covers two rounds. Your PackPTS are saved — create a free account or sign in to add them to your wallet and start another game.",
  nextDayBody:
    "Welcome back. Guest rounds do not carry into a new day. Sign in or create a free account to claim your PackPTS and play.",
  hardCta: "Create account and claim PackPTS",
  signInCta: "Sign in and claim PackPTS",
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
    claimedAt: null,
  };
}

/**
 * Soft after the first completed Daily 5, /sets, or solo round (same day).
 * Hard when a third start would begin, or when they return on a later CT day
 * still anonymous. Does not describe an in-progress round — callers allow
 * resume separately via `anonStartAllowed`.
 */
export function roundsUsed(state: { gamesCompleted: number; gamesStarted?: number }): number {
  return Math.max(state.gamesCompleted, state.gamesStarted ?? 0);
}

export function evaluateAnonGate(state: {
  gamesCompleted: number;
  gamesStarted?: number;
  lastPlayDay: string | null;
  today: string;
}): AnonGateDecision {
  const used = roundsUsed(state);
  const playedOnEarlierDay =
    state.lastPlayDay != null &&
    state.lastPlayDay !== state.today &&
    used > 0;

  if (used >= ANON_HARD_GAMES) {
    return { phase: "hard", canStart: false, prompt: "hard", reason: "game_cap" };
  }
  if (playedOnEarlierDay) {
    return { phase: "hard", canStart: false, prompt: "hard", reason: "next_day" };
  }
  if (state.gamesCompleted >= ANON_SOFT_GAMES) {
    return { phase: "soft", canStart: true, prompt: "soft", reason: "after_first_game" };
  }
  return { phase: "open", canStart: true, prompt: "none", reason: "under_limit" };
}

/** Call only after `evaluateAnonGate(...).canStart` is true. A resume must not call this. */
export function noteAnonStart(row: AnonPlayerSnapshot, today: string): AnonPlayerSnapshot {
  if (row.claimedAt) return row;
  return {
    ...row,
    gamesStarted: row.gamesStarted + 1,
    lastPlayDay: today,
  };
}

/** A Daily 5 resume is the same round, not a new start. Solo start is always a new game. */
export function anonStartAllowed(decision: AnonGateDecision, hasInProgress: boolean): boolean {
  if (hasInProgress) return true;
  return decision.canStart;
}

export function toPublicAnonGate(
  state: Pick<AnonPlayerSnapshot, "gamesCompleted" | "gamesStarted" | "lastPlayDay" | "escrowPoints">,
  today: string,
): PublicAnonGate {
  const decision = evaluateAnonGate({
    gamesCompleted: state.gamesCompleted,
    gamesStarted: state.gamesStarted,
    lastPlayDay: state.lastPlayDay,
    today,
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
    message: gate.reason === "next_day" ? ANON_GATE_COPY.nextDayBody : ANON_GATE_COPY.hardBody,
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
    lastPlayDay: input.today,
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
