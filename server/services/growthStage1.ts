/**
 * Server-authoritative stage 1 lifecycle events.
 * Inserts are ON CONFLICT DO NOTHING on (user_id, event_type).
 * Failures are swallowed by the callers that must not break signup or play.
 * Rows are written only for users created at or after the stage1 baseline.
 */
import { sql, type SQL } from "drizzle-orm";
import { getPackptsDayKey } from "@shared/packptsDay";
import {
  buildGrowthStage1Report,
  classifyDestination,
  growthProvider,
  returnEventFor,
  type GrowthStage1Report,
  type RawTouch,
  type Stage1User,
} from "@shared/growthStage1";

export const GROWTH_BASELINE_ID = "stage1";
export const GROWTH_BASELINE_NOTE =
  "Stage 1 lifecycle events start at this instant. Users created earlier are not backfilled. No signup, first_game_completed, day1_return, or day7_return rows are invented for them.";

/**
 * users.created_at is timestamp without time zone. It is a UTC wall clock.
 * Casting with AT TIME ZONE 'UTC' does not consult the session TimeZone.
 * Chicago day uses that absolute instant, not the Node process TZ.
 */
export const GROWTH_USER_INSTANT_SQL = `(u.created_at AT TIME ZONE 'UTC')`;
export const GROWTH_COHORT_DAY_SQL = `to_char((u.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD')`;
export const GROWTH_SIGNUP_INSERT_SQL = `INSERT INTO growth_lifecycle_events (
  user_id, event_type, occurred_at, cohort_day, provider,
  raw_utm_source, raw_utm_medium, raw_utm_campaign, raw_utm_content,
  referrer_host, landing_page, destination, inferred
)
SELECT u.id, 'signup', ${GROWTH_USER_INSTANT_SQL}, ${GROWTH_COHORT_DAY_SQL},
       $2, $3, $4, $5, $6, $7, $8, $9, $10
FROM users u
JOIN growth_instrumentation g ON g.id = 'stage1'
WHERE u.id = $1
  AND ${GROWTH_USER_INSTANT_SQL} >= g.started_at
  AND COALESCE(u.is_admin, false) = false
  AND COALESCE(u.is_bot, false) = false
  AND COALESCE(u.is_test_account, false) = false
ON CONFLICT (user_id, event_type) DO NOTHING`;
export const GROWTH_EVENT_INSERT_SQL = `INSERT INTO growth_lifecycle_events (
  user_id, event_type, occurred_at, cohort_day, provider,
  raw_utm_source, raw_utm_medium, raw_utm_campaign, raw_utm_content,
  referrer_host, landing_page, destination, inferred
)
SELECT $1::varchar, $2::varchar, COALESCE($3::timestamptz, now()), s.cohort_day,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false
FROM growth_lifecycle_events s
WHERE s.user_id = $1::varchar AND s.event_type = 'signup'
ON CONFLICT (user_id, event_type) DO NOTHING`;

export class GrowthSignupMissingError extends Error {
  constructor() {
    super("growth signup event was not recorded");
    this.name = "GrowthSignupMissingError";
  }
}

export type GrowthSignupAttach = {
  provider?: string | null;
  attribution?: RawTouch | null;
};

type SqlExecutor = { execute: (query: SQL) => Promise<unknown> };

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

function signupParams(userId: string, raw: RawTouch | null, provider?: string | null): unknown[] {
  const touch = raw ?? {};
  return [
    userId,
    growthProvider(provider),
    touch.source ?? null,
    touch.medium ?? null,
    touch.campaign ?? null,
    touch.content ?? null,
    touch.referrerHost ?? null,
    touch.landingPage ?? null,
    classifyDestination(touch.landingPage),
    touch.inferred === true,
  ];
}

function resultRows(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object") return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
}

