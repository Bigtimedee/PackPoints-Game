/**
 * Admin-only D1 / D7 / D30 retention — weekly first-active cohorts.
 *
 * Unpublished externally. Never send these numbers to /api/home-stats,
 * marketing pages, maker share, or any public surface.
 *
 * =============================================================================
 * Cohort definition (read this before changing the SQL or the fixture math)
 * =============================================================================
 *
 * Activity source: `event_log` — the same spine as admin DAU
 * (`adminService.getMetrics`) and Maker Rate MAU (`makingLayerMetrics.ts`).
 * We do **not** use `user_presence.last_seen_at` (the old Prompt 16 query)
 * and we do **not** use `users.created_at` as the cohort clock.
 *
 * Why first-active, not signup:
 *   A signup with no event_log row never enters DAU / Maker Rate MAU.
 *   Counting those users as a cohort would invent a retention hole that
 *   the rest of admin analytics does not treat as activity.
 *   Retention emails (`retentionEmails.ts`) also key off last-played
 *   (`streak_state.last_active_local_date`), not signup date — same
 *   activity family. Do not compare email-lapsed counts to these rates
 *   as if they were the same statistic.
 *
 * Cohort entry: non-staff, non-bot user whose **first** `event_log` row
 * (MIN created_at) falls in that ISO week (Monday–Sunday, America/Chicago).
 *
 * Staff exclusion: `users.is_admin = true` out of both cohort and returns,
 * matching Maker Rate. Bots (`users.is_bot = true`) are also excluded —
 * they are the AI fallback opponent, not product users.
 *
 * Day key: America/Chicago (PACKPTS_DAY_TZ) — the product day used by
 * Daily 5 and streaks. D1 is “came back the next PackPTS day,” not a
 * rolling 24h window.
 *
 * D_N retained: the user has ≥1 event_log row whose CT date is exactly
 * first_active_day + N. Day 0 (first-active day) does not count as D1.
 * This is classic same-day-N retention, not “last seen ≥ N days later.”
 *
 * Pending windows: a weekly D_N rate is null until the CT calendar date
 * is strictly after (week’s Sunday + N). Until then the last user in the
 * week has not finished their day-N. Show “—” — never treat pending as 0%.
 *
 * How Dave / Eng should read a weekly row:
 *   1. Read cohort size first. A 40% on n=5 is real but noisy.
 *   2. Ignore “—” cells; the window is not closed.
 *   3. D1 / D7 / D30 are independent (D7 does not require D1).
 *   4. Maker Rate on the same page is a 30d conversion metric
 *      (makers_30d / mau_30d), not a retention substitute.
 *      It is loaded via `fetchMakerRateMetrics` — do not redefine it.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { addPackptsDays, getPackptsDayKey, isPackptsDayKey } from "@shared/packptsDay";
import { fetchMakerRateMetrics } from "./makingLayerMetrics";

export const RETENTION_WEEK_COUNT = 13;
export const RETENTION_WINDOWS = [1, 7, 30] as const;
export type RetentionWindow = (typeof RETENTION_WINDOWS)[number];

export interface RetentionFixtureUser {
  id: string;
  is_admin: boolean;
  is_bot?: boolean;
}

export interface RetentionFixtureEvent {
  user_id: string | null;
  created_at: Date;
}

export interface RetentionCohortRow {
  cohortWeek: string;
  cohortSize: number;
  d1Returned: number;
  d7Returned: number;
  d30Returned: number;
  /** Decimal 0–1, or null when the window is not closed for the whole week. */
  d1Rate: number | null;
  d7Rate: number | null;
  d30Rate: number | null;
}

export interface RetentionHeadline {
  cohortWeek: string;
  cohortSize: number;
  returned: number;
  rate: number;
}

export interface RetentionReport {
  timezone: "America/Chicago";
  asOfDay: string;
  definition: {
    cohort: string;
    returnOn: string;
    staff: string;
    pending: string;
  };
  headlines: {
    d1: RetentionHeadline | null;
    d7: RetentionHeadline | null;
    d30: RetentionHeadline | null;
  };
  cohorts: RetentionCohortRow[];
}

