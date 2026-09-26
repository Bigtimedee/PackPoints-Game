/**
 * Sets whose subset cards use a different name plate than the base profile.
 * A card stays out of deals and covers until the per-card bake and the
 * surname check both pass (`name_layout_verified`).
 * There is no subset column. The text fields are variant, description,
 * number, and player.
 */
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import { playableCards } from "@shared/schema";
import { db } from "../db";
import { MASK_LAYOUT_SET_IDS } from "./maskProfiles";

export const SUBSET_QUARANTINE_SET_IDS: readonly string[] = [
  MASK_LAYOUT_SET_IDS.toppsFootball1987,
];

/**
 * Postgres `~*` pattern. Keep this in step with `cardMetadataMarksSubset`.
 * `the` and a bare player name do not match.
 */
export const SUBSET_METADATA_SQL = String.raw`\m(record[[:space:]]*breakers?|leaders?|check[[:space:]]*lists?|team[[:space:]]+leaders?)\M`;

const SUBSET_METADATA_RE = /\b(record\s*breakers?|leaders?|check\s*lists?|team\s+leaders?)\b/i;

export function setQuarantinesSubsets(gameSetId: string | null | undefined): boolean {
  const id = (gameSetId || "").trim().toLowerCase();
  return SUBSET_QUARANTINE_SET_IDS.some((setId) => setId.toLowerCase() === id);
}

export function cardMetadataMarksSubset(card: {
  player?: string | null;
  description?: string | null;
  variant?: string | null;
  number?: string | null;
}): boolean {
  const haystack = [card.variant, card.description, card.number, card.player]
    .filter((part) => part && part.trim())
    .join(" ");
  if (!haystack) return false;
  return SUBSET_METADATA_RE.test(haystack);
}

type CardAlias = "pc" | "playable_cards";

/** Eligible deals drop an unverified subset on a flagged set. */
export function subsetStillUnverified(alias: CardAlias): SQL {
  if (SUBSET_QUARANTINE_SET_IDS.length === 0) return sql`TRUE`;
  const ids = sql.join(SUBSET_QUARANTINE_SET_IDS.map((id) => sql`${id}`), sql`, `);
  const col = (name: string) => sql.raw(`${alias}.${name}`);
  return sql`NOT (
    ${col("game_set_id")} IN (${ids})
    AND ${col("name_layout_verified")} = false
    AND (
      coalesce(${col("variant")}, '') || ' ' ||
      coalesce(${col("description")}, '') || ' ' ||
      coalesce(${col("number")}, '') || ' ' ||
      coalesce(${col("player")}, '')
    ) ~* ${SUBSET_METADATA_SQL}
  )`;
}

/** After the surname check passes, a subset card on a flagged set may be dealt. */
export async function markSubsetLayoutVerified(cardId: string): Promise<void> {
  const [row] = await db
    .select({
      gameSetId: playableCards.gameSetId,
      player: playableCards.player,
      description: playableCards.description,
      variant: playableCards.variant,
      number: playableCards.number,
    })
    .from(playableCards)
    .where(eq(playableCards.id, cardId))
    .limit(1);
  if (!row || !setQuarantinesSubsets(row.gameSetId) || !cardMetadataMarksSubset(row)) return;
  await db
    .update(playableCards)
    .set({ nameLayoutVerified: true, updatedAt: new Date() })
    .where(eq(playableCards.id, cardId));
}

/**
 * Count subset rows on flagged sets and bake a few that have not passed yet.
 * Off the request path. Logs counts only, never a player name.
 * A matched count of 0 means variant, description, number, and player did not
 * identify a subset. There is no subset column.
 */
export async function logAndBakeUnverifiedSubsets(limit = 8): Promise<void> {
  if (process.env.VITEST === "true") return;
  if (SUBSET_QUARANTINE_SET_IDS.length === 0) return;
  const rows = await db
    .select({
      id: playableCards.id,
      gameSetId: playableCards.gameSetId,
      player: playableCards.player,
      description: playableCards.description,
      variant: playableCards.variant,
      number: playableCards.number,
      imageUrl: playableCards.imageUrl,
      setName: playableCards.set,
      imageRotation: playableCards.imageRotation,
      nameLayoutVerified: playableCards.nameLayoutVerified,
      isPlayable: playableCards.isPlayable,
      blockedReason: playableCards.blockedReason,
    })
    .from(playableCards)
    .where(inArray(playableCards.gameSetId, [...SUBSET_QUARANTINE_SET_IDS]));
  let matched = 0;
  let verified = 0;
  const pending: typeof rows = [];
  for (const row of rows) {
    if (!cardMetadataMarksSubset(row)) continue;
    matched += 1;
    if (row.nameLayoutVerified) {
      verified += 1;
      continue;
    }
    if (row.isPlayable && !row.blockedReason && row.imageUrl) pending.push(row);
  }
  console.log(`[MaskCheck] subset quarantine matched=${matched} verified=${verified} pending=${pending.length}`);
  if (matched === 0) {
    console.log("[MaskCheck] subset quarantine metadata matched no rows. Fields checked: variant, description, number, player. No subset column.");
  }
  const batch = pending.slice(0, limit);
  if (batch.length === 0) return;
  const { bakeMaskedCardFromUrl } = await import("./maskingService");
  for (const row of batch) {
    await bakeMaskedCardFromUrl({
      cardId: row.id,
      imageUrl: row.imageUrl || "",
      playerName: row.player || "",
      setHint: row.setName,
      gameSetId: row.gameSetId,
      imageRotation: row.imageRotation,
    });
  }
}
