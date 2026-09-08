/**
 * Making Layer admin metrics — Maker Rate definition.
 *
 * Maker Rate = makers_30d / mau_30d
 *   makers_30d: DISTINCT non-admin creators (created_by_user_id ∪ co_creator_user_id)
 *               with ≥1 is_user_created set in last 30d
 *   mau_30d:    DISTINCT non-admin users with ≥1 event_log row in last 30d
 *               (same activity source as admin DAU in adminService.getMetrics)
 *
 * Staff (users.is_admin = true) are excluded from both numerator and denominator.
 *
 * Admin-only companion field `publishedSetsNonStaff`: lifetime COUNT of
 * is_user_created game_sets whose created_by_user_id is a non-admin user.
 * Used to verify the diligence ≥10 published-set gate. Not a public metric.
 *
 * Maker-supply funnel (event_log): /make start → identify → publish → share
 * generated → /sets/:id view. Same staff exclusion (users.is_admin). Admin-only.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  MAKING_FUNNEL_EVENT_TYPES,
  MAKING_FUNNEL_SUCCESS_STEPS,
  MAKING_LAYER_EVENTS,
  type MakingLayerEventType,
} from "./makingLayerEvents";

export const MAKER_RATE_WINDOW = "30 days";

/** Pure rate helper — keeps UI/API decimal contract (0–1). */
export function computeMakerRate(makers30d: number, mau30d: number): number {
  if (!Number.isFinite(makers30d) || !Number.isFinite(mau30d) || mau30d <= 0) {
    return 0;
  }
  return makers30d / mau30d;
}

/**
 * In-memory mirror of the Maker Rate SQL filters.
 * Used by unit/SQL-fixture tests so period alignment + staff exclusion stay proven
 * without requiring a live DB in CI.
 */
export interface MakerRateFixtureSet {
  created_by_user_id: string | null;
  co_creator_user_id?: string | null;
  is_user_created: boolean;
  created_at: Date;
}

export interface MakerRateFixtureEvent {
  user_id: string | null;
  created_at: Date;
}

export interface MakerRateFixtureUser {
  id: string;
  is_admin: boolean;
}

export function computeMakerRateFromFixture(opts: {
  now: Date;
  sets: MakerRateFixtureSet[];
  events: MakerRateFixtureEvent[];
  users: MakerRateFixtureUser[];
  windowMs?: number;
}): {
  makers30d: number;
  mau30d: number;
  makerRate: number;
  publishedSetsNonStaff: number;
} {
  const windowMs = opts.windowMs ?? 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(opts.now.getTime() - windowMs);
  const staffIds = new Set(
    opts.users.filter((u) => u.is_admin).map((u) => u.id),
  );

  const makers = new Set<string>();
  let publishedSetsNonStaff = 0;
  for (const s of opts.sets) {
    if (!s.is_user_created) continue;
    const creatorId = s.created_by_user_id;
    if (creatorId && !staffIds.has(creatorId)) {
      publishedSetsNonStaff += 1;
    }
    if (s.created_at < cutoff) continue;
    for (const uid of [s.created_by_user_id, s.co_creator_user_id ?? null]) {
      if (!uid) continue;
      if (staffIds.has(uid)) continue;
      makers.add(uid);
    }
  }

  const mau = new Set<string>();
  for (const e of opts.events) {
    if (!e.user_id) continue;
    if (e.created_at < cutoff) continue;
    if (staffIds.has(e.user_id)) continue;
    mau.add(e.user_id);
  }

  const makers30d = makers.size;
  const mau30d = mau.size;
  return {
    makers30d,
    mau30d,
    makerRate: computeMakerRate(makers30d, mau30d),
    publishedSetsNonStaff,
  };
}

/** Authoritative SQL for admin Making Layer Maker Rate (period-aligned, staff-excluded). */
export const MAKER_RATE_SQL = sql`
  SELECT
    (
      SELECT COUNT(DISTINCT maker_id)::float
      FROM (
        SELECT gs.created_by_user_id AS maker_id
        FROM game_sets gs
        INNER JOIN users u ON u.id = gs.created_by_user_id
        WHERE gs.is_user_created = true
          AND gs.created_at >= NOW() - INTERVAL '30 days'
          AND COALESCE(u.is_admin, false) = false
        UNION
        SELECT gs.co_creator_user_id AS maker_id
        FROM game_sets gs
        INNER JOIN users u ON u.id = gs.co_creator_user_id
        WHERE gs.is_user_created = true
          AND gs.co_creator_user_id IS NOT NULL
          AND gs.created_at >= NOW() - INTERVAL '30 days'
          AND COALESCE(u.is_admin, false) = false
      ) makers
    ) AS makers_30d,
    (
      SELECT COUNT(DISTINCT el.user_id)::float
      FROM event_log el
      INNER JOIN users u ON u.id = el.user_id
      WHERE el.created_at >= NOW() - INTERVAL '30 days'
        AND el.user_id IS NOT NULL
        AND COALESCE(u.is_admin, false) = false
    ) AS mau_30d,
    (
      SELECT COUNT(*)::float
      FROM game_sets gs
      INNER JOIN users u ON u.id = gs.created_by_user_id
      WHERE gs.is_user_created = true
        AND COALESCE(u.is_admin, false) = false
    ) AS published_sets_non_staff
`;

