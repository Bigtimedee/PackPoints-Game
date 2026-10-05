import { sql } from "drizzle-orm";
import { db } from "../db";
import { rebateAuditLog } from "@shared/schema";

export type RebateAuditEvent =
  | "QUOTE_CREATED"
  | "POINTS_APPLIED"
  | "APPLY_REJECTED"
  | "APPLY_CANCELED"
  | "CLAIM_RECORDED"
  | "EPN_POSTBACK_MATCHED"
  | "EPN_POSTBACK_NO_MATCH"
  | "EPN_POSTBACK_REJECTED"
  | "CREDIT_GRANTED"
  | "PARTIAL_REFUND"
  | "CREDIT_REVERSED"
  | "PAYOUT_REQUESTED"
  | "PAYOUT_PAID"
  | "PAYOUT_DENIED"
  | "INTENT_DENIED";

export interface RebateAuditEntry {
  event: RebateAuditEvent;
  actor: string;
  userId?: string | null;
  purchaseIntentId?: string | null;
  amountCents?: number | null;
  packpts?: number | null;
  details?: Record<string, unknown>;
}

/**
 * Insert one audit row. Pass the open transaction so the row commits or rolls
 * back together with the state change it describes. There is no update or
 * delete API on purpose.
 */
export async function recordRebateAudit(txOrDb: any, entry: RebateAuditEntry): Promise<void> {
  await (txOrDb ?? db).insert(rebateAuditLog).values({
    event: entry.event,
    actor: entry.actor,
    userId: entry.userId ?? null,
    purchaseIntentId: entry.purchaseIntentId ?? null,
    amountCents: entry.amountCents ?? null,
    packpts: entry.packpts ?? null,
    details: entry.details ?? {},
  });
}

/** Database-level guard: reject UPDATE and DELETE on the audit table. Idempotent. */
export async function ensureRebateAuditImmutable(): Promise<void> {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION rebate_audit_log_immutable() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'rebate_audit_log is append-only';
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.execute(sql`DROP TRIGGER IF EXISTS rebate_audit_log_no_change ON rebate_audit_log`);
  await db.execute(sql`
    CREATE TRIGGER rebate_audit_log_no_change
    BEFORE UPDATE OR DELETE ON rebate_audit_log
    FOR EACH ROW EXECUTE FUNCTION rebate_audit_log_immutable()
  `);
}
