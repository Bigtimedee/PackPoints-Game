/**
 * Weekly rebate liability and monthly Stripe revenue (GTM audit, section 8).
 * Read-only. Served by GET /api/qa/rebate-liability. All amounts in cents.
 *
 * pending: applies waiting for eBay's report (redemption_credit PENDING; the
 *   most PackPTS could owe if every one converts).
 * held: granted rebates still inside the payout hold (PAYOUT_HOLD_DAYS).
 * available: user balances minus held, which users may request.
 * paid: payouts marked PAID. requested: payout requests not yet reviewed.
 * clawedBack: reversals (ADJUSTMENT rows below zero).
 * cost: granted minus clawed back (what rebates have cost PackPTS to date).
 */
import { pool } from "../db";
import { PAYOUT_HOLD_DAYS } from "./guardrailPolicy";

export type LiabilityQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
const n = (v: unknown) => Number(v ?? 0) || 0;

export async function buildRebateLiabilityReport(weeks = 12, q: LiabilityQuery = (t, p) => pool.query(t, p as any[])) {
  const w = Math.max(1, Math.min(52, Math.floor(weeks) || 12));
  const [t] = (await q(`
    SELECT
      (SELECT coalesce(sum(credit_cents), 0) FROM redemption_credit WHERE status = 'PENDING')::bigint AS pending_cents,
      (SELECT count(*) FROM redemption_credit WHERE status = 'PENDING')::int AS pending_count,
      (SELECT coalesce(sum(amount_cents), 0) FROM rebate_ledger WHERE type = 'GRANT' AND created_at > now() - make_interval(days => $1))::bigint AS held_cents,
      (SELECT coalesce(sum(amount_cents), 0) FROM rebate_ledger)::bigint AS balance_cents,
      (SELECT coalesce(sum(amount_cents), 0) FROM rebate_ledger WHERE type = 'GRANT')::bigint AS granted_cents,
      (SELECT coalesce(-sum(amount_cents), 0) FROM rebate_ledger WHERE type = 'ADJUSTMENT' AND amount_cents < 0)::bigint AS clawed_cents,
      (SELECT coalesce(sum(amount_cents), 0) FROM rebate_payout_requests WHERE status = 'PAID')::bigint AS paid_cents,
      (SELECT count(*) FROM rebate_payout_requests WHERE status = 'PAID')::int AS paid_count,
      (SELECT coalesce(sum(amount_cents), 0) FROM rebate_payout_requests WHERE status = 'REQUESTED')::bigint AS requested_cents,
      (SELECT count(*) FROM rebate_payout_requests WHERE status = 'REQUESTED')::int AS requested_count`, [PAYOUT_HOLD_DAYS])).rows;

  const weekly = (await q(`
    WITH wk AS (
      SELECT generate_series(date_trunc('week', (now() AT TIME ZONE 'America/Chicago')) - make_interval(weeks => $1 - 1),
                             date_trunc('week', (now() AT TIME ZONE 'America/Chicago')), interval '1 week')::date AS week)
    SELECT wk.week::text AS week,
      (SELECT count(*) FROM redemption_credit rc WHERE date_trunc('week', rc.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')::date = wk.week)::int AS applies,
      (SELECT coalesce(sum(amount_cents), 0) FROM rebate_ledger r WHERE r.type = 'GRANT' AND date_trunc('week', r.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')::date = wk.week)::bigint AS granted_cents,
      (SELECT coalesce(-sum(amount_cents), 0) FROM rebate_ledger r WHERE r.type = 'ADJUSTMENT' AND r.amount_cents < 0 AND date_trunc('week', r.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')::date = wk.week)::bigint AS clawed_cents,
      (SELECT coalesce(sum(amount_cents), 0) FROM rebate_payout_requests p WHERE p.status = 'PAID' AND date_trunc('week', coalesce(p.reviewed_at, p.updated_at) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')::date = wk.week)::bigint AS paid_cents
    FROM wk ORDER BY wk.week`, [w])).rows;

  const revenue = (await q(`
    SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago'), 'YYYY-MM') AS month,
      count(*)::int AS paid_checkouts,
      coalesce(sum(amount_cents), 0)::bigint AS gross_cents,
      count(DISTINCT user_id)::int AS paying_users
    FROM stripe_checkout_sessions s
    WHERE status = 'PAID' AND user_id NOT IN (SELECT id FROM users WHERE is_test_account OR is_admin)
    GROUP BY 1 ORDER BY 1 DESC LIMIT 12`)).rows;
  const refunds = (await q(`
    SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago'), 'YYYY-MM') AS month,
      coalesce(sum(amount_cents), 0)::bigint AS refunded_cents
    FROM payment_events WHERE event_type IN ('REFUNDED', 'DISPUTE_LOST') GROUP BY 1`)).rows;
  const refundBy = new Map(refunds.map((r) => [r.month, n(r.refunded_cents)]));

  const held = Math.min(n(t?.held_cents), Math.max(0, n(t?.balance_cents)));
  return {
    generatedAt: new Date().toISOString(),
    timezone: "America/Chicago",
    holdDays: PAYOUT_HOLD_DAYS,
    totals: {
      pendingCents: n(t?.pending_cents), pendingCount: n(t?.pending_count),
      heldCents: held,
      availableCents: Math.max(0, n(t?.balance_cents) - held),
      outstandingBalanceCents: n(t?.balance_cents),
      grantedCents: n(t?.granted_cents),
      clawedBackCents: n(t?.clawed_cents),
      paidCents: n(t?.paid_cents), paidCount: n(t?.paid_count),
      requestedCents: n(t?.requested_cents), requestedCount: n(t?.requested_count),
      costCents: n(t?.granted_cents) - n(t?.clawed_cents),
    },
    weekly: weekly.map((r) => ({
      weekStarting: r.week, applies: n(r.applies), grantedCents: n(r.granted_cents), clawedBackCents: n(r.clawed_cents),
      paidCents: n(r.paid_cents), costCents: n(r.granted_cents) - n(r.clawed_cents),
    })),
    stripeRevenueMonthly: revenue.map((r) => ({
      month: r.month, paidCheckouts: n(r.paid_checkouts), payingUsers: n(r.paying_users), grossCents: n(r.gross_cents),
      refundedCents: refundBy.get(r.month) ?? 0, netCents: n(r.gross_cents) - (refundBy.get(r.month) ?? 0),
    })),
    notes: "Stripe revenue is read from stripe_checkout_sessions marked PAID (test and staff accounts excluded); refunds from payment_events. Subscription renewals that do not create a checkout session are not included.",
  };
}
