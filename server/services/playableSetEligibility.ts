/**
 * Cards a solo deal will actually serve.
 * Shared by GET /api/playable-sets, GET /api/sets, GET /api/sets/:id cardCount,
 * and getRandomCardsFromSet so the shelf count and the dealt stack stay the same.
 *
 * Correlated counts must name `game_sets.id` as an identifier. Interpolating
 * the drizzle column rebinds it as a parameter and counts 0.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { cardNotBlockedSql, type BlocklistSqlOpts } from "../lib/cardBlocklist";
import { maskRefusalStillClearSql, refusedAtCurrentMask } from "../masking/maskDealRefusal";
import { subsetStillUnverified } from "../masking/subsetQuarantine";

export { refusedAtCurrentMask };

/** playQuestionCount floor. Sets under this are not a public shelf row. */
export const PUBLIC_SET_MIN_ELIGIBLE_CARDS = 5;

type CardAlias = "pc" | "playable_cards";

/**
 * A post-bake name leak sets blocked_reason and drops is_playable.
 * `mask_name_uncovered` is the plate check, including `name_plate_unresolved`
 * on the `{cardId}_${CURRENT_MASK_VERSION}.fail` sidecar. `name_visible_outside_mask`
 * is a surname read anywhere else on the baked JPEG. Enforce mode of the band
 * guard sets mask_band_oversized or mask_band_misplaced.
 * Deals exclude those reasons, and every current-version fail sidecar, so a
 * card cannot slip back in while is_playable is flipped true.
 * Report mode does not write the band reasons.
 */
export function maskNameStillCovered(alias: CardAlias): SQL {
  return maskRefusalStillClearSql(alias);
}

/**
 * Eligibility body for one card alias. Sport match is added by the caller
 * because the sport expression is either `game_sets.sport` or a bound value.
 */
export function eligibleDealFilter(alias: CardAlias, opts?: BlocklistSqlOpts): SQL {
  const a = alias;
  return sql`
    ${sql.raw(`${a}.is_playable`)} = true
    AND ${maskNameStillCovered(alias)}
    AND (${sql.raw(`${a}.content_verified`)} IS NULL OR ${sql.raw(`${a}.content_verified`)} = true)
    AND ${sql.raw(`${a}.image_url`)} IS NOT NULL
    AND ${sql.raw(`${a}.image_url`)} <> ''
    AND ${sql.raw(`${a}.image_url`)} NOT LIKE '%null%'
    AND ${sql.raw(`${a}.image_url`)} LIKE 'https://%'
    AND ${sql.raw(`${a}.image_url`)} NOT LIKE '%s3.amazonaws.com/appforest_uf%05-Baseball%'
    AND ${sql.raw(`${a}.image_url`)} NOT LIKE '%s3.amazonaws.com/appforest_uf%05-Football%'
    AND ${sql.raw(`${a}.image_url`)} NOT LIKE '%s3.amazonaws.com/appforest_uf%05-Basketball%'
    AND ${sql.raw(`${a}.player`)} IS NOT NULL
    AND btrim(${sql.raw(`${a}.player`)}) <> ''
    AND (${sql.raw(`${a}.image_review_status`)} IS NULL OR ${sql.raw(`${a}.image_review_status`)} <> 'rejected')
    AND NOT (
      ${sql.raw(`${a}.quarantine_status`)} = 'QUARANTINED_ADMIN_REVIEW'
      AND ${sql.raw(`${a}.proposed_unplayable`)} = true
    )
    AND ${cardNotBlockedSql(alias, opts)}
    AND ${subsetStillUnverified(alias)}
  `;
}

/**
 * Built per query so the set hold, mask refusal ids, and the card review guard
 * are read at request time, the same as getRandomCardsFromSet.
 */
export function eligiblePlayableCardCountSql(): SQL<number> {
  return sql<number>`(
  SELECT COUNT(*)::int
  FROM playable_cards pc
  WHERE pc.game_set_id = game_sets.id
    AND ${eligibleDealFilter("pc")}
    AND LOWER(pc.category) = LOWER(game_sets.sport)
)`;
}

/**
 * Eligible-deal counts for many sets in one grouped query. Same filter as
 * eligiblePlayableCardCountSql. Shelf lists use this instead of a correlated
 * count per set row, which made /api/sets and /api/playable-sets about 8x
 * slower in production once the card review guard was on.
 * Every requested id is present in the result, 0 when nothing is eligible.
 */
export async function eligibleCountsForSetIds(setIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of setIds) out.set(id, 0);
  if (setIds.length === 0) return out;
  const rows = await db
    .select({
      setId: playableCards.gameSetId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(and(
      inArray(playableCards.gameSetId, setIds),
      eligibleDealFilter("playable_cards"),
      sql`LOWER(playable_cards.category) = LOWER(game_sets.sport)`,
    ))
    .groupBy(playableCards.gameSetId);
  for (const row of rows) out.set(row.setId, Number(row.count) || 0);
  return out;
}

/** Active integrated sets. Counts are eligible deals, not raw imported rows. No card ids. */
export async function eligibleCountsByActiveSet(): Promise<Array<{ setId: string; setName: string; count: number }>> {
  const rows = await db
    .select({
      setId: gameSets.id,
      setName: gameSets.setName,
    })
    .from(gameSets)
    .where(and(eq(gameSets.isActive, true), eq(gameSets.isUserCreated, false)));
  const counts = await eligibleCountsForSetIds(rows.map((row) => row.setId));
  return rows.map((row) => ({
    setId: row.setId,
    setName: row.setName,
    count: counts.get(row.setId) ?? 0,
  }));
}

/** Server log after warm-up. Not a public route. */
export async function logEligibleSetCounts(): Promise<void> {
  const rows = await eligibleCountsByActiveSet();
  for (const row of rows) {
    console.log(`[MaskCheck] eligible set=${row.setId} name=${row.setName} count=${row.count}`);
  }
}

export function dedupeKey(setName: string | null, year: number | null, sport: string | null): string {
  return `${setName}-${year}-${sport}`;
}

export function playableCountOf(set: {
  actualPlayableCards?: number | null;
  cardCount?: number | null;
}): number {
  const raw = set.actualPlayableCards ?? set.cardCount ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Same name + year + sport key as GET /api/playable-sets.
 * Keeps the row with the most eligible cards. A tie keeps the earlier row.
 */
export function dedupeSetsByNameYearSport<T extends {
  setName: string | null;
  year: number | null;
  sport: string | null;
  actualPlayableCards?: number | null;
  cardCount?: number | null;
}>(sets: T[]): { kept: T[]; duplicateNames: string[] } {
  const map = new Map<string, T>();
  const duplicateNames: string[] = [];
  for (const set of sets) {
    const key = dedupeKey(set.setName, set.year, set.sport);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, set);
      continue;
    }
    duplicateNames.push(set.setName || "Unknown");
    if (playableCountOf(set) > playableCountOf(existing)) {
      map.set(key, set);
    }
  }
  return { kept: Array.from(map.values()), duplicateNames };
}
