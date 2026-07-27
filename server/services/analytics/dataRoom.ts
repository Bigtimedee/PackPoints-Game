/**
 * Acquisition Data Room (ANALYTICS_PROMPTS.md, Prompt 9).
 *
 * The diligence-ready executive view: the headline indices, the dataset's size
 * and growth, the unique-signal framing, and exportable marts + a documented
 * read-only API. This is the deliverable screen-shared in the acquisition
 * meeting — it proves the asset is a product, not internal reporting.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getAttentionAlpha } from "./attentionAlpha";
import { getGovernanceReport } from "./governance";

export async function getDataRoomSummary() {
  const [events] = (await db.execute(sql`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '7 days')::int AS last7,
      MIN(occurred_at) AS first_event, MAX(occurred_at) AS last_event
    FROM analytics_events`)).rows as any[];
  const [players] = (await db.execute(sql`SELECT COUNT(DISTINCT player_key)::int AS n FROM card_attention_daily`)).rows as any[];
  const [sets] = (await db.execute(sql`SELECT COUNT(DISTINCT game_set_id)::int AS n FROM set_engagement_daily`)).rows as any[];
  const [prices] = (await db.execute(sql`SELECT COUNT(*)::int AS n, COUNT(DISTINCT captured_on)::int AS days FROM card_price_history`)).rows as any[];
  const [days] = (await db.execute(sql`SELECT COUNT(DISTINCT day)::int AS n FROM card_attention_daily`)).rows as any[];

  const [alpha, governance] = await Promise.all([getAttentionAlpha({ clean: true }), getGovernanceReport()]);

  const firstEvent = events?.first_event ? new Date(events.first_event) : null;
  const historyDays = firstEvent ? Math.max(1, Math.round((Date.now() - firstEvent.getTime()) / 86400000)) : 0;

  return {
    thesis: "PackPTS is the only source of demand-side attention and recognition data for the sports-card market — the pre-transaction signal Fanatics lacks and cannot easily build. Value compounds with time-depth and is non-replicable by a later entrant.",
    dataset: {
      totalEvents: Number(events?.total) || 0,
      eventsLast7Days: Number(events?.last7) || 0,
      distinctPlayers: Number(players?.n) || 0,
      distinctSets: Number(sets?.n) || 0,
      attentionDaysCaptured: Number(days?.n) || 0,
      priceSnapshots: Number(prices?.n) || 0,
      priceDaysCaptured: Number(prices?.days) || 0,
      historyDays,
      firstEventAt: firstEvent ? firstEvent.toISOString() : null,
      lastEventAt: events?.last_event ? new Date(events.last_event).toISOString() : null,
    },
    signatureIndices: [
      { name: "Card Attention Index", api: "/api/admin/analytics/attention" },
      { name: "Recognition Index", api: "/api/admin/analytics/recognition" },
      { name: "Commerce Intent Funnel", api: "/api/admin/analytics/funnel" },
      { name: "Attention Alpha (attention leads price)", api: "/api/admin/analytics/attention-alpha" },
      { name: "Market Pulse (trending)", api: "/api/admin/analytics/trending" },
    ],
    attentionAlpha: { players: alpha.players, bestLag: alpha.bestLag, caveat: alpha.caveat },
    governance,
    exports: ["card_attention_daily", "set_engagement_daily", "commerce_funnel_daily", "card_price_history"],
  };
}

const EXPORTABLE: Record<string, string> = {
  card_attention_daily: "SELECT player_key, day, is_clean, plays, unique_users, correct, incorrect FROM card_attention_daily ORDER BY day DESC, plays DESC",
  set_engagement_daily: "SELECT game_set_id, day, is_clean, starts, plays, unique_users FROM set_engagement_daily ORDER BY day DESC",
  commerce_funnel_daily: "SELECT game_set_id, day, is_clean, listing_clicks FROM commerce_funnel_daily ORDER BY day DESC",
  card_price_history: "SELECT captured_on, player_key, year, raw_price_cents, source FROM card_price_history ORDER BY captured_on DESC",
};

/** CSV export of a whitelisted mart. Returns null for unknown tables. */
export async function exportMartCsv(table: string, limit = 50000): Promise<string | null> {
  const base = EXPORTABLE[table];
  if (!base) return null;
  const rows = (await db.execute(sql.raw(`${base} LIMIT ${Math.min(limit, 100000)}`))).rows as any[];
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}

export function listExportableTables(): string[] {
  return Object.keys(EXPORTABLE);
}
