/**
 * 1988 Topps deals only cards with a prepared reviewed-source mask file
 * (topps1988Readiness). A profile rebuild purges those files, and before this
 * module only the admin prepare route rebuilt them, so a rebuild left the set
 * with 0 dealable cards. On boot, re-prepare in the background exactly the cards
 * that already have a card_review_approvals row,
 * one at a time. This restores the pool Design already approved. It never
 * approves, unblocks or adds a card: unapproved cards are skipped, and the
 * blocklist and every other deal filter still apply.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { TOPPS_1988_SET_ID, TOPPS_1988_REVIEWED_SOURCES } from "../masking/topps1988Geometry";
import { preparedTopps1988MaskFile } from "../masking/topps1988Readiness";
import { getMaskedImagePath } from "../masking/maskingService";

export async function approvedTopps1988NeedingPrepare(): Promise<string[]> {
  const reviewed = new Set(TOPPS_1988_REVIEWED_SOURCES.map((s) => s.cardId));
  const rows = await db.execute<{ id: string }>(sql`
    SELECT pc.id FROM playable_cards pc
    JOIN card_review_approvals cra ON cra.card_id = pc.id
    WHERE pc.game_set_id = ${TOPPS_1988_SET_ID}`);
  return (rows.rows ?? []).map((r) => r.id)
    .filter((id) => reviewed.has(id) && !preparedTopps1988MaskFile(id));
}

export function restoreTopps1988PreparedInBackground(): void {
  void (async () => {
    const ids = await approvedTopps1988NeedingPrepare();
    if (!ids.length) return;
    let ready = 0;
    for (const id of ids) {
      try {
        await getMaskedImagePath(id, { priority: "warm" });
        if (preparedTopps1988MaskFile(id)) ready++;
      } catch { /* refused or timed out: stays undealable */ }
    }
    console.log(`[Topps1988Restore] approved=${ids.length} ready=${ready}`);
  })().catch((error) => console.error("[Topps1988Restore] failed", error));
}
