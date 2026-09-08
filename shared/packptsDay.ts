/**
 * PackPTS product day — one timezone for Daily 5, streak, Beat-me, and
 * authored set dates on /sets.
 *
 * Locked: America/Chicago (CT). Do not use America/New_York, UTC calendar
 * dates, or a per-feature TZ for “today” / puzzle_day / challenge tokens.
 */

export const PACKPTS_DAY_TZ = "America/Chicago";

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isPackptsDayKey(value: unknown): value is string {
  return typeof value === "string" && DAY_KEY_RE.test(value);
}

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** YYYY-MM-DD in America/Chicago. */
export function getPackptsDayKey(at: Date = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: PACKPTS_DAY_TZ });
}

/** `{MON} {D}` for the America/Chicago calendar day of `at` (e.g. SEP 8). */
export function formatPackptsMonDay(at: Date): string {
  const key = getPackptsDayKey(at);
  if (!isPackptsDayKey(key)) return "";
  return `${MON[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(8, 10))}`;
}

export function addPackptsDays(dayKey: string, delta: number): string {
  if (!isPackptsDayKey(dayKey)) {
    throw new Error("invalid packpts day key");
  }
  const noonUtc = new Date(`${dayKey}T12:00:00.000Z`);
  noonUtc.setUTCDate(noonUtc.getUTCDate() + delta);
  return noonUtc.toISOString().slice(0, 10);
}

/** CT midnight → next CT midnight for a YYYY-MM-DD day key. */
export function getDailyStartEnd(dayKey: string): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: packptsMidnightUtc(dayKey),
    endsAt: packptsMidnightUtc(addPackptsDays(dayKey, 1)),
  };
}

/** Milliseconds until the next midnight in America/Chicago. */
export function msUntilPackptsMidnight(at: Date = new Date()): number {
  const today = getPackptsDayKey(at);
  const tomorrow = addPackptsDays(today, 1);
  const tomorrowStart = packptsMidnightUtc(tomorrow);
  return Math.max(0, tomorrowStart.getTime() - at.getTime());
}

/**
 * Instant of local midnight in America/Chicago for a YYYY-MM-DD day key.
 * Uses the TZ offset at that civil time (handles CST/CDT).
 */
export function packptsMidnightUtc(dayKey: string): Date {
  if (!isPackptsDayKey(dayKey)) {
    throw new Error("invalid packpts day key");
  }
  const probe = new Date(`${dayKey}T00:00:00Z`);
  const shown = probe.toLocaleString("en-US", { timeZone: PACKPTS_DAY_TZ });
  const utcShown = probe.toLocaleString("en-US", { timeZone: "UTC" });
  const offsetMs = new Date(utcShown).getTime() - new Date(shown).getTime();
  return new Date(probe.getTime() + offsetMs);
}
