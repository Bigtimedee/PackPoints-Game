/**
 * Daily 5 “Beat me” deep-link contract.
 *
 * Canonical URL: https://packpts.com/daily?s={0-5}&n={username}
 * `/daily` and `/daily5` are the same page. Recipients always play *today’s*
 * Daily 5 — query params carry challenger context only, never a puzzle date.
 *
 * Honesty: `s` is the sender’s real session correct-count (X/5). Never invent
 * scores or streaks. Invalid / out-of-range `s` is ignored (no banner).
 */

export const DAILY_BEAT_ME_PATH = "/daily";
export const DAILY_BEAT_ME_ORIGIN = "https://packpts.com";

const STORAGE_KEY = "packpts_daily_beat_me";
const NAME_MAX = 20;

export interface DailyBeatMeChallenge {
  correctCount: number;
  displayName?: string;
}

export function parseBeatMeCorrectCount(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 5) {
    return raw;
  }
  if (typeof raw === "string" && /^(0|1|2|3|4|5)$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return undefined;
}

export function sanitizeBeatMeName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_]/g, "").slice(0, NAME_MAX);
  return cleaned || undefined;
}

export function buildDailyBeatMePath(input: {
  correctCount: unknown;
  displayName?: unknown;
}): string {
  const s = parseBeatMeCorrectCount(input.correctCount);
  if (s === undefined) return DAILY_BEAT_ME_PATH;
  const params = new URLSearchParams();
  params.set("s", String(s));
  const n = sanitizeBeatMeName(input.displayName);
  if (n) params.set("n", n);
  return `${DAILY_BEAT_ME_PATH}?${params.toString()}`;
}

export function buildDailyBeatMeUrl(input: {
  correctCount: unknown;
  displayName?: unknown;
}): string {
  return `${DAILY_BEAT_ME_ORIGIN}${buildDailyBeatMePath(input)}`;
}

export function parseDailyBeatMeParams(
  search: string | URLSearchParams,
): DailyBeatMeChallenge | null {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const s = parseBeatMeCorrectCount(params.get("s"));
  if (s === undefined) return null;
  return {
    correctCount: s,
    displayName: sanitizeBeatMeName(params.get("n") ?? undefined),
  };
}

export function formatBeatMeBanner(challenge: DailyBeatMeChallenge): string {
  const who = challenge.displayName ?? "A player";
  return `${who} went ${challenge.correctCount}/5 — Beat them`;
}

export function formatBeatMeShareCaption(challenge: DailyBeatMeChallenge): string {
  return `I went ${challenge.correctCount}/5 on today's Daily 5.`;
}

export function persistBeatMeChallenge(challenge: DailyBeatMeChallenge): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      correctCount: challenge.correctCount,
      displayName: challenge.displayName,
    }));
  } catch {
    // private mode / quota — banner still works from the URL
  }
}

export function readPersistedBeatMeChallenge(): DailyBeatMeChallenge | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { correctCount?: unknown; displayName?: unknown };
    const s = parseBeatMeCorrectCount(parsed.correctCount);
    if (s === undefined) return null;
    return {
      correctCount: s,
      displayName: sanitizeBeatMeName(parsed.displayName),
    };
  } catch {
    return null;
  }
}

/** Prefer URL params (and persist them); fall back to this-tab sessionStorage. */
export function resolveBeatMeChallenge(search: string): DailyBeatMeChallenge | null {
  const fromUrl = parseDailyBeatMeParams(search);
  if (fromUrl) {
    persistBeatMeChallenge(fromUrl);
    return fromUrl;
  }
  return readPersistedBeatMeChallenge();
}