/** Monday (ISO) of the PackPTS week that contains `dayKey`. */
export function packptsIsoWeekStart(dayKey: string): string {
  if (!isPackptsDayKey(dayKey)) {
    throw new Error("invalid packpts day key");
  }
  const noonUtc = new Date(`${dayKey}T12:00:00.000Z`);
  const dow = noonUtc.getUTCDay(); // 0 Sun … 6 Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  return addPackptsDays(dayKey, offset);
}

export function computeRetentionRate(returned: number, cohortSize: number): number {
  if (!Number.isFinite(returned) || !Number.isFinite(cohortSize) || cohortSize <= 0) {
    return 0;
  }
  return returned / cohortSize;
}

/**
 * A week’s D_N is mature only after every member’s day-N has finished:
 * today (CT) > Sunday-of-week + N.
 */
export function isRetentionWindowMature(
  cohortWeekStart: string,
  window: RetentionWindow,
  today: string,
): boolean {
  const weekEnd = addPackptsDays(cohortWeekStart, 6);
  const lastDnDay = addPackptsDays(weekEnd, window);
  return today > lastDnDay;
}

function headlineFor(
  cohorts: RetentionCohortRow[],
  window: RetentionWindow,
): RetentionHeadline | null {
  const rateKey = window === 1 ? "d1Rate" : window === 7 ? "d7Rate" : "d30Rate";
  const returnedKey = window === 1 ? "d1Returned" : window === 7 ? "d7Returned" : "d30Returned";
  for (const row of cohorts) {
    const rate = row[rateKey];
    if (rate === null) continue;
    return {
      cohortWeek: row.cohortWeek,
      cohortSize: row.cohortSize,
      returned: row[returnedKey],
      rate,
    };
  }
  return null;
}

/**
 * In-memory mirror of the admin retention SQL filters.
 * Fixture tests prove first-active (not signup), exact day-N return,
 * staff/bot exclusion, and pending windows without a live DB.
 */
