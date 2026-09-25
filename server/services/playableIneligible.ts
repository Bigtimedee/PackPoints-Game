import { eq, inArray } from "drizzle-orm";
import { playableCards } from "@shared/schema";
import { db } from "../db";
import { invalidateMaskReadySidecar, invalidateMaskReadySidecars } from "../masking/maskReadySidecar";

async function markUnplayable(
  cardIds: string[],
  patch: {
    blockedReason: string;
    imageReviewStatus?: string;
    quarantineStatus?: string;
    imageLastError?: string;
  },
): Promise<string[]> {
  const ids = [...new Set(cardIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const updated = await db
    .update(playableCards)
    .set({
      isPlayable: false,
      blockedReason: patch.blockedReason,
      ...(patch.imageReviewStatus ? { imageReviewStatus: patch.imageReviewStatus } : {}),
      ...(patch.quarantineStatus ? { quarantineStatus: patch.quarantineStatus } : {}),
      ...(patch.imageLastError ? { imageLastError: patch.imageLastError } : {}),
      updatedAt: new Date(),
    })
    .where(inArray(playableCards.id, ids))
    .returning({ id: playableCards.id });
  const written = updated.map((row) => row.id);
  invalidateMaskReadySidecars(written);
  return written;
}

export async function markPlayerMismatchUnplayable(cardId: string, imageLastError?: string): Promise<void> {
  await markUnplayable([cardId], {
    blockedReason: "player_mismatch",
    imageReviewStatus: "excluded",
    quarantineStatus: "REMOVED_BY_ADMIN",
    imageLastError,
  });
}

export async function rejectReportedCardImage(cardId: string): Promise<void> {
  await markUnplayable([cardId], {
    blockedReason: "Image mismatch confirmed via report",
    imageReviewStatus: "rejected",
    quarantineStatus: "REMOVED_BY_ADMIN",
  });
}

export async function rejectCardReview(cardId: string, resolution?: string): Promise<void> {
  await markUnplayable([cardId], {
    blockedReason: resolution || "Image mismatch confirmed via admin review",
    imageReviewStatus: "rejected",
    quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
  });
}

export async function flagMultiPlayerCards(cardIds: string[]): Promise<string[]> {
  return markUnplayable(cardIds, {
    blockedReason: "multi-player",
    quarantineStatus: "REMOVED_BY_ADMIN",
  });
}

export async function excludePlayableCard(cardId: string, reason?: string): Promise<void> {
  await markUnplayable([cardId], {
    blockedReason: reason || "admin_manual_exclusion",
    imageReviewStatus: "excluded",
    quarantineStatus: "REMOVED_BY_ADMIN",
  });
}

/** Classifier backfill and CardHedge import. Drops the sidecar only when the card leaves the pool. */
export async function notePlayableClassification(
  cardId: string,
  isPlayable: boolean,
  blockedReason: string | null,
): Promise<void> {
  await db
    .update(playableCards)
    .set({
      isPlayable,
      blockedReason,
      updatedAt: new Date(),
    })
    .where(eq(playableCards.id, cardId));
  if (!isPlayable) invalidateMaskReadySidecar(cardId);
}

/** Import insert/upsert already wrote isPlayable. Drop a sidecar left by the previous row. */
export function noteImportedCardUnplayable(cardId: string, isPlayable: boolean): void {
  if (!isPlayable) invalidateMaskReadySidecar(cardId);
}