export async function fetchMakerRateMetrics(): Promise<{
  makers30d: number;
  mau30d: number;
  makerRate: number;
  publishedSetsNonStaff: number;
}> {
  const result = await db.execute(MAKER_RATE_SQL);
  const row = (result.rows[0] as any) ?? {};
  const makers30d = Number(row.makers_30d ?? 0);
  const mau30d = Number(row.mau_30d ?? 0);
  return {
    makers30d,
    mau30d,
    makerRate: computeMakerRate(makers30d, mau30d),
    publishedSetsNonStaff: Number(row.published_sets_non_staff ?? 0),
  };
}

/** Diligence gate: ≥10 real non-staff published /make sets. Admin-only. */
export const MAKER_SUPPLY_GATE_TARGET = 10;

export interface MakerSupplyGate {
  publishedSetsNonStaff: number;
  target: number;
  remaining: number;
  progress: number;
  reached: boolean;
}

export function computeMakerSupplyGate(publishedSetsNonStaff: number): MakerSupplyGate {
  const count = Number.isFinite(publishedSetsNonStaff) ? Math.max(0, publishedSetsNonStaff) : 0;
  const target = MAKER_SUPPLY_GATE_TARGET;
  return {
    publishedSetsNonStaff: count,
    target,
    remaining: Math.max(0, target - count),
    progress: target <= 0 ? 1 : Math.min(1, count / target),
    reached: count >= target,
  };
}

export interface MakingFunnelStep {
  eventType: MakingLayerEventType;
  events: number;
  uniqueUsers: number;
  conversionFromPrev: number | null;
}

export interface MakingFunnelDropOff {
  from: MakingLayerEventType;
  to: MakingLayerEventType;
  lostUsers: number;
  lostEvents: number;
}

export interface MakingFrictionTimeToPublish {
  p50Ms: number | null;
  p90Ms: number | null;
  samples: number;
}

/** Design MAKE_FRICTION KPIs — admin-only, staff-excluded. */
export interface MakingFrictionKpis {
  identifyFailRate: number;
  identifyAttempts: number;
  timeToPublish: MakingFrictionTimeToPublish;
  nameMixtape: {
    reachedUsers: number;
    publishedUsers: number;
    dropOffUsers: number;
    dropOffRate: number;
  };
  shareOpen: {
    openedUsers: number;
    publishedUsers: number;
    openRate: number;
  };
}

export interface MakingFunnelWindow {
  windowDays: 7 | 30;
  steps: MakingFunnelStep[];
  fails: {
    identifyFail: { events: number; uniqueUsers: number };
    publishFail: { events: number; uniqueUsers: number };
  };
  topDropOff: MakingFunnelDropOff | null;
  friction: MakingFrictionKpis;
}

export interface MakingFunnelFixtureEvent {
  event_type: string;
  user_id: string | null;
  created_at: Date;
}

export interface FunnelCountRow {
  event_type: string;
  events: number;
  unique_users: number;
}