export function computeRetentionFromFixture(opts: {
  now: Date;
  users: RetentionFixtureUser[];
  events: RetentionFixtureEvent[];
  weekCount?: number;
}): RetentionReport {
  const weekCount = opts.weekCount ?? RETENTION_WEEK_COUNT;
  const today = getPackptsDayKey(opts.now);
  const thisWeekStart = packptsIsoWeekStart(today);
  const oldestWeekStart = addPackptsDays(thisWeekStart, -7 * (weekCount - 1));

  const eligible = new Map<string, RetentionFixtureUser>();
  for (const u of opts.users) {
    if (u.is_admin) continue;
    if (u.is_bot) continue;
    eligible.set(u.id, u);
  }

  const daysByUser = new Map<string, Set<string>>();
  for (const e of opts.events) {
    if (!e.user_id) continue;
    if (!eligible.has(e.user_id)) continue;
    const day = getPackptsDayKey(e.created_at);
    let set = daysByUser.get(e.user_id);
    if (!set) {
      set = new Set();
      daysByUser.set(e.user_id, set);
    }
    set.add(day);
  }

  type Member = { userId: string; firstDay: string; days: Set<string> };
  const byWeek = new Map<string, Member[]>();
  for (const [userId, days] of daysByUser) {
    const firstDay = [...days].sort()[0];
    if (firstDay < oldestWeekStart || firstDay > today) continue;
    const week = packptsIsoWeekStart(firstDay);
    const list = byWeek.get(week) ?? [];
    list.push({ userId, firstDay, days });
    byWeek.set(week, list);
  }

  const weekStarts: string[] = [];
  for (let i = 0; i < weekCount; i++) {
    weekStarts.push(addPackptsDays(thisWeekStart, -7 * i));
  }

  const cohorts: RetentionCohortRow[] = [];
  for (const cohortWeek of weekStarts) {
    const members = byWeek.get(cohortWeek) ?? [];
    if (members.length === 0) continue;

    let d1Returned = 0;
    let d7Returned = 0;
    let d30Returned = 0;
    for (const m of members) {
      if (m.days.has(addPackptsDays(m.firstDay, 1))) d1Returned += 1;
      if (m.days.has(addPackptsDays(m.firstDay, 7))) d7Returned += 1;
      if (m.days.has(addPackptsDays(m.firstDay, 30))) d30Returned += 1;
    }

    const size = members.length;
    const d1Mature = isRetentionWindowMature(cohortWeek, 1, today);
    const d7Mature = isRetentionWindowMature(cohortWeek, 7, today);
    const d30Mature = isRetentionWindowMature(cohortWeek, 30, today);

    cohorts.push({
      cohortWeek,
      cohortSize: size,
      d1Returned,
      d7Returned,
      d30Returned,
      d1Rate: d1Mature ? computeRetentionRate(d1Returned, size) : null,
      d7Rate: d7Mature ? computeRetentionRate(d7Returned, size) : null,
      d30Rate: d30Mature ? computeRetentionRate(d30Returned, size) : null,
    });
  }

  return {
    timezone: "America/Chicago",
    asOfDay: today,
    definition: {
      cohort:
        "Weekly ISO (Mon–Sun, America/Chicago) of a non-staff, non-bot user’s first event_log row.",
      returnOn:
        "D_N = ≥1 event_log row on first-active CT date + N. Day 0 does not count as D1.",
      staff: "users.is_admin excluded (same as Maker Rate). users.is_bot excluded.",
      pending:
        "Rate is null until today (CT) > week Sunday + N. Do not read “—” as 0%.",
    },
    headlines: {
      d1: headlineFor(cohorts, 1),
      d7: headlineFor(cohorts, 7),
      d30: headlineFor(cohorts, 30),
    },
    cohorts,
  };
}

/** Rows used to rebuild the fixture report from live event_log. */
const RETENTION_EVENT_SQL = sql`
  WITH first_ts AS (
    SELECT el.user_id, MIN(el.created_at) AS first_at
    FROM event_log el
    INNER JOIN users u ON u.id = el.user_id
    WHERE el.user_id IS NOT NULL
      AND COALESCE(u.is_admin, false) = false
      AND COALESCE(u.is_bot, false) = false
    GROUP BY el.user_id
  )
  SELECT el.user_id::text AS user_id, el.created_at
  FROM first_ts ft
  INNER JOIN event_log el ON el.user_id = ft.user_id
  WHERE ft.first_at >= NOW() - INTERVAL '98 days'
    AND el.created_at <= ft.first_at + INTERVAL '31 days'
`;

export async function fetchRetentionReport(now: Date = new Date()): Promise<RetentionReport> {
  const result = await db.execute(RETENTION_EVENT_SQL);
  const events: RetentionFixtureEvent[] = (result.rows as { user_id: string; created_at: Date }[]).map(
    (row) => ({
      user_id: row.user_id,
      created_at: new Date(row.created_at),
    }),
  );

  const userIds = [...new Set(events.map((e) => e.user_id).filter((id): id is string => !!id))];
  const users: RetentionFixtureUser[] = userIds.map((id) => ({
    id,
    is_admin: false,
    is_bot: false,
  }));

  return computeRetentionFromFixture({ now, users, events });
}

export async function fetchAdminRetentionPayload(now: Date = new Date()): Promise<{
  report: RetentionReport;
  makerRate: number;
  makers30d: number;
  mau30d: number;
  publishedSetsNonStaff: number;
}> {
  const [report, maker] = await Promise.all([
    fetchRetentionReport(now),
    fetchMakerRateMetrics(),
  ]);
  return {
    report,
    makerRate: maker.makerRate,
    makers30d: maker.makers30d,
    mau30d: maker.mau30d,
    publishedSetsNonStaff: maker.publishedSetsNonStaff,
  };
}
