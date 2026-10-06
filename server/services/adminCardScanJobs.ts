import { claimAdminScan, mapAdminScanJob, type AdminScanJob, type JobRow } from "./adminScanRegistry";
export { mapAdminScanJob } from "./adminScanRegistry";
import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import { playableCards } from "@shared/schema";
import { db, pool } from "../db";
import { analyzeImageContent } from "./imageContentAnalyzer";
import { fetchCardDetailsNormalized } from "./cardhedge/client";
import { markPlayerMismatchUnplayable } from "./playableIneligible";
import { invalidateMaskReadySidecars } from "../masking/maskReadySidecar";
import { assertMutationAllowed } from "./mutationGuard";
import { emptyScanReport, runAdminScan, type AdminScanKind, type ScanReport } from "./adminScanCore";

export async function readAdminScanJob(setId: string, id?: string): Promise<AdminScanJob | null> {
  const result = await pool.query<JobRow>(id
    ? "SELECT * FROM admin_card_scan_jobs WHERE set_id=$1 AND id=$2"
    : "SELECT * FROM admin_card_scan_jobs WHERE set_id=$1 ORDER BY created_at DESC LIMIT 1", id ? [setId, id] : [setId]);
  return result.rows[0] ? mapAdminScanJob(result.rows[0]) : null;
}
async function persist(id: string, report: ScanReport, status = "running", error: string | null = null) {
  await pool.query("UPDATE admin_card_scan_jobs SET report=$2::jsonb, status=$3, error=$4, updated_at=now() WHERE id=$1",
    [id, JSON.stringify(report), status, error]);
}
async function execute(job: AdminScanJob, actor: string): Promise<void> {
  const report = emptyScanReport();
  try {
    const cards = await db.select({ id: playableCards.id, imageUrl: playableCards.imageUrl,
      player: playableCards.player, contentVerified: playableCards.contentVerified,
      cardhedgeCardId: playableCards.cardhedgeCardId }).from(playableCards)
      .where(eq(playableCards.gameSetId, job.setId)).orderBy(asc(playableCards.id));
    await runAdminScan(job.kind, cards, job.autoQuarantine, report, {
      analyze: analyzeImageContent,
      details: fetchCardDetailsNormalized,
      verify: async (card, valid) => {
        // Never undo a pre-existing exclusion. Scope every write to the original set/card/image.
        const rows = await db.update(playableCards)
          .set({ contentVerified: valid, contentVerifiedAt: new Date() })
          .where(and(eq(playableCards.id, card.id), eq(playableCards.gameSetId, job.setId),
            eq(playableCards.imageUrl, card.imageUrl!),
            valid ? isNull(playableCards.contentVerified)
              : or(isNull(playableCards.contentVerified), ne(playableCards.contentVerified, false))))
          .returning({ id: playableCards.id });
        // Cached play/m images can bypass DB checks; revoke readiness only for rows actually blocked.
        if (!valid) invalidateMaskReadySidecars(rows.map(row => row.id));
        return rows.length === 1;
      },
      quarantine: async (card, apiPlayer) => {
        const allowed = assertMutationAllowed({ operationSource: "ADMIN_MANUAL", action: "SET_UNPLAYABLE",
          actorUserId: actor, reason: `Player mismatch: stored="${card.player}" vs API="${apiPlayer}"` });
        if (!allowed.allowed) throw new Error(allowed.reason || "Admin mutation denied");
        // Helper performs returning-row verification and invalidates mask readiness.
        return markPlayerMismatchUnplayable(card.id,
          `Player mismatch: stored="${card.player}" vs API="${apiPlayer}"`,
          { setId: job.setId, player: card.player!, cardhedgeCardId: card.cardhedgeCardId! });
      },
      progress: (current) => persist(job.id, current),
      delay: () => new Promise((resolve) => setTimeout(resolve, 200)),
    });
    await persist(job.id, report, "completed");
  } catch (error) {
    console.error("[AdminScan] Job failed", job.id, error);
    // Do not advertise a successful scan after DB/snapshot/checkpoint failure.
    try { await persist(job.id, report, "failed", "Scan stopped; some card changes may have occurred. Review coverage and issues before a new scan."); }
    catch (persistError) { console.error("[AdminScan] Cannot checkpoint failure", job.id, persistError); }
  }
}
export async function startAdminScan(setId: string, kind: AdminScanKind, requestId: string,
  autoQuarantine: boolean, actor: string): Promise<AdminScanJob> {
  return claimAdminScan(pool, (job) => setImmediate(() => { void execute(job, actor); }),
    setId, kind, requestId, autoQuarantine, actor);
}
