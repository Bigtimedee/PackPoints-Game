/**
 * One release per card of current-version refusals that the trusted profile
 * band (`trustProfileBand`, 1990 Hoops only) may now bake.
 *
 * A refused card keeps `{cardId}_${CURRENT_MASK_VERSION}.fail` and a mask
 * `blocked_reason`, so it is never baked again at this version. For sets whose
 * profile has `trustProfileBand`, this clears that refusal once for the three
 * reasons the fallback handles, so the next bake (QA cover-image, warm-up, or
 * a deal) runs the new path. A card the new path refuses again writes a new
 * fail sidecar and stays refused: the `{cardId}_${CURRENT_MASK_VERSION}.tpb1`
 * marker keeps this from releasing it twice.
 *
 * No other set is read or written. No mask version changes.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { and, eq, inArray } from "drizzle-orm";
import { CURRENT_MASK_VERSION, buildSetMaskHint } from "@shared/maskGeometry";
import { gameSets, maskBakeRefusals, playableCards } from "@shared/schema";
import { db } from "../db";
import { isBlockedCardIdRow } from "../lib/cardBlocklist";
import { getMaskProfile } from "./maskProfiles";
import { clearMaskFailureSidecar, maskReadySidecarDir, readMaskFailureReason } from "./maskReadySidecar";

/** Fail-sidecar reasons the trusted band may replace. */
export const TRUSTED_BAND_RELEASE_REASONS = ["mask_band_oversized", "name_plate_unresolved", "name_text_visible"] as const;

/** blocked_reason values those refusals write (band guard, or quarantineUncoveredName). */
const RELEASABLE_BLOCKED_REASONS = ["mask_band_oversized", "mask_name_uncovered"];

/** Bump to release the same cards again after a later change to the fallback. */
export const TRUSTED_BAND_RELEASE_TAG = "tpb1";

export function trustedBandReleaseMarkerFilename(cardId: string): string {
  return `${cardId}_${CURRENT_MASK_VERSION}.${TRUSTED_BAND_RELEASE_TAG}`;
}

function safeCardId(cardId: string): boolean {
  return Boolean(cardId)
    && cardId.length <= 100
    && !cardId.includes("/")
    && !cardId.includes("\\")
    && !cardId.includes("..")
    && !cardId.includes("\0");
}

/** Set ids whose resolved profile has trustProfileBand. */
export async function trustedBandSetIds(): Promise<string[]> {
  const rows = await db
    .select({
      id: gameSets.id,
      year: gameSets.year,
      brand: gameSets.brand,
      sport: gameSets.sport,
      setName: gameSets.setName,
    })
    .from(gameSets);
  return rows
    .filter((row) => getMaskProfile(buildSetMaskHint(row), row.id).trustProfileBand)
    .map((row) => row.id);
}

export async function releaseTrustedBandRefusals(opts: { dir?: string; setIds?: string[] } = {}): Promise<{
  sets: string[];
  released: number;
  byReason: Record<string, number>;
}> {
  const dir = opts.dir ?? maskReadySidecarDir();
  // Only sets whose profile is flagged, even when the caller names others.
  const trusted = await trustedBandSetIds();
  const setIds = opts.setIds ? opts.setIds.filter((id) => trusted.includes(id)) : trusted;
  const byReason: Record<string, number> = {};
  let released = 0;
  for (const setId of setIds) {
    const members = await db
      .select({
        id: playableCards.id,
        gameSetId: playableCards.gameSetId,
        player: playableCards.player,
        number: playableCards.number,
        variant: playableCards.variant,
        blockedReason: playableCards.blockedReason,
      })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, setId));
    const releasedIds: string[] = [];
    for (const card of members) {
      if (!safeCardId(card.id)) continue;
      const reason = readMaskFailureReason(card.id, dir);
      if (!reason || !(TRUSTED_BAND_RELEASE_REASONS as readonly string[]).includes(reason)) continue;
      const marker = path.join(dir, trustedBandReleaseMarkerFilename(card.id));
      if (existsSync(marker)) continue;
      if (isBlockedCardIdRow(card)) continue;
      mkdirSync(dir, { recursive: true });
      writeFileSync(marker, `${reason}\n`);
      clearMaskFailureSidecar(card.id, dir);
      await db
        .update(playableCards)
        .set({
          isPlayable: true,
          blockedReason: null,
          quarantineStatus: "OK",
          imageReviewStatus: "unreviewed",
          lastValidationReason: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(playableCards.id, card.id),
          inArray(playableCards.blockedReason, RELEASABLE_BLOCKED_REASONS),
        ));
      releasedIds.push(card.id);
      byReason[reason] = (byReason[reason] ?? 0) + 1;
      released += 1;
    }
    if (releasedIds.length > 0) {
      // The refusal rows describe a decision that no longer stands. A new
      // refusal writes a new row.
      await db.delete(maskBakeRefusals).where(inArray(maskBakeRefusals.cardId, releasedIds));
    }
  }
  const reasons = Object.entries(byReason).map(([reason, count]) => `${reason}:${count}`).join(",") || "none";
  console.log(`[MaskProfile] trusted band release sets=${setIds.map((id) => id.slice(0, 8)).join(",") || "none"} released=${released} reasons=${reasons}`);
  return { sets: setIds, released, byReason };
}
