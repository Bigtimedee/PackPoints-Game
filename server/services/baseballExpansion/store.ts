/**
 * Original submitted pool and later health checks. The submission row is
 * insert-once. Card ids only: no player names and no source URLs.
 */
import { pool } from "../../db";
import type { StoredHealth } from "./health";

export async function recordSubmissionIfAbsent(input: {
  setId: string;
  slug: string;
  originalCount: number;
  manifestSha256: string;
  cardIds: string[];
}): Promise<void> {
  await pool.query(
    `INSERT INTO design_pool_submissions (set_id, slug, original_count, manifest_sha256, card_ids)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (set_id) DO NOTHING`,
    [input.setId, input.slug, input.originalCount, input.manifestSha256, JSON.stringify(input.cardIds)],
  );
}

export async function recordHealthCheck(input: StoredHealth & { setId: string }): Promise<void> {
  await pool.query(
    `INSERT INTO design_pool_health_checks (set_id, original_count, passed_count, released_count, verdict)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.setId, input.originalCount, input.passedCount, input.releasedCount, input.verdict],
  );
}

export async function readSubmissionCount(setId: string): Promise<number | null> {
  const rows = await pool.query<{ original_count: number }>(
    "SELECT original_count FROM design_pool_submissions WHERE set_id = $1",
    [setId],
  );
  const row = rows.rows[0];
  return row ? Number(row.original_count) : null;
}

export async function readLatestExpansionHealth(setId: string): Promise<StoredHealth | null> {
  const rows = await pool.query<{ original_count: number; passed_count: number; released_count: number; verdict: string }>(
    `SELECT original_count, passed_count, released_count, verdict
     FROM design_pool_health_checks WHERE set_id = $1
     ORDER BY checked_at DESC, id DESC LIMIT 1`,
    [setId],
  );
  const row = rows.rows[0];
  if (!row) return null;
  return {
    originalCount: Number(row.original_count),
    passedCount: Number(row.passed_count),
    releasedCount: Number(row.released_count),
    verdict: row.verdict,
  };
}
