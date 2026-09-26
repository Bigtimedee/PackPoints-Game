/**
 * Cards a solo deal will actually serve.
 * Shared by GET /api/playable-sets, GET /api/sets, GET /api/sets/:id cardCount,
 * and getRandomCardsFromSet so the shelf count and the dealt stack stay the same.
 *
 * Correlated counts must name `game_sets.id` as an identifier. Interpolating
 * the drizzle column rebinds it as a parameter and counts 0.
 */
import { sql, type SQL } from "drizzle-orm";
import { cardNotBlockedSql } from "../lib/cardBlocklist";

/** playQuestionCount floor. Sets under this are not a public shelf row. */
export const PUBLIC_SET_MIN_ELIGIBLE_CARDS = 5;

type CardAlias = "pc" | "playable_cards";

/**
 * A post-bake name leak sets blocked_reason to mask_name_uncovered.
 * Enforce mode of the band guard sets mask_band_oversized or mask_band_misplaced.
 * Deals exclude those reasons on their own, so a card cannot slip back in
 * while is_playable is flipped true and the sidecar still records the failure.
 * Report mode does not write them.
 */
export function maskNameStillCovered(alias: CardAlias): SQL {
  return sql`(
    ${sql.raw(`${alias}.blocked_reason`)} IS DISTINCT FROM 'mask_name_uncovered'
    AND ${sql.raw(`${alias}.blocked_reason`)} IS DISTINCT FROM 'mask_band_oversized'
    AND ${sql.raw(`${alias}.blocked_reason`)} IS DISTINCT FROM 'mask_band_misplaced'
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
  `;
}

export const eligiblePlayableCardCountSql = sql<number>`(
  SELECT COUNT(*)::int
  FROM playable_cards pc
  WHERE pc.game_set_id = game_sets.id
    AND ${eligibleDealFilter("pc")}
    AND LOWER(pc.category) = LOWER(game_sets.sport)
)`;

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