export function percentileMs(sorted: number[], p: number): number | null {
  if (sorted.length === 0 || !Number.isFinite(p) || p < 0 || p > 1) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function assembleFrictionKpis(
  counts: {
    identifySuccess: { events: number; uniqueUsers: number };
    identifyFail: { events: number; uniqueUsers: number };
    nameStarted: { events: number; uniqueUsers: number };
    publishSuccess: { events: number; uniqueUsers: number };
    shareOpened: { events: number; uniqueUsers: number };
  },
  timeToPublish: MakingFrictionTimeToPublish,
): MakingFrictionKpis {
  const identifyAttempts = counts.identifySuccess.events + counts.identifyFail.events;
  const identifyFailRate = identifyAttempts > 0 ? counts.identifyFail.events / identifyAttempts : 0;
  const reachedUsers = counts.nameStarted.uniqueUsers;
  const publishedUsers = counts.publishSuccess.uniqueUsers;
  const dropOffUsers = Math.max(0, reachedUsers - publishedUsers);
  return {
    identifyFailRate,
    identifyAttempts,
    timeToPublish,
    nameMixtape: {
      reachedUsers,
      publishedUsers,
      dropOffUsers,
      dropOffRate: reachedUsers > 0 ? dropOffUsers / reachedUsers : 0,
    },
    shareOpen: {
      openedUsers: counts.shareOpened.uniqueUsers,
      publishedUsers,
      openRate: publishedUsers > 0 ? counts.shareOpened.uniqueUsers / publishedUsers : 0,
    },
  };
}

/** Pure funnel assembly — same staff-exclusion + conversion rules as the SQL. */
export function assembleMakingFunnelWindow(
  windowDays: 7 | 30,
  rows: FunnelCountRow[],
  timeToPublish: MakingFrictionTimeToPublish = { p50Ms: null, p90Ms: null, samples: 0 },
): MakingFunnelWindow {
  const byType = new Map<string, FunnelCountRow>();
  for (const row of rows) {
    byType.set(row.event_type, {
      event_type: row.event_type,
      events: Number(row.events ?? 0),
      unique_users: Number(row.unique_users ?? 0),
    });
  }

  const counts = (eventType: string) => {
    const row = byType.get(eventType);
    return {
      events: row?.events ?? 0,
      uniqueUsers: row?.unique_users ?? 0,
    };
  };

  const steps: MakingFunnelStep[] = [];
  for (let i = 0; i < MAKING_FUNNEL_SUCCESS_STEPS.length; i++) {
    const eventType = MAKING_FUNNEL_SUCCESS_STEPS[i];
    const { events, uniqueUsers } = counts(eventType);
    let conversionFromPrev: number | null = null;
    if (i > 0) {
      const prevUsers = steps[i - 1].uniqueUsers;
      conversionFromPrev = prevUsers > 0 ? uniqueUsers / prevUsers : 0;
    }
    steps.push({ eventType, events, uniqueUsers, conversionFromPrev });
  }

  let topDropOff: MakingFunnelDropOff | null = null;
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const next = steps[i];
    if (prev.uniqueUsers === 0 && prev.events === 0 && next.uniqueUsers === 0 && next.events === 0) {
      continue;
    }
    const lostUsers = Math.max(0, prev.uniqueUsers - next.uniqueUsers);
    const lostEvents = Math.max(0, prev.events - next.events);
    const candidate: MakingFunnelDropOff = {
      from: prev.eventType,
      to: next.eventType,
      lostUsers,
      lostEvents,
    };
    if (!topDropOff) {
      topDropOff = candidate;
      continue;
    }
    if (candidate.lostUsers > topDropOff.lostUsers) {
      topDropOff = candidate;
    } else if (candidate.lostUsers === topDropOff.lostUsers && candidate.lostEvents > topDropOff.lostEvents) {
      topDropOff = candidate;
    }
  }

  return {
    windowDays,
    steps,
    fails: {
      identifyFail: counts(MAKING_LAYER_EVENTS.identifyFail),
      publishFail: counts(MAKING_LAYER_EVENTS.publishFail),
    },
    topDropOff,
    friction: assembleFrictionKpis(
      {
        identifySuccess: counts(MAKING_LAYER_EVENTS.identifySuccess),
        identifyFail: counts(MAKING_LAYER_EVENTS.identifyFail),
        nameStarted: counts(MAKING_LAYER_EVENTS.nameStarted),
        publishSuccess: counts(MAKING_LAYER_EVENTS.publishSuccess),
        shareOpened: counts(MAKING_LAYER_EVENTS.shareOpened),
      },
      timeToPublish,
    ),
  };
}

