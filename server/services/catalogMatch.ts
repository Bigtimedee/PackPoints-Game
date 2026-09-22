/**
 * Read-only catalog match for /make.
 * Selects integrated playable sets. Does not insert cards, sets, or photos.
 */
import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { catalogCards, gameSets, playableCards } from "@shared/schema";
import { setShareSlug } from "../contentFactory/makerShareSlug";
import { identifyCardFromPhoto } from "./snapToSet";
import {
  emptyCatalogMatch,
  playerSearchToken,
  resolveCatalogMatch,
  type CatalogMatchCore,
  type CatalogMatchResponse,
  type CatalogMatchSet,
  type IdentifyFields,
  type IntegratedMembership,
} from "@shared/catalogMatch";

export type IdentifyMatchOutcome =
  | { kind: "retry"; status: 422; error: string; reason: string }
  | { kind: "match"; body: CatalogMatchResponse };

function ilikeContains(token: string): string {
  const safe = token.replace(/[%_\\]/g, "");
  return `%${safe}%`;
}

function withSlugs(core: CatalogMatchCore, confidence: CatalogMatchResponse["confidence"]): CatalogMatchResponse {
  const sets: CatalogMatchSet[] = core.match.sets.map((set) => ({
    ...set,
    slug: setShareSlug(set.name, set.id),
  }));
  return {
    confidence,
    catalogCardId: core.catalogCardId,
    candidates: core.candidates,
    card: core.card,
    match: { status: core.match.status, sets },
  };
}

async function playableCounts(setIds: string[]): Promise<Map<string, number>> {
  if (setIds.length === 0) return new Map();
  const rows = await db
    .select({
      gameSetId: playableCards.gameSetId,
      n: sql<number>`count(*)::int`,
    })
    .from(playableCards)
    .where(and(inArray(playableCards.gameSetId, setIds), eq(playableCards.isPlayable, true)))
    .groupBy(playableCards.gameSetId);
  return new Map(rows.map((row) => [row.gameSetId, Number(row.n)]));
}

/** Membership query is limited to active, non-user-created sets. Scoring drops them again. */
export async function matchIdentifiedCardReadOnly(fields: IdentifyFields): Promise<CatalogMatchCore> {
  const token = playerSearchToken(fields.playerName);
  if (!token) return emptyCatalogMatch();
  const needle = ilikeContains(token);
  if (needle === "%%") return emptyCatalogMatch();

  const catalog = await db
    .select({
      id: catalogCards.id,
      player: catalogCards.player,
      year: catalogCards.year,
      brand: catalogCards.brand,
      setName: catalogCards.setName,
      cardNumber: catalogCards.cardNumber,
    })
    .from(catalogCards)
    .where(ilike(catalogCards.player, needle))
    .limit(40);

  const rows = await db
    .select({
      setId: gameSets.id,
      setName: gameSets.setName,
      year: gameSets.year,
      brand: gameSets.brand,
      isUserCreated: gameSets.isUserCreated,
      isActive: gameSets.isActive,
      player: playableCards.player,
      cardNumber: playableCards.number,
      cardSet: playableCards.set,
    })
    .from(playableCards)
    .innerJoin(gameSets, eq(playableCards.gameSetId, gameSets.id))
    .where(
      and(
        eq(gameSets.isUserCreated, false),
        eq(gameSets.isActive, true),
        eq(playableCards.isPlayable, true),
        ilike(playableCards.player, needle),
      ),
    )
    .limit(80);

  const counts = await playableCounts([...new Set(rows.map((row) => row.setId))]);
  const memberships: IntegratedMembership[] = rows.map((row) => ({
    setId: row.setId,
    setName: row.setName,
    year: row.year,
    brand: row.brand,
    isUserCreated: row.isUserCreated,
    isActive: row.isActive,
    cardCount: counts.get(row.setId) ?? 0,
    player: row.player,
    cardNumber: row.cardNumber,
    cardSet: row.cardSet,
  }));

  return resolveCatalogMatch({
    identified: fields,
    catalog,
    memberships,
  });
}

export async function matchCatalogCardById(catalogCardId: string): Promise<CatalogMatchResponse> {
  const id = catalogCardId.trim();
  if (!id) return withSlugs(emptyCatalogMatch(), null);

  const [row] = await db
    .select({
      id: catalogCards.id,
      player: catalogCards.player,
      year: catalogCards.year,
      brand: catalogCards.brand,
      setName: catalogCards.setName,
      cardNumber: catalogCards.cardNumber,
      sport: catalogCards.sport,
    })
    .from(catalogCards)
    .where(eq(catalogCards.id, id))
    .limit(1);

  if (!row?.player) return withSlugs(emptyCatalogMatch(), null);

  const core = await matchIdentifiedCardReadOnly({
    playerName: row.player,
    year: row.year ?? 0,
    brand: row.brand ?? "",
    setName: row.setName ?? "",
    sport: row.sport ?? undefined,
    cardNumber: row.cardNumber,
  });
  return withSlugs(core, null);
}

export async function identifyAndMatchReadOnly(imageBase64: string): Promise<IdentifyMatchOutcome> {
  const result = await identifyCardFromPhoto(imageBase64);
  if (!result.success) {
    if (result.reason === "unreadable") {
      return { kind: "retry", status: 422, error: "Couldn't identify", reason: result.reason };
    }
    return { kind: "match", body: withSlugs(emptyCatalogMatch(), null) };
  }

  const core = await matchIdentifiedCardReadOnly({
    playerName: result.card.playerName,
    year: result.card.year,
    brand: result.card.brand,
    setName: result.card.setName,
    sport: result.card.sport,
    cardNumber: result.card.cardNumber,
  });
  return { kind: "match", body: withSlugs(core, result.card.confidence) };
}
