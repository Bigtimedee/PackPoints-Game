/**
 * Correlated counts for public / my-sets surfaces.
 *
 * Do not interpolate `${gameSets.id}` inside drizzle `sql` templates here.
 * Drizzle rebinds that column as a query parameter (not a correlated
 * `game_sets.id` reference), so COUNT(*) comes back 0 even when
 * playable_cards rows exist. Browse (`GET /api/sets`) already uses the
 * raw identifier and is the working source of truth.
 */
import { sql } from "drizzle-orm";

export const userSetCardCountSql = sql<number>`(
  SELECT COUNT(*)::int FROM playable_cards pc
  WHERE pc.game_set_id = game_sets.id AND pc.is_playable = true
)`;

export const userSetPlayCountSql = sql<number>`(
  SELECT COUNT(*)::int FROM game_sessions
  WHERE (questions->0->'card'->>'gameSetId') = game_sets.id
    AND status = 'completed'
)`;
