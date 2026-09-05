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
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

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
}): { makers30d: number; mau30d: number; makerRate: number } {
  const windowMs = opts.windowMs ?? 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(opts.now.getTime() - windowMs);
  const staffIds = new Set(
    opts.users.filter((u) => u.is_admin).map((u) => u.id),
  );

  const makers = new Set<string>();
  for (const s of opts.sets) {
    if (!s.is_user_created) continue;
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
    ) AS mau_30d
`;

export async function fetchMakerRateMetrics(): Promise<{
  makers30d: number;
  mau30d: number;
  makerRate: number;
}> {
  const result = await db.execute(MAKER_RATE_SQL);
  const row = (result.rows[0] as any) ?? {};
  const makers30d = Number(row.makers_30d ?? 0);
  const mau30d = Number(row.mau_30d ?? 0);
  return {
    makers30d,
    mau30d,
    makerRate: computeMakerRate(makers30d, mau30d),
  };
}