export function computeMakingFunnelFromFixture(opts: {
  now: Date;
  events: MakingFunnelFixtureEvent[];
  users: MakerRateFixtureUser[];
  windowDays: 7 | 30;
}): MakingFunnelWindow {
  const cutoff = new Date(opts.now.getTime() - opts.windowDays * 24 * 60 * 60 * 1000);
  const staffIds = new Set(opts.users.filter((u) => u.is_admin).map((u) => u.id));
  const allowed = new Set<string>(MAKING_FUNNEL_EVENT_TYPES);

  const grouped = new Map<string, { events: number; users: Set<string> }>();
  for (const type of MAKING_FUNNEL_EVENT_TYPES) {
    grouped.set(type, { events: 0, users: new Set() });
  }

  for (const event of opts.events) {
    if (!allowed.has(event.event_type as MakingLayerEventType)) continue;
    if (event.created_at < cutoff) continue;
    if (event.user_id && staffIds.has(event.user_id)) continue;
    const bucket = grouped.get(event.event_type);
    if (!bucket) continue;
    bucket.events += 1;
    if (event.user_id) bucket.users.add(event.user_id);
  }

  const rows: FunnelCountRow[] = [...grouped.entries()].map(([event_type, bucket]) => ({
    event_type,
    events: bucket.events,
    unique_users: bucket.users.size,
  }));

  const elapsed: number[] = [];
  const publishes = opts.events.filter((e) => {
    if (e.event_type !== MAKING_LAYER_EVENTS.publishSuccess) return false;
    if (e.created_at < cutoff) return false;
    if (!e.user_id || staffIds.has(e.user_id)) return false;
    return true;
  });
  for (const publish of publishes) {
    const starts = opts.events.filter((e) => {
      if (e.event_type !== MAKING_LAYER_EVENTS.makeStarted) return false;
      if (e.user_id !== publish.user_id) return false;
      if (e.created_at > publish.created_at) return false;
      if (e.created_at < cutoff) return false;
      return true;
    });
    if (starts.length === 0) continue;
    const start = starts.reduce((latest, e) => (e.created_at > latest.created_at ? e : latest));
    elapsed.push(publish.created_at.getTime() - start.created_at.getTime());
  }
  elapsed.sort((a, b) => a - b);

  return assembleMakingFunnelWindow(opts.windowDays, rows, {
    p50Ms: percentileMs(elapsed, 0.5),
    p90Ms: percentileMs(elapsed, 0.9),
    samples: elapsed.length,
  });
}

/** Authoritative SQL: Making Layer funnel counts, staff-excluded (users.is_admin). */
export function makingFunnelSql(windowDays: 7 | 30) {
  return sql`
    SELECT
      el.event_type,
      COUNT(*)::int AS events,
      COUNT(DISTINCT el.user_id)::int AS unique_users
    FROM event_log el
    LEFT JOIN users u ON u.id = el.user_id
    WHERE el.created_at >= NOW() - (${windowDays}::text || ' days')::interval
      AND el.event_type IN (
        'make_started',
        'identify_success',
        'identify_fail',
        'name_started',
        'publish_success',
        'publish_fail',
        'share_generated',
        'share_opened',
        'set_viewed'
      )
      AND COALESCE(u.is_admin, false) = false
    GROUP BY el.event_type
  `;
}

/** Last make_started → publish_success per user in-window; staff excluded. */
export function makingTimeToPublishSql(windowDays: 7 | 30) {
  return sql`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (p.created_at - s.started_at)) * 1000
      ) AS p50_ms,
      percentile_cont(0.9) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (p.created_at - s.started_at)) * 1000
      ) AS p90_ms,
      COUNT(*)::int AS samples
    FROM event_log p
    INNER JOIN users u ON u.id = p.user_id
    INNER JOIN LATERAL (
      SELECT el.created_at AS started_at
      FROM event_log el
      WHERE el.event_type = 'make_started'
        AND el.user_id = p.user_id
        AND el.created_at <= p.created_at
        AND el.created_at >= NOW() - (${windowDays}::text || ' days')::interval
      ORDER BY el.created_at DESC
      LIMIT 1
    ) s ON true
    WHERE p.event_type = 'publish_success'
      AND p.created_at >= NOW() - (${windowDays}::text || ' days')::interval
      AND p.user_id IS NOT NULL
      AND COALESCE(u.is_admin, false) = false
  `;
}

function timeToPublishFromRow(row: unknown): MakingFrictionTimeToPublish {
  const r = (row ?? {}) as { p50_ms?: unknown; p90_ms?: unknown; samples?: unknown };
  const samples = Number(r.samples ?? 0);
  const p50 = r.p50_ms == null ? null : Number(r.p50_ms);
  const p90 = r.p90_ms == null ? null : Number(r.p90_ms);
  return {
    p50Ms: Number.isFinite(p50) ? p50 : null,
    p90Ms: Number.isFinite(p90) ? p90 : null,
    samples: Number.isFinite(samples) ? samples : 0,
  };
}

export async function fetchMakingFunnelWindows(): Promise<{
  last7d: MakingFunnelWindow;
  last30d: MakingFunnelWindow;
}> {
  const [rows7, rows30, ttp7, ttp30] = await Promise.all([
    db.execute(makingFunnelSql(7)),
    db.execute(makingFunnelSql(30)),
    db.execute(makingTimeToPublishSql(7)),
    db.execute(makingTimeToPublishSql(30)),
  ]);
  return {
    last7d: assembleMakingFunnelWindow(
      7,
      ((rows7.rows as unknown) as FunnelCountRow[]) ?? [],
      timeToPublishFromRow(ttp7.rows[0]),
    ),
    last30d: assembleMakingFunnelWindow(
      30,
      ((rows30.rows as unknown) as FunnelCountRow[]) ?? [],
      timeToPublishFromRow(ttp30.rows[0]),
    ),
  };
}

