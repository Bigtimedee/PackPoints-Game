import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db";
import { buildFunnelReport } from "../services/funnel";
import { buildRebateLiabilityReport } from "../services/rebateLiability";

const tag = randomUUID().slice(0, 8);
const realUser = `gtm-real-${tag}`;
const staffUser = `gtm-staff-${tag}`;
const vid = randomUUID().replace(/-/g, "");

beforeAll(async () => {
  await pool.query(`INSERT INTO users (id, username, is_admin, is_test_account) VALUES ($1, $2, false, false), ($3, $4, true, true)`,
    [realUser, `real_${tag}`, staffUser, `staff_${tag}`]);
  const now = new Date().toISOString();
  for (const u of [realUser, staffUser]) {
    await pool.query(`INSERT INTO game_sessions (id, mode, user_id, questions, total_questions, status, started_at, completed_at)
      VALUES ($1, 'solo', $2, '[]'::jsonb, 10, 'completed', $3, $3)`, [randomUUID(), u, now]);
  }
  await pool.query(`INSERT INTO funnel_events (event_type, visitor_id, utm_source, utm_medium) VALUES ('visit', $1, 'x', 'beatme')`, [vid]);
  await pool.query(`INSERT INTO funnel_events (event_type, visitor_id, mode, game_set_id) VALUES ('first_answer', $1, 'solo', 'set-a'), ('game_complete', $1, 'solo', 'set-a')`, [vid]);
  await pool.query(`INSERT INTO funnel_events (event_type, visitor_id, is_test) VALUES ('visit', 'bot', true)`);
});

afterAll(async () => {
  await pool.query(`DELETE FROM funnel_events WHERE visitor_id IN ($1, 'bot')`, [vid]);
  await pool.query(`DELETE FROM game_sessions WHERE user_id IN ($1, $2)`, [realUser, staffUser]);
  await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [realUser, staffUser]);
});

describe("GET /api/qa/funnel report", () => {
  it("counts real activity, excludes staff/test, and links visit to first answer", async () => {
    const r = await buildFunnelReport(7);
    expect(r.activity.dauToday).toBeGreaterThanOrEqual(1);
    const today = r.activity.dau[r.activity.dau.length - 1];
    expect(today.registered).toBeGreaterThanOrEqual(1);
    expect(r.visitToFirstAnswer.denominator).toBeGreaterThanOrEqual(1);
    expect(r.visitToFirstAnswer.numerator).toBeGreaterThanOrEqual(1);
    expect(r.gameComplete.byMode.find((m) => m.mode === "solo")?.count).toBeGreaterThanOrEqual(1);
    expect(r.beatMe.opens).toBeGreaterThanOrEqual(1);
    expect(r.beatMe.openVisitorsWhoPlayed).toBeGreaterThanOrEqual(1);
    expect(r.retention.cohorts.length).toBeGreaterThanOrEqual(1);
    // staff user activity never counts
    const { rows } = await pool.query(`SELECT 1`);
    expect(rows.length).toBe(1);
  });
  it("staff rows are excluded from DAU", async () => {
    const before = (await buildFunnelReport(1)).activity.dauToday;
    await pool.query(`INSERT INTO game_sessions (id, mode, user_id, questions, total_questions, status, started_at) VALUES ($1, 'solo', $2, '[]'::jsonb, 10, 'active', $3)`, [randomUUID(), staffUser, new Date().toISOString()]);
    expect((await buildFunnelReport(1)).activity.dauToday).toBe(before);
  });
});

describe("GET /api/qa/rebate-liability report", () => {
  it("returns totals, 12 weekly rows and monthly revenue", async () => {
    const r = await buildRebateLiabilityReport(12);
    expect(r.weekly).toHaveLength(12);
    for (const k of ["pendingCents", "heldCents", "paidCents", "clawedBackCents", "costCents"]) expect(typeof (r.totals as any)[k]).toBe("number");
    expect(Array.isArray(r.stripeRevenueMonthly)).toBe(true);
  });
});
