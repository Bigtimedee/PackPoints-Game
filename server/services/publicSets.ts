/**
 * Public /sets index: integrated active sets the game can deal.
 * UGC (is_user_created) is never listed. Publishing is closed.
 */
import type { Request, Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { normalizePlaySetsSetRef, playSetsDashedUuid, playSetsSlugIdPrefix } from "@shared/playSetsShare";
import { addPackptsDays, getPackptsDayKey } from "@shared/packptsDay";
import { publicSetShareUrl } from "@shared/setCoverUrl";
import { contentAssets, gameSets } from "@shared/schema";
import { db } from "../db";
import { setIdPrefixFromShareSlug } from "../contentFactory/makerShareSlug";
import { userSetPlayCountSql } from "../routes/userSetCounts";
import { createdAtToIso, sanitizeCoverCardUrls } from "../routes/userSetPreview";
import { loadActiveIntegratedSets } from "./integratedDealSets";
import { MAKING_LAYER_EVENTS, logMakingLayerEvent, requestUserId } from "./makingLayerEvents";
import {
  PUBLIC_SET_MIN_ELIGIBLE_CARDS,
  eligiblePlayableCardCountSql,
} from "./playableSetEligibility";
import { readyMaskedCoverUrls } from "./setCovers";

export interface PublicSetListRow {
  id: string;
  setName: string;
  sport: string;
  brand: string;
  year: number;
  makerNote: string | null;
  createdAt: string | null;
  makerUsername: string | null;
  isUserCreated: boolean;
  cardCount: number;
  playCount: number;
  shareImageUrl?: string;
  coverCardUrls: string[];
}

export function parseSetsListQuery(query: { limit?: unknown; offset?: unknown }): { limit: number; offset: number } {
  const limit = Math.min(Number(query.limit) || 20, 50);
  const offset = Number(query.offset) || 0;
  return {
    limit: limit < 1 ? 20 : limit,
    offset: offset < 0 ? 0 : offset,
  };
}

export async function listIntegratedPublicSets(opts: { limit: number; offset: number }): Promise<PublicSetListRow[]> {
  const kept = await loadActiveIntegratedSets();

  const eligible = kept
    .filter((row) => row.cardCount >= PUBLIC_SET_MIN_ELIGIBLE_CARDS)
    .sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });

  const page = eligible.slice(opts.offset, opts.offset + opts.limit);
  if (page.length === 0) return [];

  const ids = page.map((row) => row.id);
  const [covers, shareRows] = await Promise.all([
    readyMaskedCoverUrls(ids),
    db
      .select({
        sourceEventId: contentAssets.sourceEventId,
        metadata: contentAssets.metadata,
      })
      .from(contentAssets)
      .where(and(
        eq(contentAssets.assetType, "MAKER_SHARE_CARD"),
        inArray(contentAssets.sourceEventId, ids.map((id) => `maker_set_${id}`)),
      )),
  ]);

  const shares = new Map<string, string | undefined>();
  for (const asset of shareRows) {
    if (!asset.sourceEventId) continue;
    const setId = asset.sourceEventId.replace(/^maker_set_/, "");
    const url = publicSetShareUrl((asset.metadata as { imageUrl?: string } | null)?.imageUrl);
    if (url) shares.set(setId, url);
  }

  return page.map((row) => {
    const shareImageUrl = shares.get(row.id);
    return {
      id: row.id,
      setName: row.setName,
      sport: row.sport,
      brand: row.brand,
      year: row.year,
      makerNote: row.makerNote,
      createdAt: createdAtToIso(row.createdAt),
      makerUsername: row.makerUsername ?? null,
      isUserCreated: false,
      cardCount: row.cardCount,
      playCount: row.playCount,
      ...(shareImageUrl ? { shareImageUrl } : {}),
      coverCardUrls: sanitizeCoverCardUrls(covers.get(row.id) ?? []),
    };
  });
}

export async function handlePublicSetsIndex(req: Request, res: Response): Promise<void> {
  try {
    const sets = await listIntegratedPublicSets(parseSetsListQuery(req.query));
    res.json({ sets });
  } catch (error) {
    console.error("[Sets] GET /api/sets error:", error);
    res.status(500).json({ error: "Failed to list sets" });
  }
}

const publicSetColumns = {
  id: gameSets.id,
  setName: gameSets.setName,
  sport: gameSets.sport,
  brand: gameSets.brand,
  year: gameSets.year,
  makerNote: gameSets.makerNote,
  isUserCreated: gameSets.isUserCreated,
  createdByUserId: gameSets.createdByUserId,
  coCreatorUserId: gameSets.coCreatorUserId,
  createdAt: gameSets.createdAt,
  cardCount: eligiblePlayableCardCountSql,
  playCount: userSetPlayCountSql,
  makerUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${gameSets.createdByUserId})`,
  coCreatorUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${gameSets.coCreatorUserId})`,
};

export async function handlePublicSetDetail(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const setRef = normalizePlaySetsSetRef(id) ?? id;
    const dashedId = playSetsDashedUuid(setRef);
    const [set] = await db.select(publicSetColumns).from(gameSets).where(eq(gameSets.id, dashedId ?? setRef)).limit(1);

    let resolved = set;
    if (!resolved) {
      const prefix = playSetsSlugIdPrefix(setRef) ?? setIdPrefixFromShareSlug(id);
      if (prefix) {
        const [bySlug] = await db.select(publicSetColumns).from(gameSets)
          .where(sql`replace(${gameSets.id}, '-', '') like ${prefix + "%"}`)
          .limit(1);
        resolved = bySlug;
      }
    }

    if (!resolved) {
      res.status(404).json({ error: "Set not found" });
      return;
    }

    if (resolved.isUserCreated) {
      logMakingLayerEvent(MAKING_LAYER_EVENTS.setViewed, requestUserId(req as any), {
        setId: resolved.id,
        isUserCreated: true,
      });
    }

    const [asset] = await db.select({ metadata: contentAssets.metadata })
      .from(contentAssets)
      .where(eq(contentAssets.sourceEventId, `maker_set_${resolved.id}`))
      .limit(1);
    const shareImageUrl = publicSetShareUrl((asset?.metadata as { imageUrl?: string } | null)?.imageUrl);

    const coverUrls = (await readyMaskedCoverUrls([resolved.id])).get(resolved.id) ?? [];
    const year = typeof resolved.year === "number" ? resolved.year : null;
    const previewCards = coverUrls.map((imageUrl) => ({ imageUrl, year }));

    const viewerId = requestUserId(req as any);
    let playedToday = false;
    if (viewerId) {
      const today = getPackptsDayKey();
      const tomorrow = addPackptsDays(today, 1);
      const played = await db.execute(sql`
        SELECT 1 AS hit
        FROM game_sessions
        WHERE user_id = ${viewerId}
          AND status = 'completed'
          AND (questions->0->'card'->>'gameSetId') = ${resolved.id}
          AND completed_at IS NOT NULL
          AND completed_at >= ${today}
          AND completed_at < ${tomorrow}
        LIMIT 1
      `);
      playedToday = played.rows.length > 0;
    }

    res.json({ ...resolved, shareImageUrl, previewCards, playedToday });
  } catch (error) {
    console.error("[Sets] GET /api/sets/:id error:", error);
    res.status(500).json({ error: "Failed to get set" });
  }
}
