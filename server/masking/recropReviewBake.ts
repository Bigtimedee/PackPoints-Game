/**
 * One background re-bake of the Design recrop cohort after this release.
 * Blocked cards are forced once so the QA export is the new crop.
 * Approved 1986 cards are baked once when they have no ready file, or when a fail sidecar is still in the way.
 * A marker on the mask volume stops the same card from being forced on every boot.
 */
import { appendFileSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import path from "path";
import { MASKED_CARDS_DIR } from "./maskPlanStore";
import { clearMaskFailureSidecar, invalidateMaskReadySidecar, maskReadySidecarDir, readMaskFailureReason } from "./maskReadySidecar";
import { getMaskedImagePath, warmMaskedFilename } from "./maskingService";
import { RECROP_APPROVED_1986_IDS, RECROP_BLOCKED_CARDS } from "./toppsRecropReview";
import { resolveReadyWarmMaskedFile } from "../startup/warmMaskGate";

const BLOCKED_MARKER = "recrop-review-blocked-v1.ids";
const APPROVED_MARKER = "recrop-review-approved-v1.ids";

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

function dropWarm(cardId: string): void {
  clearMaskFailureSidecar(cardId);
  invalidateMaskReadySidecar(cardId);
  for (const deg of [0, 90, 180, 270] as const) {
    try {
      unlinkSync(path.join(MASKED_CARDS_DIR, warmMaskedFilename(cardId, deg)));
    } catch {
      // already gone
    }
  }
}

async function bakeCard(cardId: string, force: boolean): Promise<"baked" | "refused" | "skipped" | "error"> {
  const ready = resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId);
  const failed = readMaskFailureReason(cardId);
  if (!force && ready && !failed) return "skipped";
  if (force) dropWarm(cardId);
  else if (failed) clearMaskFailureSidecar(cardId);
  try {
    const file = await getMaskedImagePath(cardId, { priority: "warm" });
    if (file) return "baked";
    return readMaskFailureReason(cardId) ? "refused" : "error";
  } catch (error) {
    console.error(`[RecropReview] bake error card=${cardId.slice(0, 8)}`, error instanceof Error ? error.message : error);
    return "error";
  }
}

export async function runRecropReviewBake(): Promise<void> {
  const blockedDone = readMarker(BLOCKED_MARKER);
  const approvedDone = readMarker(APPROVED_MARKER);
  const counts = { baked: 0, refused: 0, skipped: 0, error: 0 };
  for (const card of RECROP_BLOCKED_CARDS) {
    if (blockedDone.has(card.id)) {
      counts.skipped += 1;
      continue;
    }
    const result = await bakeCard(card.id, true);
    counts[result] += 1;
    if (result !== "error") {
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
  console.log(`[RecropReview] baked=${counts.baked} refused=${counts.refused} skipped=${counts.skipped} error=${counts.error}`);
}

/** Production only. Starts after listen so the re-bake does not block the port. */
export function scheduleRecropReviewBake(): void {
  if (process.env.NODE_ENV !== "production") return;
  const timer = setTimeout(() => {
    void runRecropReviewBake().catch((error) => {
      console.error("[RecropReview] bake failed", error instanceof Error ? error.message : error);
    });
  }, 15_000);
  timer.unref();
}
