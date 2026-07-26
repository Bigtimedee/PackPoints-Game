/**
 * Clean-Signal & Data Governance (ANALYTICS_PROMPTS.md, Prompt 8).
 *
 * Makes the data asset survive a buyer's technical AND legal diligence:
 *  - PII audit: prove the analytics schema holds no email/PII (keyed on hashes)
 *  - clean/raw split: confirm flagged/bot users are excluded from the credible
 *    layer, side by side with the raw layer
 *  - data-quality checks: reconciliation, null-dimension spikes, freshness
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

// Columns that would indicate PII leaked into the analytics asset. The spine is
// keyed on user_hash only; finding any of these in analytics_* tables is a
// diligence-failing defect.
const PII_COLUMN_PATTERNS = ["email", "phone", "first_name", "last_name", "password", "ssn", "address", "ip"];
const ANALYTICS_TABLES = ["analytics_events", "card_attention_daily", "set_engagement_daily", "commerce_funnel_daily", "card_price_history"];

export async function piiAudit(): Promise<{ clean: boolean; offendingColumns: { table: string; column: string }[] }> {
  const rows = (await db.execute(sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${ANALYTICS_TABLES})
  `)).rows as any[];
  const offending = rows.filter(r =>
    PII_COLUMN_PATTERNS.some(p => String(r.column_name).toLowerCase().includes(p))
  ).map(r => ({ table: r.table_name, column: r.column_name }));
  return { clean: offending.length === 0, offendingColumns: offending };
}

export async function cleanSplit(): Promise<{ cleanEvents: number; rawEvents: number; excludedPct: number }> {
  const [row] = (await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE is_clean)::int AS clean, COUNT(*)::int AS total
    FROM analytics_events
  `)).rows as any[];
  const clean = Number(row?.clean) || 0;
  const total = Number(row?.total) || 0;
  return { cleanEvents: clean, rawEvents: total, excludedPct: total > 0 ? (total - clean) / total : 0 };
}

export async function dataQuality(): Promise<{
  eventsToday: number;
  martReconciled: boolean;
  nullPlayerKeyPct: number;
  latestEventAt: string | null;
  latestPriceCapture: string | null;
  healthy: boolean;
}> {
  const [today] = (await db.execute(sql`
    SELECT COUNT(*)::int AS n, MAX(occurred_at) AS latest,
      COUNT(*) FILTER (WHERE event_type='answer_submitted' AND player_key IS NULL)::int AS null_pk,
      COUNT(*) FILTER (WHERE event_type='answer_submitted')::int AS answers
    FROM analytics_events WHERE occurred_at > NOW() - INTERVAL '1 day'
  `)).rows as any[];
  const [raw] = (await db.execute(sql`SELECT COUNT(*) FILTER (WHERE event_type='answer_submitted' AND player_key IS NOT NULL)::int AS answers FROM analytics_events`)).rows as any[];
  const [mart] = (await db.execute(sql`SELECT COALESCE(SUM(plays),0)::int AS plays FROM card_attention_daily`)).rows as any[];
  const [price] = (await db.execute(sql`SELECT MAX(captured_on) AS latest FROM card_price_history`)).rows as any[];

  const answers = Number(today?.answers) || 0;
  const nullPk = Number(today?.null_pk) || 0;
  const reconciled = (Number(raw?.answers) || 0) === (Number(mart?.plays) || 0);

  const nullPlayerKeyPct = answers > 0 ? nullPk / answers : 0;
  const healthy = reconciled && nullPlayerKeyPct < 0.05;

  return {
    eventsToday: Number(today?.n) || 0,
    martReconciled: reconciled,
    nullPlayerKeyPct,
    latestEventAt: today?.latest ? new Date(today.latest).toISOString() : null,
    latestPriceCapture: price?.latest ?? null,
    healthy,
  };
}

/** Full governance snapshot for the admin panel. */
export async function getGovernanceReport() {
  const [pii, split, dq] = await Promise.all([piiAudit(), cleanSplit(), dataQuality()]);
  return { pii, split, dataQuality: dq };
}
