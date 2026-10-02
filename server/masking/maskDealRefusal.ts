/**
 * Current-mask-version refusal shared by deals and card-pool refresh.
 *
 * The bake writes `{cardId}_${CURRENT_MASK_VERSION}.fail` and sets
 * `blocked_reason` to one of MASK_DEAL_BLOCK_REASONS. `eligibleDealFilter`
 * and Daily 5 `selectCardsForChallenge` both go through `maskNameStillCovered`,
 * which excludes those reasons and those fail-sidecar ids. Refresh uses
 * `refusedAtCurrentMask` so it cannot clear that state. A later bake that
 * deletes the sidecar and clears the reason is what makes the card dealable.
 */
import { sql, type SQL } from "drizzle-orm";
import { currentMaskRefusalIds, readMaskFailureReason } from "./maskReadySidecar";

export const MASK_DEAL_BLOCK_REASONS = [
  "mask_name_uncovered",
  "mask_band_oversized",
  "mask_band_misplaced",
  "name_visible_outside_mask",
] as const;

type CardAlias = "pc" | "playable_cards";

export function isMaskDealBlockReason(reason: string | null | undefined): boolean {
  return !!reason && (MASK_DEAL_BLOCK_REASONS as readonly string[]).includes(reason);
}

/**
 * Why this card is refused at the current mask version, or null when a deal
 * may still serve it. The fail sidecar wins so a refresh that already cleared
 * `blocked_reason` cannot put the card back into a hand.
 */
export function refusedAtCurrentMask(card: { id: string; blockedReason?: string | null }): string | null {
  const sidecar = readMaskFailureReason(card.id);
  if (sidecar) return sidecar;
  if (isMaskDealBlockReason(card.blockedReason)) return card.blockedReason ?? null;
  return null;
}

/** SQL body of `maskNameStillCovered`. Same reasons and the same sidecar ids. */
export function maskRefusalStillClearSql(alias: CardAlias): SQL {
  const covered = sql.join(
    MASK_DEAL_BLOCK_REASONS.map((reason) =>
      sql`${sql.raw(`${alias}.blocked_reason`)} IS DISTINCT FROM ${reason}`),
    sql` AND `,
  );
  const ids = [...currentMaskRefusalIds()];
  if (ids.length === 0) return sql`(${covered})`;
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  return sql`(${covered} AND ${sql.raw(`${alias}.id`)} NOT IN (${idList}))`;
}
