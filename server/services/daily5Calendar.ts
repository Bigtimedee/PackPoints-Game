/**
 * Daily 5 fixed calendar. Pure: no DB, no clock.
 *
 * Every America/Chicago day key from DAILY5_CALENDAR_START on maps to exactly
 * one scheduled set, so Marketing can time posts to it. Days before the start
 * return null and keep the legacy pick (most imported cards), so deals that
 * were already live before the calendar shipped do not move.
 *
 * The GREEN list is DAILY5_GREEN_SET_IDS (comma-separated set ids). Unset,
 * blank, or no valid ids uses DAILY5_GREEN_SET_IDS_DEFAULT. Order matters:
 * the first id is slot 0. Non-GREEN days use DAILY5_FALLBACK_SET_ID
 * (default 2024 Basketball). The fallback id is never also a GREEN slot.
 *
 * Weekly template. GREEN slot k (k-th id in the list) owns a fixed weekday:
 *   slot 0 Mon, 1 Wed, 2 Fri, 3 Tue, 4 Thu, 5 Sun, 6 Sat
 * Sat repeats slot 0 until there is a slot 6. Every other day without a
 * slot is a fallback day. So with the 3 default sets the week is
 *   Mon 0, Tue fallback, Wed 1, Thu fallback, Fri 2, Sat 0, Sun fallback
 * and appending ids to DAILY5_GREEN_SET_IDS only turns fallback days
 * (Tue, Thu, Sun) GREEN; it never moves an existing GREEN day. With 8 or
 * more ids each week shifts by 7 slots so every set still gets days.
 * No GREEN set lands on two days in a row, including Sun -> Mon.
 *
 * Runtime exclusion (held set, inactive set, too few dealable cards) is
 * applied by resolveDaily5SetForDate, not here.
 */
import { isPackptsDayKey } from "@shared/packptsDay";

/** Monday. First CT day on the fixed calendar. Do not move it. */
export const DAILY5_CALENDAR_START = "2026-10-05";

/** 2024 Basketball. Every non-GREEN day, and the runtime fallback. */
export const DAILY5_FALLBACK_SET_ID_DEFAULT = "229f0379-aa56-40a8-abe3-1af217a397e8";

/** Sets with a Design GREEN full-pool sweep, in slot order. */
export const DAILY5_GREEN_SET_IDS_DEFAULT: readonly string[] = [
  "352b33d1-c110-4e09-b641-8e3c02a94442", // 1989 Topps (Baseball)
  "91cfdf3f-a620-4e73-adc8-22b8df221716", // 1987 Topps Football
  "a09b2fe7-728e-431b-9df8-bbf2652aa3b2", // 1994 Topps Football
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface Daily5CalendarConfig {
  greenSetIds: string[];
  fallbackSetId: string;
}

type Env = Record<string, string | undefined>;

function normalizeId(value: string): string | null {
  const id = value.trim().toLowerCase();
  return UUID_RE.test(id) ? id : null;
}

export function daily5FallbackSetId(env: Env = process.env): string {
  return normalizeId(env.DAILY5_FALLBACK_SET_ID ?? "") ?? DAILY5_FALLBACK_SET_ID_DEFAULT;
}

export function daily5GreenSetIds(env: Env = process.env): string[] {
  const fallback = daily5FallbackSetId(env);
  const raw = env.DAILY5_GREEN_SET_IDS ?? "";
  const parsed: string[] = [];
  for (const part of raw.split(",")) {
    const id = normalizeId(part);
    if (id && !parsed.includes(id)) parsed.push(id);
  }
  const source = parsed.length > 0 ? parsed : [...DAILY5_GREEN_SET_IDS_DEFAULT];
  return source.filter((id) => id !== fallback);
}

export function daily5CalendarConfig(env: Env = process.env): Daily5CalendarConfig {
  return { greenSetIds: daily5GreenSetIds(env), fallbackSetId: daily5FallbackSetId(env) };
}

function dayNumber(dayKey: string): number {
  if (!isPackptsDayKey(dayKey)) throw new Error("invalid packpts day key");
  const [y, m, d] = dayKey.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** 0 = Monday .. 6 = Sunday for a CT day key. */
export function daily5Weekday(dayKey: string): number {
  // 1970-01-01 was a Thursday (index 3).
  return (((dayNumber(dayKey) + 3) % 7) + 7) % 7;
}

export function daysSinceCalendarStart(dayKey: string): number {
  return dayNumber(dayKey) - dayNumber(DAILY5_CALENDAR_START);
}

/** Mon..Sun -> GREEN slot number. Sat is slot 6 (repeats slot 0 below 7 sets). */
const WEEKDAY_SLOT = [0, 3, 1, 4, 2, 6, 5] as const;

/** Mon..Sun slot index into the GREEN list, or null for a fallback day (week 0). */
export function daily5WeeklyTemplate(greenCount: number, week = 0): (number | null)[] {
  return WEEKDAY_SLOT.map((slot, weekday) => {
    if (greenCount <= 0) return null;
    if (greenCount >= 7) return (slot + 7 * week) % greenCount;
    if (weekday === 5) return 0; // Sat repeats slot 0 (Fri and Sun are never slot 0)
    return slot < greenCount ? slot : null;
  });
}

export interface Daily5ScheduledSet {
  date: string;
  weekday: (typeof WEEKDAYS)[number];
  setId: string;
  slot: "green" | "fallback";
}

/** Scheduled set for a CT day, or null before DAILY5_CALENDAR_START (legacy pick). */
export function scheduledDaily5Set(
  dayKey: string,
  config: Daily5CalendarConfig = daily5CalendarConfig(),
): Daily5ScheduledSet | null {
  const offset = daysSinceCalendarStart(dayKey);
  if (offset < 0) return null;
  const weekdayIndex = daily5Weekday(dayKey);
  const weekday = WEEKDAYS[weekdayIndex];
  const green = config.greenSetIds;
  const week = Math.floor(offset / 7);
  const index = daily5WeeklyTemplate(green.length, week)[weekdayIndex];
  if (index == null) {
    return { date: dayKey, weekday, setId: config.fallbackSetId, slot: "fallback" };
  }
  return { date: dayKey, weekday, setId: green[index], slot: "green" };
}
