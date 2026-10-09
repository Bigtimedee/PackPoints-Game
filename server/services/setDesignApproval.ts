/**
 * Design approval gate. A set may become public only when Design has recorded an
 * approval for that exact id: an entry in CLEARED_SET_IDS / CLEARED_SET_IDS_EXTRA,
 * or an unrevoked set_design_approvals row written through the QA-token route.
 */
import { pool } from "../db";

let approvedIds = new Set<string>();

const key = (id: string) => id.trim().toLowerCase();

export async function refreshDesignApprovals(): Promise<void> {
  try {
    const rows = await pool.query<{ set_id: string }>(
      "SELECT set_id FROM set_design_approvals WHERE revoked_at IS NULL",
    );
    approvedIds = new Set(rows.rows.map((row) => key(row.set_id)));
  } catch (error) {
    // Fail closed: no recorded approvals means only CLEARED_SET_IDS sets are public.
    console.error("[DesignApproval] refresh failed; treating recorded approvals as empty", error);
    approvedIds = new Set();
  }
}

/** Recorded DB approval only. Callers combine it with isClearedSetId. */
export function hasRecordedDesignApproval(id: string | null | undefined): boolean {
  return !!id && approvedIds.has(key(id));
}

export function setDesignApprovalsForTests(ids: string[]): () => void {
  const previous = approvedIds;
  approvedIds = new Set(ids.map(key));
  return () => { approvedIds = previous; };
}

export const DESIGN_APPROVAL_REQUIRED_ERROR =
  "Design approval required: this set has no recorded Design approval of its mask profile. Design must approve it via /api/qa/sets/:setId/design-approval before it can be published.";
export const MASK_PROFILE_REQUIRED_ERROR =
  "Mask profile required: save a set layout (mask profile) before Design approval or publish.";

/** null when publish may proceed; otherwise the 409 message. */
export function publishGateError(input: { setId: string; designApproved: boolean; hasMaskProfile: boolean }): string | null {
  if (!input.hasMaskProfile) return MASK_PROFILE_REQUIRED_ERROR;
  if (!input.designApproved) return DESIGN_APPROVAL_REQUIRED_ERROR;
  return null;
}

export async function recordDesignApproval(setId: string, maskProfileId: string, approvedBy: string, note: string | null) {
  await pool.query(
    `INSERT INTO set_design_approvals(set_id,mask_profile_id,approved_by,note,approved_at,revoked_at)
     VALUES($1,$2,$3,$4,now(),NULL)
     ON CONFLICT(set_id) DO UPDATE SET mask_profile_id=EXCLUDED.mask_profile_id,approved_by=EXCLUDED.approved_by,
       note=EXCLUDED.note,approved_at=now(),revoked_at=NULL`,
    [setId, maskProfileId, approvedBy, note],
  );
  await refreshDesignApprovals();
}

export async function revokeDesignApproval(setId: string) {
  await pool.query("UPDATE set_design_approvals SET revoked_at=now() WHERE set_id=$1 AND revoked_at IS NULL", [setId]);
  await refreshDesignApprovals();
}

export async function readDesignApproval(setId: string) {
  const rows = await pool.query("SELECT * FROM set_design_approvals WHERE set_id=$1", [setId]);
  return rows.rows[0] ?? null;
}