export async function insertSignupForNewUser(
  tx: SqlExecutor,
  userId: string,
  raw: RawTouch | null,
  provider?: string | null,
): Promise<void> {
  const touch = raw ?? {};
  await tx.execute(sql`
    INSERT INTO growth_lifecycle_events (
      user_id, event_type, occurred_at, cohort_day, provider,
      raw_utm_source, raw_utm_medium, raw_utm_campaign, raw_utm_content,
      referrer_host, landing_page, destination, inferred
    )
    SELECT u.id, 'signup', (u.created_at AT TIME ZONE 'UTC'),
           to_char((u.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD'),
           ${growthProvider(provider)},
           ${touch.source ?? null}, ${touch.medium ?? null}, ${touch.campaign ?? null}, ${touch.content ?? null},
           ${touch.referrerHost ?? null}, ${touch.landingPage ?? null},
           ${classifyDestination(touch.landingPage)}, ${touch.inferred === true}
    FROM users u
    JOIN growth_instrumentation g ON g.id = 'stage1'
    WHERE u.id = ${userId}
      AND (u.created_at AT TIME ZONE 'UTC') >= g.started_at
      AND COALESCE(u.is_admin, false) = false
      AND COALESCE(u.is_bot, false) = false
      AND COALESCE(u.is_test_account, false) = false
    ON CONFLICT (user_id, event_type) DO NOTHING
  `);
  const checked = await tx.execute(sql`
    SELECT
      EXISTS(
        SELECT 1 FROM growth_lifecycle_events
        WHERE user_id = ${userId} AND event_type = 'signup'
      ) AS has_event,
      EXISTS(
        SELECT 1 FROM users u
        JOIN growth_instrumentation g ON g.id = 'stage1'
        WHERE u.id = ${userId}
          AND (u.created_at AT TIME ZONE 'UTC') >= g.started_at
          AND COALESCE(u.is_admin, false) = false
          AND COALESCE(u.is_bot, false) = false
          AND COALESCE(u.is_test_account, false) = false
      ) AS should
  `);
  const row = resultRows(checked)[0];
  if (row && asBool(row.should) && !asBool(row.has_event)) throw new GrowthSignupMissingError();
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
  const inserted = await query(GROWTH_SIGNUP_INSERT_SQL, signupParams(userId, attribution, provider));
  const checked = await query(
    `SELECT
       EXISTS(SELECT 1 FROM growth_lifecycle_events WHERE user_id = $1 AND event_type = 'signup') AS has_event,
       EXISTS(
         SELECT 1 FROM users u
         JOIN growth_instrumentation g ON g.id = 'stage1'
         WHERE u.id = $1
           AND (u.created_at AT TIME ZONE 'UTC') >= g.started_at
           AND COALESCE(u.is_admin, false) = false
           AND COALESCE(u.is_bot, false) = false
           AND COALESCE(u.is_test_account, false) = false
       ) AS should`,
    [userId],
  );
  const row = checked.rows[0];
  if (row && asBool(row.should) && !asBool(row.has_event)) throw new GrowthSignupMissingError();
  return { inserted: (inserted.rowCount ?? 0) > 0 };
}

/** Idempotent repair for real accounts created at or after the baseline with no signup row. */
export async function reconcilePostBaselineSignups(onlyUserIds?: string[]): Promise<number> {
  const limited = Array.isArray(onlyUserIds);
  const filter = limited ? `AND u.id = ANY($1::varchar[])` : "";
  const result = await query(
    `INSERT INTO growth_lifecycle_events (
       user_id, event_type, occurred_at, cohort_day, provider,
       raw_utm_source, raw_utm_medium, raw_utm_campaign, raw_utm_content,
       referrer_host, landing_page, destination, inferred
     )
     SELECT u.id, 'signup', (u.created_at AT TIME ZONE 'UTC'),
            to_char((u.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD'),
            CASE
              WHEN u.oauth_provider IN ('google', 'apple', 'workos') THEN u.oauth_provider
              WHEN EXISTS (SELECT 1 FROM apple_users a WHERE a.user_id = u.id) THEN 'apple'
              WHEN u.workos_user_id IS NOT NULL THEN 'workos'
              WHEN EXISTS (SELECT 1 FROM local_credentials c WHERE c.user_id = u.id) THEN 'email'
              ELSE NULL
            END,
            ua.utm_source, ua.utm_medium, ua.utm_campaign, ua.utm_content,
            ua.referrer, ua.landing_page,
            CASE
              WHEN ua.landing_page IN ('/daily', '/daily5') THEN ua.landing_page
              WHEN ua.landing_page ~ '^/sets/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                THEN lower(ua.landing_page)
              ELSE NULL
            END,
            false
     FROM users u
     JOIN growth_instrumentation g ON g.id = 'stage1'
     LEFT JOIN user_attribution ua ON ua.user_id = u.id
     WHERE (u.created_at AT TIME ZONE 'UTC') >= g.started_at
       AND COALESCE(u.is_admin, false) = false
       AND COALESCE(u.is_bot, false) = false
       AND COALESCE(u.is_test_account, false) = false
       AND (
         u.workos_user_id IS NOT NULL
         OR u.oauth_provider IS NOT NULL
         OR EXISTS (SELECT 1 FROM local_credentials c WHERE c.user_id = u.id)
         OR EXISTS (SELECT 1 FROM apple_users a WHERE a.user_id = u.id)
       )
       AND NOT EXISTS (
         SELECT 1 FROM growth_lifecycle_events e
         WHERE e.user_id = u.id AND e.event_type = 'signup'
       )
       ${filter}
     ON CONFLICT (user_id, event_type) DO NOTHING`,
    limited ? [onlyUserIds] : [],
  );
  return result.rowCount ?? 0;
}

