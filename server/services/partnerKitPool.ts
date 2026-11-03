/**
 * Daily masked card for the partner kit. A separate pool from Daily 5:
 * Design-cleared sets only, held sets stay out, and that day's Daily 5 cards
 * and cover slots are excluded. The pick is a hash of the CT day. Only a
 * ready masked file is read.
 */
import { readFileSync } from "fs";
import { and, eq, inArray } from "drizzle-orm";
import { dailyChallengeCards, dailyChallenges, gameSets, playableCards } from "@shared/schema";
import { eligibleKitCardIds, pickKitCardId } from "@shared/partnerKit";
import { db } from "../db";
import { clearedSetIds, ensureHeldSets, holdReasonForIdentity, isDesignApprovedSetId } from "../config/heldSets";
import { eligibleDealFilter } from "./playableSetEligibility";
import { cachedCoverCardIds, readyMaskedCardIds } from "./setCovers";
import { maskReadySidecarDir } from "../masking/maskReadySidecar";
import { resolveReadyWarmMaskedFile } from "../startup/warmMaskGate";

export type KitMaskedCard = { cardId: string; bytes: Buffer };

const cache = new Map<string, { at: number; value: KitMaskedCard | null }>();
const CACHE_MS = 60_000;

export async function loadKitMaskedCard(dayKey: string): Promise<KitMaskedCard | null> {
  const hit = cache.get(dayKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await loadUncached(dayKey);
  cache.set(dayKey, { at: Date.now(), value });
  return value;
}

export function clearKitCardCacheForTests(): void {
  cache.clear();
}

async function loadUncached(dayKey: string): Promise<KitMaskedCard | null> {
  await ensureHeldSets();
  const sets = await db
    .select({
      id: gameSets.id,
      year: gameSets.year,
      brand: gameSets.brand,
      sport: gameSets.sport,
      setName: gameSets.setName,
      isActive: gameSets.isActive,
      isUserCreated: gameSets.isUserCreated,
    })
    .from(gameSets)
    .where(and(eq(gameSets.isActive, true), eq(gameSets.isUserCreated, false)));

  const cleared = new Set([...clearedSetIds()].map((id) => id.toLowerCase()));
  const open = sets.filter((set) => {
    if (!set.id || !cleared.has(set.id.toLowerCase())) return false;
    if (!isDesignApprovedSetId(set.id)) return false;
    return holdReasonForIdentity(set) == null;
  });
  if (open.length === 0) return null;

  const openIds = open.map((set) => set.id);
  const cards = await db
    .select({ id: playableCards.id, setId: playableCards.gameSetId })
    .from(playableCards)
    .where(and(inArray(playableCards.gameSetId, openIds), eligibleDealFilter("playable_cards")));

  const daily = await db
    .select({ cardId: dailyChallengeCards.cardId })
    .from(dailyChallengeCards)
    .innerJoin(dailyChallenges, eq(dailyChallenges.id, dailyChallengeCards.dailyChallengeId))
    .where(eq(dailyChallenges.date, dayKey));

  const covers = new Set<string>();
  for (const setId of openIds) {
    for (const cardId of await cachedCoverCardIds(setId)) covers.add(cardId);
  }

  const masked = readyMaskedCardIds();
  const eligible = eligibleKitCardIds({
    cards,
    clearedSetIds: cleared,
    heldSetIds: new Set(sets.filter((set) => holdReasonForIdentity(set) != null).map((set) => set.id)),
    daily5CardIds: new Set(daily.map((row) => row.cardId)),
    coverCardIds: covers,
    maskedCardIds: masked,
  });
  const cardId = pickKitCardId(dayKey, eligible);
  if (!cardId) return null;
  const file = resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId);
  if (!file || /unmasked/i.test(file)) return null;
  return { cardId, bytes: readFileSync(file) };
}
