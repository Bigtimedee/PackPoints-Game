/**
 * Public /sets index: integrated active sets the game can deal.
 * UGC (is_user_created) is never listed. Publishing is closed.
 */
import type { Request, Response } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { contentAssets, gameSets, playableCards, users } from "@shared/schema";
import { db } from "../db";
import { userSetPlayCountSql } from "../routes/userSetCounts";
import { createdAtToIso, sanitizeCoverCardUrls, usablePublicImageUrl } from "../routes/userSetPreview";
import {
  PUBLIC_SET_MIN_ELIGIBLE_CARDS,
  dedupeSetsByNameYearSport,
  eligibleDealFilter,
  eligiblePlayableCardCountSql,
} from "./playableSetEligibility";

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
  const rows = await db
    .select({
      id: gameSets.id,
      setName: gameSets.setName,
      sport: gameSets.sport,
      brand: gameSets.brand,
      year: gameSets.year,
      makerNote: gameSets.makerNote,
      createdAt: gameSets.createdAt,
      makerUsername: users.username,
      isUserCreated: gameSets.isUserCreated,
      cardCount: eligiblePlayableCardCountSql,
      playCount: userSetPlayCountSql,
    })
    .from(gameSets)
    .leftJoin(users, eq(users.id, gameSets.createdByUserId))
    .where(and(eq(gameSets.isActive, true), eq(gameSets.isUserCreated, false)))
    .orderBy(asc(gameSets.year), asc(gameSets.setName));

  const { kept } = dedupeSetsByNameYearSport(
    rows.map((row) => ({
      ...row,
      cardCount: Number(row.cardCount) || 0,
      playCount: Number(row.playCount) || 0,
    })),
  );

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
  const [coverRows, shareRows] = await Promise.all([
    db
      .select({
        gameSetId: playableCards.gameSetId,
        imageUrl: playableCards.imageUrl,
        createdAt: playableCards.createdAt,
      })
      .from(playableCards)
      .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
      .where(and(
        inArray(playableCards.gameSetId, ids),
        eligibleDealFilter("playable_cards"),
        sql`LOWER(playable_cards.category) = LOWER(game_sets.sport)`,
      ))
      .orderBy(asc(playableCards.createdAt)),
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

  const covers = new Map<string, string[]>();
  for (const cover of coverRows) {
    const list = covers.get(cover.gameSetId) ?? [];
    if (list.length >= 8) continue;
    if (cover.imageUrl) list.push(cover.imageUrl);
    covers.set(cover.gameSetId, list);
  }

  const shares = new Map<string, string | undefined>();
  for (const asset of shareRows) {
    if (!asset.sourceEventId) continue;
    const setId = asset.sourceEventId.replace(/^maker_set_/, "");
    const url = usablePublicImageUrl((asset.metadata as { imageUrl?: string } | null)?.imageUrl);
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
