/**
 * Writes Design-approved recrop cards into card_review_approvals.
 * Blocked recrop ids are never inserted. An existing row is left as-is.
 */
import { cardReviewApprovals } from "@shared/schema";
import { db } from "../db";
import {
  RECROP_APPROVED_1986_IDS,
  RECROP_APPROVED_1988_IDS,
  RECROP_BLOCKED_CARDS,
  TOPPS_1986_SET_ID,
  TOPPS_1988_SET_ID,
} from "../masking/toppsRecropReview";

const BLOCKED = new Set(RECROP_BLOCKED_CARDS.map((card) => card.id));

export async function ensureRecropReviewApprovals(): Promise<number> {
  const values = [
    ...RECROP_APPROVED_1986_IDS.filter((id) => !BLOCKED.has(id)).map((cardId) => ({
      cardId,
      gameSetId: TOPPS_1986_SET_ID,
      source: "qa" as const,
      approvedBy: "Design",
      note: "Design recrop review 2026-10-20",
    })),
    ...RECROP_APPROVED_1988_IDS.filter((id) => !BLOCKED.has(id)).map((cardId) => ({
      cardId,
      gameSetId: TOPPS_1988_SET_ID,
      source: "qa" as const,
      approvedBy: "Design",
      note: "Design recrop review 2026-10-21",
    })),
  ];
  if (values.length === 0) return 0;
  const inserted = await db
    .insert(cardReviewApprovals)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: cardReviewApprovals.cardId });
  return inserted.length;
}
