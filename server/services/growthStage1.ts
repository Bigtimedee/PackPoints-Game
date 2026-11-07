/**
 * Server-authoritative stage 1 lifecycle events.
 * Inserts are ON CONFLICT DO NOTHING on (user_id, event_type).
 * Failures are swallowed by the callers that must not break signup or play.
 * Rows are written only for users created at or after the stage1 baseline.
 */
import { getPackptsDayKey } from "@shared/packptsDay";
import {
  buildGrowthStage1Report,
  classifyDestination,
  growthProvider,
  returnEventFor,
  type GrowthProvider,
  type GrowthStage1Report,
  type RawTouch,
  type Stage1User,
} from "@shared/growthStage1";

export const GROWTH_BASELINE_ID = "stage1";
export const GROWTH_BASELINE_NOTE =
  "Stage 1 lifecycle events start at this instant. Users created earlier are not backfilled. No signup, first_game_completed, day1_return, or day7_return rows are invented for them.";

export const GROWTH_EVENT_INSERT_SQL = `INSERT INTO growth_lifecycle_events (
  user_id, event_type, occurred_at, cohort_day, provider,
  raw_utm_source, raw_utm_medium, raw_utm_campaign, raw_utm_content,
  referrer_host, landing_page, destination, inferred
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
ON CONFLICT (user_id, event_type) DO NOTHING
RETURNING id`;

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number | null };

export type GrowthQueryable = {
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
};

let queryableOverride: GrowthQueryable | null = null;

export function setGrowthQueryableForTests(next: GrowthQueryable | null): void {
  queryableOverride = next;
  checkedActivity.clear();
}

