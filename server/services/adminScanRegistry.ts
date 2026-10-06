import { randomUUID } from "node:crypto";
import { emptyScanReport, type AdminScanKind, type ScanReport } from "./adminScanCore";
// Small structural interface allows isolated SQL/claim tests without production DB imports.
export interface JobPool { query: (sql: string, values: unknown[]) => Promise<{ rows: JobRow[] }> }
export interface AdminScanJob {
  id: string; setId: string; kind: AdminScanKind; requestId: string; autoQuarantine: boolean;
  status: "running" | "completed" | "failed" | "interrupted";
  report: ScanReport; updatedAt: string; error: string | null;
}
export interface JobRow {
  id: string; set_id: string; kind: AdminScanKind; request_id: string; auto_quarantine: boolean;
  status: "running" | "completed" | "failed"; report: ScanReport; updated_at: Date; error: string | null;
}
const STALE_MS = 10 * 60 * 1000;
export function mapAdminScanJob(row: JobRow): AdminScanJob {
  const stale = row.status === "running" && Date.now() - row.updated_at.getTime() > STALE_MS;
  return { id: row.id, setId: row.set_id, kind: row.kind, requestId: row.request_id,
    autoQuarantine: row.auto_quarantine, status: stale ? "interrupted" : row.status,
    report: row.report, updatedAt: row.updated_at.toISOString(),
    error: stale ? "Progress is stale. Card changes may have occurred. Reconcile this job before starting another; do not retry it." : row.error };
}
export async function claimAdminScan(pool: JobPool, schedule: (job: AdminScanJob) => void, setId: string, kind: AdminScanKind, requestId: string,
  autoQuarantine: boolean, actor: string): Promise<AdminScanJob> {
  // DB uniqueness (including a partial index on running set_id) works across workers/replicas.
  // Reusing a request ID returns its original result forever, never re-executes a mutation.
  const id = randomUUID();
  let inserted: JobRow | undefined;
  try {
    const result = await pool.query(`INSERT INTO admin_card_scan_jobs
      (id, set_id, kind, request_id, auto_quarantine, actor_id, report)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
      [id, setId, kind, requestId, autoQuarantine, actor, JSON.stringify(emptyScanReport())]);
    inserted = result.rows[0];
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    const existing = await pool.query(`SELECT * FROM admin_card_scan_jobs
      WHERE request_id=$1 OR (set_id=$2 AND status='running') ORDER BY (request_id=$1) DESC LIMIT 1`, [requestId, setId]);
    const row = existing.rows[0];
    if (!row) throw error;
    if (row.set_id !== setId || row.kind !== kind || row.auto_quarantine !== autoQuarantine) {
      throw Object.assign(new Error("Another scan is running, or this request ID was used for different scan terms."), { status: 409 });
    }
    return mapAdminScanJob(row);
  }
  const job = mapAdminScanJob(inserted!);
  // Schedule only after the durable insert; work never blocks the HTTP response.
  schedule(job);
  return job;
}
