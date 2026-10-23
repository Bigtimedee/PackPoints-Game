/**
 * One background re-bake of the Design recrop cohort after this release.
 * Permanently excluded cards are left out of that force bake, and any older masked file is deleted.
 * Approved 1986 cards are baked once when they have no ready file, or when a fail sidecar is still in the way.
 * #495 and #574 are not on the blocked list. The v7 marker already recorded their
 * first bake, and that bake clears a refusal sidecar before the success path
 * can set is_playable again. A separate marker opens those two once a prepared
 * 1988 file exists, and bakes one when the file is missing.
 * A marker on the mask volume stops the same card from being forced on every boot.
 */
import { appendFileSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { playableCards } from "@shared/schema";
import { db } from "../db";
import { MASKED_CARDS_DIR, warmMaskPlanFilename } from "./maskPlanStore";
import { isMaskDealBlockReason } from "./maskDealRefusal";
import { clearMaskFailureSidecar, invalidateMaskReadySidecar, maskReadySidecarDir, readMaskFailureReason } from "./maskReadySidecar";
import { getMaskedImagePath, warmMaskedFilename } from "./maskingService";
import { RECROP_APPROVED_1986_IDS, RECROP_BLOCKED_CARDS, RECROP_RELEASED_1988_IDS, releasedRecropAction, recropPermanentlyExcluded } from "./toppsRecropReview";
import { preparedTopps1988MaskFile, topps1988ReviewedRowMatches } from "./topps1988Readiness";
import { resolveReadyWarmMaskedFile } from "../startup/warmMaskGate";

const BLOCKED_MARKER = "recrop-review-blocked-v7.ids";
const APPROVED_MARKER = "recrop-review-approved-v1.ids";
export const RELEASED_RECROP_MARKER = "recrop-review-released-1988-v1.ids";

function markerPath(name: string): string {
  return path.join(MASKED_CARDS_DIR, name);
}

function readMarker(name: string): Set<string> {
  try {
    const text = readFileSync(markerPath(name), "utf8");
    return new Set(text.split(/\s+/).map((id) => id.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function markDone(name: string, cardId: string): void {
  mkdirSync(MASKED_CARDS_DIR, { recursive: true });
  appendFileSync(markerPath(name), `${cardId}\n`);
}

/** Drop a ready JPEG so an excluded card cannot be served from an older bake. */
function discardExcludedMask(cardId: string): void {
  const dirs = new Set([maskReadySidecarDir(), MASKED_CARDS_DIR]);
  for (const dir of dirs) {
    invalidateMaskReadySidecar(cardId, dir);
    clearMaskFailureSidecar(cardId, dir);
    for (const deg of [0, 90, 180, 270] as const) {
      try { unlinkSync(path.join(dir, warmMaskedFilename(cardId, deg))); } catch { /* already gone */ }
    }
    try { unlinkSync(path.join(dir, warmMaskPlanFilename(cardId))); } catch { /* already gone */ }
  }
}

/**
 * A prepared file plus a matching reviewed row is enough to deal.
 * A mask refusal left is_playable false after the sidecar was cleared, so
 * this sets that row playable again. Any other blocked_reason stays.
 */
export async function openReleasedRecropCard(cardId: string): Promise<"opened" | "ready" | "unwitnessed" | "blocked"> {
  const [row] = await db
    .select({
      player: playableCards.player,
      imageUrl: playableCards.imageUrl,
      imageRotation: playableCards.imageRotation,
      isPlayable: playableCards.isPlayable,
      blockedReason: playableCards.blockedReason,
      imageReviewStatus: playableCards.imageReviewStatus,
    })
    .from(playableCards)
    .where(eq(playableCards.id, cardId))
    .limit(1);
  if (!row || !topps1988ReviewedRowMatches(cardId, row)) {
    console.error(`[RecropReview] release unwitnessed card=${cardId.slice(0, 8)}`);
    return "unwitnessed";
  }
  const maskBlock = isMaskDealBlockReason(row.blockedReason);
  if (row.blockedReason && !maskBlock) {
    console.error(`[RecropReview] release other block card=${cardId.slice(0, 8)}`);
    return "blocked";
  }
  if (row.isPlayable && !maskBlock) return "ready";
  await db
    .update(playableCards)
    .set({
      isPlayable: true,
      blockedReason: null,
      quarantineStatus: "OK",
      ...(row.imageReviewStatus === "flagged" ? { imageReviewStatus: "unreviewed" } : {}),
      lastValidationReason: null,
      updatedAt: new Date(),
    })
    .where(eq(playableCards.id, cardId));
  return "opened";
}

async function bakeCard(cardId: string, force: boolean): Promise<"baked" | "refused" | "skipped" | "error"> {
  const ready = resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId);
  const failed = readMaskFailureReason(cardId);
  if (!force && ready && !failed) return "skipped";
  // Clear a refusal so the bake can run. Leave the warm JPEG in place until a new bake overwrites it.
  if (force || failed) clearMaskFailureSidecar(cardId);
  try {
    const file = await getMaskedImagePath(cardId, { priority: "warm", ignoreCache: force });
    if (file) return "baked";
    return readMaskFailureReason(cardId) ? "refused" : "error";
  } catch (error) {
    console.error(`[RecropReview] bake error card=${cardId.slice(0, 8)}`, error instanceof Error ? error.message : error);
    return "error";
  }
}

async function releaseClearedRecropCards(counts: { baked: number; refused: number; skipped: number; error: number; opened: number }): Promise<void> {
  const releasedDone = readMarker(RELEASED_RECROP_MARKER);
  for (const cardId of RECROP_RELEASED_1988_IDS) {
    if (releasedDone.has(cardId)) {
      counts.skipped += 1;
      continue;
    }
    // A fail sidecar hides a valid plan from the deal witness. Drop it before
    // deciding, then bake only when the prepared file is still missing.
    clearMaskFailureSidecar(cardId);
    const action = releasedRecropAction(false, preparedTopps1988MaskFile(cardId) != null);
    if (action === "bake") {
      const result = await bakeCard(cardId, true);
      counts[result] += 1;
      if (!preparedTopps1988MaskFile(cardId)) continue;
    }
    const opened = await openReleasedRecropCard(cardId);
    if (opened === "opened") counts.opened += 1;
    if (opened === "opened" || opened === "ready") {
      markDone(RELEASED_RECROP_MARKER, cardId);
      releasedDone.add(cardId);
    } else {
      counts.error += 1;
    }
  }
}

export async function runRecropReviewBake(): Promise<void> {
  const blockedDone = readMarker(BLOCKED_MARKER);
  const approvedDone = readMarker(APPROVED_MARKER);
  const counts = { baked: 0, refused: 0, skipped: 0, error: 0, opened: 0 };
  for (const card of RECROP_BLOCKED_CARDS) {
    if (recropPermanentlyExcluded(card.id)) {
      discardExcludedMask(card.id);
      counts.skipped += 1;
      continue;
    }
    if (blockedDone.has(card.id)) {
      counts.skipped += 1;
      continue;
    }
    const result = await bakeCard(card.id, true);
    counts[result] += 1;
    if (result === "baked") {
      markDone(BLOCKED_MARKER, card.id);
      blockedDone.add(card.id);
    }
  }
  for (const cardId of RECROP_APPROVED_1986_IDS) {
    if (approvedDone.has(cardId)) {
      counts.skipped += 1;
      continue;
    }
    const result = await bakeCard(cardId, false);
    counts[result] += 1;
    if (result !== "error") {
      markDone(APPROVED_MARKER, cardId);
      approvedDone.add(cardId);
    }
  }
  await releaseClearedRecropCards(counts);
  console.log(`[RecropReview] baked=${counts.baked} refused=${counts.refused} skipped=${counts.skipped} error=${counts.error} opened=${counts.opened}`);
}

/** Production only. Starts after listen so the re-bake does not block the port. */
export function scheduleRecropReviewBake(): void {
  if (process.env.NODE_ENV !== "production") return;
  for (const card of RECROP_BLOCKED_CARDS) {
    if (recropPermanentlyExcluded(card.id)) discardExcludedMask(card.id);
  }
  const timer = setTimeout(() => {
    void runRecropReviewBake().catch((error) => {
      console.error("[RecropReview] bake failed", error instanceof Error ? error.message : error);
    });
  }, 15_000);
  timer.unref();
}