async function query(text: string, params: unknown[] = []): Promise<QueryResult> {
  if (queryableOverride) return queryableOverride.query(text, params);
  const { pool } = await import("../db");
  const result = await pool.query(text, params);
  return { rows: (result?.rows ?? []) as Array<Record<string, unknown>>, rowCount: result?.rowCount };
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

type EligibleUser = { createdAt: Date; baseline: Date };

async function loadEligibleUser(userId: string): Promise<EligibleUser | null> {
  const result = await query(
    `SELECT u.created_at, u.is_admin, u.is_bot, u.is_test_account, g.started_at
     FROM users u
     LEFT JOIN growth_instrumentation g ON g.id = $2
     WHERE u.id = $1`,
    [userId, GROWTH_BASELINE_ID],
  );
  const row = result.rows[0];
  if (!row) return null;
  const createdAt = asDate(row.created_at);
  const baseline = asDate(row.started_at);
  if (!createdAt || !baseline || createdAt < baseline) return null;
  if (asBool(row.is_admin) || asBool(row.is_bot) || asBool(row.is_test_account)) return null;
  return { createdAt, baseline };
}

async function insertEvent(input: {
  userId: string;
  eventType: string;
  occurredAt: Date;
  cohortDay: string;
  provider: GrowthProvider | null;
  raw: RawTouch;
  destination: string | null;
}): Promise<boolean> {
  const result = await query(GROWTH_EVENT_INSERT_SQL, [
    input.userId,
    input.eventType,
    input.occurredAt,
    input.cohortDay,
    input.provider,
    input.raw.source ?? null,
    input.raw.medium ?? null,
    input.raw.campaign ?? null,
    input.raw.content ?? null,
    input.raw.referrerHost ?? null,
    input.raw.landingPage ?? null,
    input.destination,
    input.raw.inferred === true,
  ]);
  return (result.rowCount ?? result.rows.length) > 0;
}

export async function ensureGrowthInstrumentation(): Promise<void> {
  await query(
    `INSERT INTO growth_instrumentation (id, started_at, note)
     VALUES ($1, now(), $2)
     ON CONFLICT (id) DO NOTHING`,
    [GROWTH_BASELINE_ID, GROWTH_BASELINE_NOTE],
  );
}

/**
 * Call only for a user created in this request. A second call for the same
 * user inserts nothing. A user created before the baseline inserts nothing.
 */
export async function recordGrowthSignup(
  userId: string,
  attribution: RawTouch | null,
  provider?: string | null,
): Promise<{ inserted: boolean }> {
  if (!userId) return { inserted: false };
  const eligible = await loadEligibleUser(userId);
  if (!eligible) return { inserted: false };
  const raw: RawTouch = attribution ?? {};
  const inserted = await insertEvent({
    userId,
    eventType: "signup",
    occurredAt: eligible.createdAt,
    cohortDay: getPackptsDayKey(eligible.createdAt),
    provider: growthProvider(provider),
    raw,
    destination: classifyDestination(raw.landingPage),
  });
  return { inserted };
}

async function loadSignupCohort(userId: string): Promise<string | null> {
  const result = await query(
    `SELECT cohort_day FROM growth_lifecycle_events WHERE user_id = $1 AND event_type = 'signup' LIMIT 1`,
    [userId],
  );
  const day = asText(result.rows[0]?.cohort_day);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** First server-confirmed completion for a user who already has a signup event. */
export async function noteGrowthGameCompleted(userId: string | null | undefined, at = new Date()): Promise<void> {
  if (!userId) return;
  const cohortDay = await loadSignupCohort(userId);
  if (!cohortDay) return;
  await insertEvent({
    userId,
    eventType: "first_game_completed",
    occurredAt: at,
    cohortDay,
    provider: null,
    raw: {},
    destination: null,
  });
}

const checkedActivity = new Map<string, string>();

/**
 * Record day1_return or day7_return when this Chicago date is exactly that
 * offset from the signup date. Same-day and any other offset do nothing.
 * One row per event type. Safe to call on ordinary authenticated traffic.
 */
export async function noteGrowthActivity(userId: string | null | undefined, at = new Date()): Promise<void> {
  if (!userId) return;
  const activityDay = getPackptsDayKey(at);
  if (checkedActivity.get(userId) === activityDay) return;
  const cohortDay = await loadSignupCohort(userId);
  if (!cohortDay) {
    checkedActivity.set(userId, activityDay);
    return;
  }
  const eventType = returnEventFor(cohortDay, activityDay);
  if (!eventType) {
    checkedActivity.set(userId, activityDay);
    return;
  }
  await insertEvent({
    userId,
    eventType,
    occurredAt: at,
    cohortDay,
    provider: null,
    raw: {},
    destination: null,
  });
  checkedActivity.set(userId, activityDay);
}

function mapReportUser(row: Record<string, unknown>): Stage1User {
  const createdAt = asDate(row.created_at) ?? new Date(0);
  const signupAt = asDate(row.signup_at);
  return {
    id: String(row.id ?? ""),
    createdAt,
    isAdmin: asBool(row.is_admin),
    isBot: asBool(row.is_bot),
    isTest: asBool(row.is_test_account),
    signupEvent: signupAt
      ? {
          occurredAt: signupAt,
          provider: asText(row.provider),
          source: asText(row.raw_utm_source),
          medium: asText(row.raw_utm_medium),
          campaign: asText(row.raw_utm_campaign),
          content: asText(row.raw_utm_content),
          referrerHost: asText(row.referrer_host),
          landingPage: asText(row.landing_page),
          inferred: asBool(row.inferred),
        }
      : null,
    firstGameAt: asDate(row.first_game_at),
    day1At: asDate(row.day1_at),
    day7At: asDate(row.day7_at),
  };
}

export async function loadGrowthStage1Report(now = new Date()): Promise<GrowthStage1Report> {
  const baselineResult = await query(
    `SELECT started_at FROM growth_instrumentation WHERE id = $1`,
    [GROWTH_BASELINE_ID],
  );
  const baseline = asDate(baselineResult.rows[0]?.started_at);
  if (!baseline) {
    return buildGrowthStage1Report({ now, baselineStartedAt: null, users: [] });
  }
  const [usersResult, outsideResult] = await Promise.all([
    query(
      `SELECT u.id, u.created_at, u.is_admin, u.is_bot, u.is_test_account,
              s.occurred_at AS signup_at, s.provider, s.raw_utm_source, s.raw_utm_medium,
              s.raw_utm_campaign, s.raw_utm_content, s.referrer_host, s.landing_page, s.inferred,
              g.occurred_at AS first_game_at, d1.occurred_at AS day1_at, d7.occurred_at AS day7_at
       FROM users u
       LEFT JOIN growth_lifecycle_events s ON s.user_id = u.id AND s.event_type = 'signup'
       LEFT JOIN growth_lifecycle_events g ON g.user_id = u.id AND g.event_type = 'first_game_completed'
       LEFT JOIN growth_lifecycle_events d1 ON d1.user_id = u.id AND d1.event_type = 'day1_return'
       LEFT JOIN growth_lifecycle_events d7 ON d7.user_id = u.id AND d7.event_type = 'day7_return'
       WHERE u.created_at >= $1`,
      [baseline],
    ),
    query(
      `SELECT count(*)::int AS n
       FROM growth_lifecycle_events e
       JOIN users u ON u.id = e.user_id
       WHERE e.event_type = 'signup' AND u.created_at < $1`,
      [baseline],
    ),
  ]);
  const outside = Number(outsideResult.rows[0]?.n ?? 0);
  return buildGrowthStage1Report({
    now,
    baselineStartedAt: baseline,
    users: usersResult.rows.map(mapReportUser),
    signupEventsOutsideCohort: Number.isFinite(outside) ? outside : 0,
  });
}
