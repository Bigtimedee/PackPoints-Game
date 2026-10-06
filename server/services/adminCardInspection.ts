import fs from "fs";
import path from "path";
import { and, eq, gt, sql, asc } from "drizzle-orm";
import { gameSets, playableCards } from "@shared/schema";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { db } from "../db";
import { holdReasonForIdentity, isClearedSetId, maskProfileForSet, setHasRegisteredMaskProfile } from "../config/heldSets";
import { eligibleDealFilter, PUBLIC_SET_MIN_ELIGIBLE_CARDS } from "./playableSetEligibility";
import { maskReadySidecarDir, readMaskFailureReason } from "../masking/maskReadySidecar";
import type { CardInspectionQuery } from "../routes/adminCardInspection";

/** File-presence evidence only; never bakes or turns this into QA approval. */
function maskEvidence(cardId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId)) {
    return { maskVersion: CURRENT_MASK_VERSION, evidenceUnavailable: "non_uuid_card_id", bakeVerifiedByInspection: false };
  }
  const stem = path.join(maskReadySidecarDir(), `${cardId}_${CURRENT_MASK_VERSION}`);
  const isFile = (file: string) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
  return { maskVersion: CURRENT_MASK_VERSION, okSidecarPresent: isFile(`${stem}.ok`),
    failSidecarPresent: isFile(`${stem}.fail`), refusal: readMaskFailureReason(cardId),
    cachedJpegPresent: ["", "_r90", "_r180", "_r270"].some((rotation) => isFile(`${stem}${rotation}.jpg`)),
    bakeVerifiedByInspection: false };
}
export async function readAdminCardInspection(query: CardInspectionQuery) {
  const [set] = await db.select({ id: gameSets.id, setName: gameSets.setName, year: gameSets.year,
    brand: gameSets.brand, sport: gameSets.sport, isActive: gameSets.isActive, isUserCreated: gameSets.isUserCreated })
    .from(gameSets).where(eq(gameSets.id, query.setId)).limit(1);
  if (!set) return null;
  const holdReason = holdReasonForIdentity(set);
  const profile = maskProfileForSet(set);
  const [counts] = await db.select({ rawImportedCards: sql<number>`count(*)::int`,
    rawMarkedPlayableCards: sql<number>`count(*) filter (where ${playableCards.isPlayable} = true)::int` })
    .from(playableCards).where(eq(playableCards.gameSetId, set.id));
  const canList = set.isActive && !set.isUserCreated && !holdReason;
  // Existing runtime eligibility filters. SQL guards are not successful bake/visual QA evidence.
  const eligibility = and(eligibleDealFilter("playable_cards"), sql`LOWER(${playableCards.category}) = LOWER(${set.sport})`);
  const [eligible] = await db.select({ count: sql<number>`count(*)::int` }).from(playableCards)
    .where(and(eq(playableCards.gameSetId, set.id), eligibility));
  const rows = await db.select({ id: playableCards.id, gameSetId: playableCards.gameSetId,
    cardhedgeCardId: playableCards.cardhedgeCardId, player: playableCards.player, number: playableCards.number,
    description: playableCards.description, set: playableCards.set, variant: playableCards.variant, category: playableCards.category,
    rookie: playableCards.rookie, rawImagesOnly: playableCards.rawImagesOnly, reportCount: playableCards.reportCount,
    lastImageCheck: playableCards.lastImageCheck, imageFailureCount: playableCards.imageFailureCount,
    imageLastError: playableCards.imageLastError, contentVerifiedAt: playableCards.contentVerifiedAt,
    validationFailCount: playableCards.validationFailCount, lastValidationReason: playableCards.lastValidationReason,
    lastValidationHttpStatus: playableCards.lastValidationHttpStatus, lastValidationContentType: playableCards.lastValidationContentType,
    lastValidationCheckedAt: playableCards.lastValidationCheckedAt, firstValidationFailAt: playableCards.firstValidationFailAt,
    createdAt: playableCards.createdAt, updatedAt: playableCards.updatedAt,
    imageUrl: playableCards.imageUrl, isPlayable: playableCards.isPlayable, contentVerified: playableCards.contentVerified,
    blockedReason: playableCards.blockedReason, imageReviewStatus: playableCards.imageReviewStatus,
    quarantineStatus: playableCards.quarantineStatus, proposedUnplayable: playableCards.proposedUnplayable,
    nameLayoutVerified: playableCards.nameLayoutVerified, imageRotation: playableCards.imageRotation,
    cardPassesRuntimeFilter: sql<boolean>`COALESCE((${eligibility}), false)` })
    .from(playableCards).where(and(eq(playableCards.gameSetId, set.id),
      query.after ? gt(playableCards.id, query.after) : undefined)).orderBy(asc(playableCards.id)).limit(query.limit + 1);
  const hasMore = rows.length > query.limit;
  const cards = rows.slice(0, query.limit).map((row) => ({ ...row,
    canonicalEligibleNow: Boolean(canList && row.cardPassesRuntimeFilter), maskEvidence: maskEvidence(row.id) }));
  const canonicalEligibleCards = canList ? Number(eligible?.count ?? 0) : 0;
  return { set, observedAt: new Date().toISOString(), readOnly: true,
    counts: { rawImportedCards: Number(counts?.rawImportedCards ?? 0),
      rawMarkedPlayableCards: Number(counts?.rawMarkedPlayableCards ?? 0), canonicalEligibleCards },
    design: { holdReason, registeredMaskProfile: setHasRegisteredMaskProfile(set),
      profileId: profile.id, exactSetIdCleared: isClearedSetId(set.id),
      satisfiesPublicCountFloor: Boolean(canList && canonicalEligibleCards >= PUBLIC_SET_MIN_ELIGIBLE_CARDS),
      publicCountFloor: PUBLIC_SET_MIN_ELIGIBLE_CARDS, maskVersion: CURRENT_MASK_VERSION },
    pagination: { limit: query.limit, after: query.after, hasMore,
      nextAfter: hasMore ? cards[cards.length - 1].id : null, order: "id_ascending",
      consistency: "Live keyset pages, not a frozen snapshot; counts and rows may change between reads." },
    cards, warnings: ["Raw isPlayable flags do not establish public availability.",
      "Canonical eligibility uses existing runtime filters and explicit active/integrated/design-hold checks; no mask bake or visual QA was performed.",
      "File presence is diagnostic evidence only, not proof of source freshness, mask geometry, player match or name concealment."] };
}
