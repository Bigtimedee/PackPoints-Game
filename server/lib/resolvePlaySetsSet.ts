/**
 * Resolve an integrated set for play-sets share / OG.
 * Accepts UUID or public slug (`name-a1b2c3d4`).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { contentAssets, gameSets, playableCards } from "@shared/schema";
import { setShareSlug } from "../contentFactory/makerShareSlug";
import { usablePublicImageUrl } from "../routes/userSetPreview";
import { loadMakerCardSlots } from "../contentFactory/makerShareFromSet";
import {
  writePlaySetsRuntimeCrop,
  playSetsRuntimeCacheUrl,
} from "../contentFactory/generatePlaySetsKit";
import {
  isUsableShareImageUrl,
  normalizePlaySetsSetRef,
  playSetsDashedUuid,
  playSetsSlugIdPrefix,
  type PlaySetsSurface,
} from "@shared/playSetsShare";
import fs from "fs";
import path from "path";
import { getShareOutputBase } from "../contentFactory/generateScoreCard";

export interface ResolvedPlaySetsSet {
  id: string;
  setName: string;
  slug: string;
  shareImageUrl?: string;
}

async function lookupRuntimeCover(setId: string): Promise<string | undefined> {
  const [asset] = await db.select({
    metadata: contentAssets.metadata,
  })
    .from(contentAssets)
    .where(eq(contentAssets.sourceEventId, `maker_set_${setId}`))
    .limit(1);
  const url = usablePublicImageUrl((asset?.metadata as { imageUrl?: string } | null)?.imageUrl);
  return url ?? undefined;
}

export async function resolvePlaySetsSet(idOrSlug: string): Promise<ResolvedPlaySetsSet | null> {
  const raw = normalizePlaySetsSetRef(idOrSlug) ?? (idOrSlug || "").trim();
  if (!raw) return null;

  const dashedId = playSetsDashedUuid(raw);
  const [byId] = dashedId
    ? await db.select({
      id: gameSets.id,
      setName: gameSets.setName,
      isActive: gameSets.isActive,
    }).from(gameSets).where(eq(gameSets.id, dashedId)).limit(1)
    : [];

  let row = byId;
  if (!row) {
    const prefix = playSetsSlugIdPrefix(raw);
    if (prefix) {
      const [bySlug] = await db.select({
        id: gameSets.id,
        setName: gameSets.setName,
        isActive: gameSets.isActive,
      }).from(gameSets)
        .where(sql`replace(${gameSets.id}, '-', '') like ${prefix + "%"}`)
        .limit(1);
      row = bySlug;
    }
  }

  if (!row || row.isActive === false) return null;

  const shareImageUrl = await lookupRuntimeCover(row.id);
  return {
    id: row.id,
    setName: row.setName,
    slug: setShareSlug(row.setName, row.id),
    shareImageUrl,
  };
}

export async function ensurePlaySetsRuntimeCrop(
  set: ResolvedPlaySetsSet,
  surface: PlaySetsSurface,
): Promise<string | undefined> {
  if (isUsableShareImageUrl(set.shareImageUrl)) return set.shareImageUrl;

  const cachedUrl = playSetsRuntimeCacheUrl(set.id);
  const cachedPath = path.join(getShareOutputBase(), "play-sets", `${set.id}.png`);
  if (fs.existsSync(cachedPath)) return cachedUrl;

  const [countRow] = await db.select({
    n: sql<number>`count(*)::int`,
  }).from(playableCards).where(and(eq(playableCards.gameSetId, set.id), eq(playableCards.isPlayable, true)));

  if (!countRow || Number(countRow.n) < 1) return undefined;

  try {
    const cardSlots = await loadMakerCardSlots(set.id);
    const written = await writePlaySetsRuntimeCrop(set.id, {
      surface,
      setName: set.setName,
      setId: set.id,
      slugOrId: set.slug,
      cardSlots,
    });
    return written.imageUrl;
  } catch (err) {
    console.error("[PlaySetsShare] runtime crop failed:", (err as Error)?.message);
    return undefined;
  }
}
