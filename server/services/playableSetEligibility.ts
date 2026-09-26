/**
 * Cards a solo deal will actually serve.
 * Shared by GET /api/playable-sets, GET /api/sets, GET /api/sets/:id cardCount,
 * and getRandomCardsFromSet so the shelf count and the dealt stack stay the same.
 *
 * Correlated counts must name `game_sets.id` as an identifier. Interpolating
 * the drizzle column rebinds it as a parameter and counts 0.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { gameSets } from "@shared/schema";
import { db } from "../db";
import { cardNotBlockedSql } from "../lib/cardBlocklist";
import { subsetStillUnverified } from "../masking/subsetQuarantine";

/** playQuestionCount floor. Sets under this are not a public shelf row. */
export const PUBLIC_SET_MIN_ELIGIBLE_CARDS = 5;

type CardAlias = "pc" | "playable_cards";

/**
 * A post-bake name leak sets blocked_reason and drops is_playable.
 * `mask_name_uncovered` is the plate check. `name_visible_outside_mask` is a
 * surname read anywhere else on the baked JPEG (jersey, signature, headline).
 * Enforce mode of the band guard sets mask_band_oversized or mask_band_misplaced.
 * Deals exclude those reasons on their own, so a card cannot slip back in
 * while is_playable is flipped true and the sidecar still records the failure.
 * Report mode does not write the band reasons.
 */
export function maskNameStillCovered(alias: CardAlias): SQL {
  return sql`(
    ${sql.raw(`${alias}.blocked_reason`)} IS DISTINCT FROM 'mask_name_uncovered'
    AND ${sql.raw(`${alias}.blocked_reason`)} IS DISTINCT FROM 'mask_band_oversized'
    AND ${sql.raw(`${alias}.blocked_reason`)} IS DISTINCT FROM 'mask_band_misplaced'
    AND ${sql.raw(`${alias}.blocked_reason`)} IS DISTINCT FROM 'name_visible_outside_mask'
  )`;
}

/**
 * Eligibility body for one card alias. Sport match is added by the caller
 * because the sport expression is either `game_sets.sport` or a bound value.
 */
export function eligibleDealFilter(alias: CardAlias): SQL {
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
    AND ${cardNotBlockedSql(alias)}
    AND ${subsetStillUnverified(alias)}
  `;
}

export const eligiblePlayableCardCountSql = sql<number>`(
  SELECT COUNT(*)::int
  FROM playable_cards pc
  WHERE pc.game_set_id = game_sets.id
    AND ${eligibleDealFilter("pc")}
    AND LOWER(pc.category) = LOWER(game_sets.sport)
)`;

/** Active integrated sets. Counts are eligible deals, not raw imported rows. No card ids. */
export async function eligibleCountsByActiveSet(): Promise<Array<{ setId: string; setName: string; count: number }>> {
  const rows = await db
    .select({
      setId: gameSets.id,
      setName: gameSets.setName,
      count: eligiblePlayableCardCountSql,
    })
    .from(gameSets)
    .where(and(eq(gameSets.isActive, true), eq(gameSets.isUserCreated, false)));
  return rows.map((row) => ({
    setId: row.setId,
    setName: row.setName,
    count: Number(row.count) || 0,
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
