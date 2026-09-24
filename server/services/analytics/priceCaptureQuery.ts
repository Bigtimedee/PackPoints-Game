/**
 * Pure PriceCapture query + row mapping. No database import, so tests can
 * assert the SQL and player_key format without DATABASE_URL.
 *
 * Year lives on game_sets, not playable_cards. player_key must match the
 * answer_submitted path: rewardEngine.normalizePlayerKey(name, sport || "baseball").
 */
import { normalizePlayerKey } from "../rewardEngine";

export const PRICE_CAPTURE_LIMIT = 1000;

export const PRICE_CAPTURE_SQL = `
SELECT DISTINCT ON (pc.player, gs.year)
  pc.player AS player,
  gs.year AS year,
  gs.sport AS sport,
  pc.game_set_id AS game_set_id,
  pc.cardhedge_card_id AS cardhedge_card_id,
  cdc.payload AS payload
FROM playable_cards pc
JOIN game_sets gs ON gs.id = pc.game_set_id
JOIN card_details_cache cdc ON cdc.card_id = pc.cardhedge_card_id
WHERE pc.player IS NOT NULL AND pc.player <> ''
  AND cdc.expires_at > NOW() - INTERVAL '30 days'
ORDER BY pc.player, gs.year, cdc.fetched_at DESC
LIMIT ${PRICE_CAPTURE_LIMIT}
`.trim();

export type PriceCaptureSourceRow = {
  player?: string | null;
  year?: number | string | null;
  sport?: string | null;
  game_set_id?: string | null;
  cardhedge_card_id?: string | null;
  payload?: { prices?: Array<{ grade?: string; price?: string }> } | null;
};

export type PriceCaptureInsert = {
  capturedOn: string;
  playerKey: string;
  cardhedgeCardId: string | null;
  gameSetId: string | null;
  year: number | null;
  rawPriceCents: number;
  source: "cardhedge";
};

export function mapPriceCaptureRow(
  r: PriceCaptureSourceRow,
  day: string,
): PriceCaptureInsert | null {
  const prices = r.payload?.prices || [];
  const raw = prices.find((p) => /^raw$/i.test(p.grade || "")) || prices[0];
  const rawPriceCents = raw?.price ? Math.round(parseFloat(raw.price) * 100) : null;
  if (rawPriceCents == null || Number.isNaN(rawPriceCents)) return null;

  const yearNum = Number(r.year);
  const year = r.year != null && r.year !== "" && Number.isFinite(yearNum) ? yearNum : null;

  return {
    capturedOn: day,
    playerKey: normalizePlayerKey(String(r.player ?? ""), r.sport || "baseball"),
    cardhedgeCardId: r.cardhedge_card_id || null,
    gameSetId: r.game_set_id || null,
    year,
    rawPriceCents,
    source: "cardhedge",
  };
}