let reconcileTimer: ReturnType<typeof setInterval> | null = null;

/** Run once, then keep repairing rollout gaps. Call only after the schema push. */
export async function startGrowthSignupReconcile(): Promise<void> {
  await reconcilePostBaselineSignups();
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    void reconcilePostBaselineSignups().catch((err: unknown) => {
      console.error("[Growth] signup reconcile failed:", err instanceof Error ? err.message : err);
    });
  }, 60_000);
  reconcileTimer.unref?.();
}

/** First server-confirmed completion for a user who already has a signup event. */
export async function noteGrowthGameCompleted(userId: string | null | undefined, at = new Date()): Promise<void> {
  if (!userId) return;
  await query(GROWTH_EVENT_INSERT_SQL, [userId, "first_game_completed", at]);
}

export const CHECKED_ACTIVITY_MAX = 8000;
const checkedActivity = new Map<string, string>();

function rememberActivity(userId: string, day: string): void {
  if (checkedActivity.size >= CHECKED_ACTIVITY_MAX && !checkedActivity.has(userId)) {
    const today = getPackptsDayKey();
    for (const [id, seen] of checkedActivity) {
      if (seen !== today) checkedActivity.delete(id);
      if (checkedActivity.size < CHECKED_ACTIVITY_MAX / 2) break;
    }
    if (checkedActivity.size >= CHECKED_ACTIVITY_MAX) checkedActivity.clear();
  }
  checkedActivity.set(userId, day);
}

/**
 * Record day1_return or day7_return when this Chicago date is exactly that
 * offset from the signup date. The Chicago date is computed in Postgres from
 * a timestamptz, not from a naive timestamp.
 */
export async function noteGrowthActivity(userId: string | null | undefined, at = new Date()): Promise<void> {
  if (!userId) return;
  const found = await query(
    `SELECT cohort_day,
            to_char(COALESCE($2::timestamptz, now()) AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS activity_day
     FROM growth_lifecycle_events
     WHERE user_id = $1 AND event_type = 'signup'
     LIMIT 1`,
    [userId, at],
  );
  const cohortDay = asText(found.rows[0]?.cohort_day);
  const activityDay = asText(found.rows[0]?.activity_day) ?? getPackptsDayKey(at);
  if (!cohortDay) {
    rememberActivity(userId, activityDay);
    return;
  }
  if (checkedActivity.get(userId) === activityDay) return;
  const eventType = returnEventFor(cohortDay, activityDay);
  if (!eventType) {
    rememberActivity(userId, activityDay);
    return;
  }
  await query(GROWTH_EVENT_INSERT_SQL, [userId, eventType, at]);
  rememberActivity(userId, activityDay);
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
      `SELECT u.id, (u.created_at AT TIME ZONE 'UTC') AS created_at, u.is_admin, u.is_bot, u.is_test_account,
              s.occurred_at AS signup_at, s.provider, s.raw_utm_source, s.raw_utm_medium,
              s.raw_utm_campaign, s.raw_utm_content, s.referrer_host, s.landing_page, s.inferred,
              g.occurred_at AS first_game_at, d1.occurred_at AS day1_at, d7.occurred_at AS day7_at
       FROM users u
       LEFT JOIN growth_lifecycle_events s ON s.user_id = u.id AND s.event_type = 'signup'
       LEFT JOIN growth_lifecycle_events g ON g.user_id = u.id AND g.event_type = 'first_game_completed'
       LEFT JOIN growth_lifecycle_events d1 ON d1.user_id = u.id AND d1.event_type = 'day1_return'
       LEFT JOIN growth_lifecycle_events d7 ON d7.user_id = u.id AND d7.event_type = 'day7_return'
       WHERE (u.created_at AT TIME ZONE 'UTC') >= $1::timestamptz`,
      [baseline],
    ),
    query(
      `SELECT count(*)::int AS n
       FROM growth_lifecycle_events e
       JOIN users u ON u.id = e.user_id
       WHERE e.event_type = 'signup' AND (u.created_at AT TIME ZONE 'UTC') < $1::timestamptz`,
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
