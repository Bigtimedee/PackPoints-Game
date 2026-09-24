/**
 * Daily 5 “Beat me” client helpers.
 *
 * Durable URL:
 *   https://packpts.com/daily?utm_source=share&utm_medium=beatme&utm_campaign=daily5&challenge={token}
 *
 * Token is server-signed. puzzle_day is the America/Chicago Daily 5 day key.
 * Recipients always play *today’s* Daily 5. Stale tokens (wrong CT day) keep
 * the page playable and show an expired notice — never yesterday’s cards.
 */

export const DAILY_BEAT_ME_PATH = "/daily";
export const DAILY_BEAT_ME_ORIGIN = "https://packpts.com";

const STORAGE_KEY = "packpts_daily_beat_me";

export type BeatMeStatus = "active" | "stale" | "invalid";

export interface DailyBeatMeChallenge {
  status: BeatMeStatus;
  token: string;
  correctCount: number;
  displayName?: string;
  puzzleDay?: string;
  today?: string;
}

export function parseBeatMeToken(search: string | URLSearchParams): string | undefined {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const token = params.get("challenge")?.trim();
  return token || undefined;
}

export function buildDailyBeatMePath(token: string): string {
  const params = new URLSearchParams({
    utm_source: "share",
    utm_medium: "beatme",
    utm_campaign: "daily5",
    challenge: token,
  });
  return `${DAILY_BEAT_ME_PATH}?${params.toString()}`;
}

export function buildDailyBeatMeUrl(token: string): string {
  return `${DAILY_BEAT_ME_ORIGIN}${buildDailyBeatMePath(token)}`;
}

/** True only for the durable Beat-me shape — never bare /daily. */
export function isBeatMeShareUrl(url: string): boolean {
  try {
    const parsed = new URL(url, DAILY_BEAT_ME_ORIGIN);
    if (parsed.pathname !== "/daily" && parsed.pathname !== "/daily5") return false;
    return !!parsed.searchParams.get("challenge")
      && parsed.searchParams.get("utm_medium") === "beatme";
  } catch {
    return false;
  }
}

/** Locked Design SoR chrome. PackPTS only — never PackPoints, never a branded “points”. */
export const BEAT_ME_COPY = {
  primary: "Beat me.",
  share: "Share",
  save: "Save",
  helper: "Challenge a friend to today's five.",
  stale: "Challenge expired — play today's five.",
  anonymous: "a collector",
  sameFive: "Same five as today.",
  wantMore: "Want more?",
  browseSets: "Browse sets",
  browseHref: "/sets",
} as const;

const DISMISS_KEY = "packpts_daily_beat_me_dismissed";

export function beatMeCollectorName(displayName?: string): string {
  const name = displayName?.trim();
  return name || BEAT_ME_COPY.anonymous;
}

export function formatBeatMeBanner(challenge: DailyBeatMeChallenge): string {
  if (challenge.status !== "active") return BEAT_ME_COPY.stale;
  const who = beatMeCollectorName(challenge.displayName);
  return `Beat ${who} — they went ${challenge.correctCount}/5 today`;
}

export function formatBeatMeShareCaption(correctCount: number): string {
  return `I went ${correctCount}/5. Beat me. Play today's Daily 5.`;
}

export function formatBeatMeCompare(yours: number, theirs: number): string {
  if (yours === theirs) return `Tied at ${yours}/5.`;
  if (yours > theirs) return `You went ${yours}/5. They went ${theirs}/5.`;
  return `They led — ${theirs}/5 to your ${yours}/5.`;
}

export function dismissBeatMeBanner(token: string): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, token);
  } catch {
    // private mode / quota — banner can stay
  }
}

export function isBeatMeBannerDismissed(token: string): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === token;
  } catch {
    return false;
  }
}

export function persistBeatMeChallenge(challenge: DailyBeatMeChallenge): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(challenge));
  } catch {
    // private mode / quota
  }
}

export function readPersistedBeatMeChallenge(): DailyBeatMeChallenge | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyBeatMeChallenge;
    if (!parsed?.token || (parsed.status !== "active" && parsed.status !== "stale")) {
      return null;
    }
    if (
      typeof parsed.correctCount !== "number" ||
      parsed.correctCount < 0 ||
      parsed.correctCount > 5
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function mapBeatMeApiResult(
  token: string,
  data: {
    status?: string;
    correctCount?: number;
    displayName?: string;
    puzzleDay?: string;
    today?: string;
  },
): DailyBeatMeChallenge | null {
  if (data.status === "invalid" || data.status == null) return null;
  if (data.status !== "active" && data.status !== "stale") return null;
  if (typeof data.correctCount !== "number") return null;
  const challenge: DailyBeatMeChallenge = {
    status: data.status,
    token,
    correctCount: data.correctCount,
    displayName: data.displayName,
    puzzleDay: data.puzzleDay,
    today: data.today,
  };
  persistBeatMeChallenge(challenge);
  return challenge;
}
