/**
 * Bake state for the Design recrop QA export.
 * A ready sidecar is baked. A current-version fail sidecar is refused.
 * Anything else is still pending.
 */
import { readMaskFailureReason, maskReadySidecarDir } from "./maskReadySidecar";
import { resolveReadyWarmMaskedFile } from "../startup/warmMaskGate";
import {
  recropBlockedForSet,
  recropMaskedPath,
  type RecropBlockedCard,
} from "./toppsRecropReview";

export type RecropBakeStatus = "baked" | "refused" | "pending";

export function recropBakeState(cardId: string): { bakeStatus: RecropBakeStatus; bakeRefusal: string | null } {
  const bakeRefusal = readMaskFailureReason(cardId);
  if (bakeRefusal) return { bakeStatus: "refused", bakeRefusal };
  if (resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId)) return { bakeStatus: "baked", bakeRefusal: null };
  return { bakeStatus: "pending", bakeRefusal: null };
}

export interface RecropReviewRow {
  id: string;
  set: string;
  number: string;
  bakeStatus: RecropBakeStatus;
  refusalReason: string;
  bakeRefusal: string | null;
  flags: RecropBlockedCard["flags"];
  maskedPath: string;
}

/** Manifest page for one Topps set. Null when the set is not in the recrop review. */
export function recropReviewPage(setId: string, offset: number, limit: number): {
  setId: string;
  setName: string;
  holdReason: null;
  recropReview: true;
  total: number;
  offset: number;
  limit: number;
  cards: RecropReviewRow[];
} | null {
  const all = recropBlockedForSet(setId);
  if (all.length === 0) return null;
  const cards = all.slice(offset, offset + limit).map((card) => {
    const bake = recropBakeState(card.id);
    return {
      id: card.id,
      set: card.setName,
      number: card.number,
      bakeStatus: bake.bakeStatus,
      refusalReason: card.reason,
      bakeRefusal: bake.bakeRefusal,
      flags: card.flags,
      maskedPath: recropMaskedPath(setId, card.id),
    };
  });
  return {
    setId,
    setName: all[0].setName,
    holdReason: null,
    recropReview: true,
    total: all.length,
    offset,
    limit,
    cards,
  };
}
