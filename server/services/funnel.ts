/**
 * GTM funnel instrumentation (GTM audit, section 8).
 *
 * Writes: `visit` (server-side, on SPA HTML loads, with UTM), `first_answer`
 * (once per visitor or user), `game_complete` (mode + set) and
 * `beatme_share`, all into funnel_events. Every write is fire-and-forget and
 * can never break a page load or a game.
 *
 * Reads: buildFunnelReport() for GET /api/qa/funnel. Test, QA, staff (admin)
 * and bot accounts are excluded everywhere.
 */
import crypto from "crypto";
import type { Request, Response } from "express";
import { pool } from "../db";
import { QA_TEST_USER_ID } from "@shared/qaTestAccount";

export const VISITOR_COOKIE = "pp_vid";
const VISITOR_MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const BOT_UA = /(bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|curl|wget|python-requests|httpclient|headless|lighthouse|pingdom|uptime|monitor)/i;
const VID_RE = /^[a-f0-9]{32}$/;

export type FunnelEventType = "visit" | "first_answer" | "game_complete" | "beatme_share";

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function visitorIdFrom(req: Request): string | null {
  const v = readCookie(req, VISITOR_COOKIE);
  return v && VID_RE.test(v) ? v : null;
}

function clip(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

export function isBotRequest(req: Request): boolean {
  const ua = req.get("user-agent") || "";
  return !ua || BOT_UA.test(ua);
}

export function referrerHost(ref: string | undefined | null): string | null {
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.toLowerCase().replace(/^www\./, "");
    return host === "packpts.com" ? null : host.slice(0, 255);
  } catch {
    return null;
  }
}

function sessionUserId(req: Request): string | null {
  const r = req as any;
  return r.user?.claims?.sub || r.session?.localUserId || null;
}

/** Ensure the first-party visitor cookie. Returns the visitor id. Never throws. */
export function ensureVisitorCookie(req: Request, res: Response): string | null {
  try {
    const existing = visitorIdFrom(req);
    if (existing) return existing;
    const id = crypto.randomBytes(16).toString("hex");
    res.cookie(VISITOR_COOKIE, id, {
      maxAge: VISITOR_MAX_AGE_MS,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    (req as any)._ppVid = id;
    return id;
  } catch {
    return null;
  }
}

async function insertEvent(row: {
  eventType: FunnelEventType;
  visitorId: string | null;
  userId: string | null;
  mode?: string | null;
  gameSetId?: string | null;
  path?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  referrerHost?: string | null;
  isTest: boolean;
  onlyOnce?: boolean;
}): Promise<void> {
  const params = [
    row.eventType, row.visitorId, row.userId, row.mode ?? null, row.gameSetId ?? null, row.path ?? null,
    row.utmSource ?? null, row.utmMedium ?? null, row.utmCampaign ?? null, row.utmContent ?? null,
    row.referrerHost ?? null, row.isTest,
  ];
  if (row.onlyOnce) {
    // first_answer: skip when this visitor or this user already has one.
    await pool.query(
      `INSERT INTO funnel_events (event_type, visitor_id, user_id, mode, game_set_id, path, utm_source, utm_medium, utm_campaign, utm_content, referrer_host, is_test)
       SELECT $1::varchar,$2::varchar,$3::varchar,$4::varchar,$5::varchar,$6::varchar,$7::varchar,$8::varchar,$9::varchar,$10::varchar,$11::varchar,$12::boolean
       WHERE NOT EXISTS (
         SELECT 1 FROM funnel_events f WHERE f.event_type = $1::varchar
           AND (($2::varchar IS NOT NULL AND f.visitor_id = $2::varchar) OR ($3::varchar IS NOT NULL AND f.user_id = $3::varchar)))`,
      params,
    );
    return;
  }
  await pool.query(
    `INSERT INTO funnel_events (event_type, visitor_id, user_id, mode, game_set_id, path, utm_source, utm_medium, utm_campaign, utm_content, referrer_host, is_test)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    params,
  );
}

let excludedCache: { at: number; ids: Set<string> } = { at: 0, ids: new Set() };
async function isExcludedUser(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  if (userId === QA_TEST_USER_ID) return true;
  if (Date.now() - excludedCache.at > 5 * 60 * 1000) {
    try {
      const r = await pool.query(`SELECT id FROM users WHERE is_test_account OR is_admin OR is_bot`);
      excludedCache = { at: Date.now(), ids: new Set(r.rows.map((x: any) => x.id)) };
    } catch { /* keep previous */ }
  }
  return excludedCache.ids.has(userId);
}

/** Server-side landing visit (SPA HTML load). Sets pp_vid. Fire-and-forget. */
export function recordVisit(req: Request, res: Response): void {
  try {
    if (req.method !== "GET") return;
    const vid = ensureVisitorCookie(req, res);
    const bot = isBotRequest(req);
    const q = req.query as Record<string, unknown>;
    const userId = sessionUserId(req);
    void (async () => {
      const isTest = bot || (await isExcludedUser(userId));
      await insertEvent({
        eventType: "visit",
        visitorId: vid,
        userId,
        path: clip(req.path, 300),
        utmSource: clip(q.utm_source, 100),
        utmMedium: clip(q.utm_medium, 100),
        utmCampaign: clip(q.utm_campaign, 100),
        utmContent: clip(q.utm_content, 100),
        referrerHost: referrerHost(req.get("referer")),
        isTest,
      });
    })().catch(() => { /* never break a page load */ });
  } catch { /* ignore */ }
}

/** first_answer / game_complete / beatme_share. Fire-and-forget. */
export function recordFunnelEvent(
  req: Request,
  eventType: Exclude<FunnelEventType, "visit">,
  opts: { userId?: string | null; mode?: string | null; gameSetId?: string | null } = {},
): void {
  try {
    const vid = visitorIdFrom(req) ?? (req as any)._ppVid ?? null;
    const userId = opts.userId ?? sessionUserId(req);
    const bot = isBotRequest(req);
    void (async () => {
      const isTest = bot || (await isExcludedUser(userId));
      await insertEvent({
        eventType,
        visitorId: vid,
        userId,
        mode: clip(opts.mode, 20),
        gameSetId: clip(opts.gameSetId, 64),
        isTest,
        onlyOnce: eventType === "first_answer",
      });
    })().catch(() => { /* never break gameplay */ });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const EXCLUDED_USERS_SQL = `SELECT id FROM users WHERE is_test_account OR is_admin OR is_bot OR id = '${QA_TEST_USER_ID}'`;
const TS = (col: string) => `(CASE WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN ${col}::timestamptz END)`;
const CT = (col: string) => `((${col}) AT TIME ZONE 'America/Chicago')::date`;

/** Distinct (actor, CT day) activity: registered users and guest (anon) players. */
const ACTIVITY_SQL = `
  excluded AS (${EXCLUDED_USERS_SQL}),
  act AS (
    SELECT 'u:' || gs.user_id AS actor, ${TS("gs.started_at")} AS at
      FROM game_sessions gs WHERE gs.user_id IS NOT NULL AND gs.user_id NOT IN (SELECT id FROM excluded)
    UNION ALL
    SELECT 'u:' || dce.user_id, dce.started_at FROM daily_challenge_entries dce WHERE dce.user_id NOT IN (SELECT id FROM excluded)
    UNION ALL
    SELECT 'a:' || c.anon_player_id, c.created_at FROM anon_game_credits c
    UNION ALL
    SELECT 'a:' || r.anon_player_id, r.started_at FROM anon_daily_runs r
  ),
  days AS (SELECT DISTINCT actor, ${CT("at")} AS d FROM act WHERE at IS NOT NULL)`;

export interface FunnelReport {
  generatedAt: string;
  timezone: "America/Chicago";
  windowDays: number;
  definitions: Record<string, string>;
  activity: {
    dau: { date: string; total: number; registered: number; guests: number }[];
    dauToday: number;
    dau7dAvg: number;
    wau: number;
    mau: number;
  };
  retention: {
    cohorts: { date: string; size: number; d1: number | null; d7: number | null; d30: number | null }[];
    overall: { d1: Rate; d7: Rate; d30: Rate };
  };
  visitToFirstAnswer: Rate & { loggingSince: string | null; byUtmSource: { source: string; visitors: number; answered: number }[] };
  gameComplete: {
    byMode: { mode: string; count: number }[];
    bySet: { gameSetId: string | null; setName: string | null; count: number }[];
    historicalByMode: { mode: string; count: number }[];
  };
  guestToRegistered: { guestPlayers: number; claimed: number; rate: number | null; registeredSignups: number };
  beatMe: { shares: number; linkClicks: number; opens: number; openVisitorsWhoPlayed: number; signups: number };
  signupsBySource: Record<string, number> | null;
}

export interface Rate { numerator: number; denominator: number; rate: number | null }
const rate = (n: number, d: number): Rate => ({ numerator: n, denominator: d, rate: d > 0 ? Math.round((n / d) * 1000) / 1000 : null });
const num = (v: unknown) => Number(v ?? 0) || 0;

export type FunnelQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export async function buildFunnelReport(windowDays: number, q: FunnelQuery = (t, p) => pool.query(t, p as any[]), signupsBySource: Record<string, number> | null = null): Promise<FunnelReport> {
  const days = Math.max(1, Math.min(120, Math.floor(windowDays) || 30));
  const since = `((now() AT TIME ZONE 'America/Chicago')::date - ${days - 1})`;

  const dauRows = (await q(`WITH ${ACTIVITY_SQL}
    SELECT d::text AS date, count(*)::int AS total,
      count(*) FILTER (WHERE actor LIKE 'u:%')::int AS registered,
      count(*) FILTER (WHERE actor LIKE 'a:%')::int AS guests
    FROM days WHERE d >= ${since} GROUP BY d ORDER BY d`)).rows;

  const [agg] = (await q(`WITH ${ACTIVITY_SQL}, today AS (SELECT (now() AT TIME ZONE 'America/Chicago')::date AS t)
    SELECT
      (SELECT count(DISTINCT actor) FROM days, today WHERE d = t)::int AS dau_today,
      (SELECT count(DISTINCT actor) FROM days, today WHERE d > t - 7)::int AS wau,
      (SELECT count(DISTINCT actor) FROM days, today WHERE d > t - 30)::int AS mau,
      (SELECT count(*) FROM days, today WHERE d > t - 7)::numeric / 7 AS dau7`)).rows;

  const cohortRows = (await q(`WITH ${ACTIVITY_SQL},
    first AS (SELECT actor, min(d) AS c FROM days GROUP BY actor),
    today AS (SELECT (now() AT TIME ZONE 'America/Chicago')::date AS t)
    SELECT f.c::text AS date, count(*)::int AS size,
      CASE WHEN f.c + 1 <= t THEN count(*) FILTER (WHERE EXISTS (SELECT 1 FROM days x WHERE x.actor = f.actor AND x.d = f.c + 1)) END::int AS d1,
      CASE WHEN f.c + 7 <= t THEN count(*) FILTER (WHERE EXISTS (SELECT 1 FROM days x WHERE x.actor = f.actor AND x.d = f.c + 7)) END::int AS d7,
      CASE WHEN f.c + 30 <= t THEN count(*) FILTER (WHERE EXISTS (SELECT 1 FROM days x WHERE x.actor = f.actor AND x.d = f.c + 30)) END::int AS d30
    FROM first f, today WHERE f.c >= t - 90 GROUP BY f.c, t ORDER BY f.c`)).rows;
  const sumMatured = (k: "d1" | "d7" | "d30") => {
    let n = 0; let d = 0;
    for (const r of cohortRows) if (r[k] != null) { n += num(r[k]); d += num(r.size); }
    return rate(n, d);
  };

  const [v2a] = (await q(`WITH v AS (
      SELECT DISTINCT visitor_id FROM funnel_events WHERE event_type = 'visit' AND NOT is_test AND visitor_id IS NOT NULL AND created_at >= ${since}),
    a AS (SELECT DISTINCT visitor_id FROM funnel_events WHERE event_type = 'first_answer' AND NOT is_test AND visitor_id IS NOT NULL)
    SELECT (SELECT count(*) FROM v)::int AS visitors,
      (SELECT count(*) FROM v WHERE visitor_id IN (SELECT visitor_id FROM a))::int AS answered,
      (SELECT min(created_at) FROM funnel_events)::text AS since`)).rows;
  const bySrc = (await q(`WITH fv AS (
      SELECT DISTINCT ON (visitor_id) visitor_id, coalesce(lower(utm_source), CASE WHEN referrer_host IS NOT NULL THEN 'ref:' || referrer_host ELSE 'direct' END) AS source
      FROM funnel_events WHERE event_type = 'visit' AND NOT is_test AND visitor_id IS NOT NULL AND created_at >= ${since}
      ORDER BY visitor_id, created_at)
    SELECT source, count(*)::int AS visitors,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM funnel_events f WHERE f.event_type = 'first_answer' AND f.visitor_id = fv.visitor_id))::int AS answered
    FROM fv GROUP BY source ORDER BY visitors DESC LIMIT 25`)).rows;

  const gcMode = (await q(`SELECT coalesce(mode, 'unknown') AS mode, count(*)::int AS count FROM funnel_events
    WHERE event_type = 'game_complete' AND NOT is_test AND created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC`)).rows;
  const gcSet = (await q(`SELECT f.game_set_id, gs.set_name, count(*)::int AS count FROM funnel_events f
    LEFT JOIN game_sets gs ON gs.id = f.game_set_id
    WHERE f.event_type = 'game_complete' AND NOT f.is_test AND f.created_at >= ${since} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50`)).rows;
  const gcHist = (await q(`WITH excluded AS (${EXCLUDED_USERS_SQL})
    SELECT mode, count(*)::int AS count FROM game_sessions
    WHERE status = 'completed' AND (user_id IS NULL OR user_id NOT IN (SELECT id FROM excluded))
      AND ${TS("completed_at")} >= ${since} GROUP BY 1 ORDER BY 2 DESC`)).rows;

  const [g2r] = (await q(`WITH excluded AS (${EXCLUDED_USERS_SQL})
    SELECT
      (SELECT count(*) FROM anon_players WHERE created_at >= ${since} AND (games_started > 0 OR games_completed > 0 OR daily5_completed > 0))::int AS guests,
      (SELECT count(*) FROM anon_players WHERE created_at >= ${since} AND claimed_by_user_id IS NOT NULL
         AND claimed_by_user_id NOT IN (SELECT id FROM excluded))::int AS claimed,
      (SELECT count(*) FROM users WHERE created_at >= ${since} AND id NOT IN (SELECT id FROM excluded))::int AS signups`)).rows;

  const [bm] = (await q(`WITH excluded AS (${EXCLUDED_USERS_SQL}),
    opens AS (SELECT DISTINCT visitor_id FROM funnel_events WHERE event_type = 'visit' AND NOT is_test AND lower(utm_medium) = 'beatme' AND created_at >= ${since})
    SELECT
      ((SELECT count(*) FROM funnel_events WHERE event_type = 'beatme_share' AND NOT is_test AND created_at >= ${since})
        + (SELECT count(*) FROM referral_links rl WHERE rl.purpose = 'DAILY5_CHALLENGE' AND rl.created_at >= ${since}
             AND rl.created_by_user_id NOT IN (SELECT id FROM excluded)
             AND NOT EXISTS (SELECT 1 FROM funnel_events f WHERE f.event_type = 'beatme_share')))::int AS shares,
      (SELECT coalesce(sum(click_count), 0) FROM referral_links rl WHERE rl.purpose = 'DAILY5_CHALLENGE' AND rl.created_at >= ${since}
         AND rl.created_by_user_id NOT IN (SELECT id FROM excluded))::int AS clicks,
      (SELECT count(*) FROM opens)::int AS opens,
      (SELECT count(*) FROM opens WHERE visitor_id IN (SELECT visitor_id FROM funnel_events WHERE event_type IN ('first_answer', 'game_complete')))::int AS played,
      (SELECT count(DISTINCT ra.invited_user_id) FROM referral_attributions ra JOIN referral_links rl ON rl.id = ra.referral_link_id
         WHERE ra.event_type = 'SIGNUP' AND rl.purpose = 'DAILY5_CHALLENGE' AND ra.created_at >= ${since}
           AND ra.invited_user_id NOT IN (SELECT id FROM excluded))::int AS signups`)).rows;

  const dau7 = Math.round(num(agg?.dau7) * 10) / 10;
  return {
    generatedAt: new Date().toISOString(),
    timezone: "America/Chicago",
    windowDays: days,
    definitions: {
      actor: "A registered user (game_sessions, daily_challenge_entries) or a guest anon player (anon_game_credits, anon_daily_runs). Test, QA, staff (is_admin) and bot accounts are excluded.",
      dau: "Distinct actors active on a CT calendar day. dau7dAvg is the mean of the last 7 CT days including today.",
      retention: "Cohort = first active CT day. dN = cohort members active exactly N days later. Null until the cohort is N days old. overall sums matured cohorts from the last 90 days.",
      visitToFirstAnswer: "Distinct pp_vid visitors with a server-side visit in the window who have a first_answer. Only counts since visit logging started (loggingSince).",
      gameComplete: "byMode and bySet from funnel_events (since logging started). historicalByMode from completed game_sessions in the window.",
      guestToRegistered: "Denominator: anon players created in the window who started or finished a game. Numerator: those claimed by a real account.",
      beatMe: "shares: Beat-me links created. linkClicks: referral link click_count. opens: visitors landing with utm_medium=beatme. openVisitorsWhoPlayed: opens with a first_answer or game_complete. signups: SIGNUP attributions on Beat-me links.",
    },
    activity: {
      dau: dauRows.map((r) => ({ date: r.date, total: num(r.total), registered: num(r.registered), guests: num(r.guests) })),
      dauToday: num(agg?.dau_today),
      dau7dAvg: dau7,
      wau: num(agg?.wau),
      mau: num(agg?.mau),
    },
    retention: {
      cohorts: cohortRows.map((r) => ({ date: r.date, size: num(r.size), d1: r.d1 == null ? null : num(r.d1), d7: r.d7 == null ? null : num(r.d7), d30: r.d30 == null ? null : num(r.d30) })),
      overall: { d1: sumMatured("d1"), d7: sumMatured("d7"), d30: sumMatured("d30") },
    },
    visitToFirstAnswer: {
      ...rate(num(v2a?.answered), num(v2a?.visitors)),
      loggingSince: v2a?.since ?? null,
      byUtmSource: bySrc.map((r) => ({ source: r.source, visitors: num(r.visitors), answered: num(r.answered) })),
    },
    gameComplete: {
      byMode: gcMode.map((r) => ({ mode: r.mode, count: num(r.count) })),
      bySet: gcSet.map((r) => ({ gameSetId: r.game_set_id ?? null, setName: r.set_name ?? null, count: num(r.count) })),
      historicalByMode: gcHist.map((r) => ({ mode: r.mode, count: num(r.count) })),
    },
    guestToRegistered: {
      guestPlayers: num(g2r?.guests),
      claimed: num(g2r?.claimed),
      rate: num(g2r?.guests) > 0 ? Math.round((num(g2r?.claimed) / num(g2r?.guests)) * 1000) / 1000 : null,
      registeredSignups: num(g2r?.signups),
    },
    beatMe: { shares: num(bm?.shares), linkClicks: num(bm?.clicks), opens: num(bm?.opens), openVisitorsWhoPlayed: num(bm?.played), signups: num(bm?.signups) },
    signupsBySource,
  };
}
