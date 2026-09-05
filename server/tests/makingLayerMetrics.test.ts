/**
 * makingLayerMetrics.test.ts
 *
 * Pure SQL-fixture tests for Maker Rate:
 *   makers_30d / mau_30d (event_log activity), excluding users.is_admin.
 * Proves period alignment + staff exclusion without a live DB.
 */
import { vi, describe, it, expect } from "vitest";

// Neutralize db import inside makingLayerMetrics.ts (SQL execute path unused here)
vi.mock("../db", () => ({ db: { execute: vi.fn() }, pool: {} }));

import {
  computeMakerRate,
  computeMakerRateFromFixture,
} from "../services/makingLayerMetrics";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("computeMakerRate", () => {
  it("returns 0 when mau is 0", () => {
    expect(computeMakerRate(5, 0)).toBe(0);
  });

  it("returns makers/mau as a decimal", () => {
    expect(computeMakerRate(2, 10)).toBe(0.2);
  });
});

describe("Maker Rate SQL fixture — period + staff exclusion", () => {
  const users = [
    { id: "player-a", is_admin: false },
    { id: "player-b", is_admin: false },
    { id: "player-c", is_admin: false },
    { id: "staff-1", is_admin: true },
  ];

  it("uses 30d window for makers (not lifetime) and event_log MAU", () => {
    // player-a: set in window → maker
    // player-b: set outside window only → NOT maker (period mismatch fix)
    // player-c: active in event_log, no set → in MAU only
    // staff-1: set + activity in window → excluded from both
    const result = computeMakerRateFromFixture({
      now: NOW,
      users,
      sets: [
        { created_by_user_id: "player-a", is_user_created: true, created_at: daysAgo(5) },
        { created_by_user_id: "player-b", is_user_created: true, created_at: daysAgo(60) },
        { created_by_user_id: "staff-1", is_user_created: true, created_at: daysAgo(2) },
        { created_by_user_id: "player-a", is_user_created: false, created_at: daysAgo(1) }, // official set ignored
      ],
      events: [
        { user_id: "player-a", created_at: daysAgo(1) },
        { user_id: "player-b", created_at: daysAgo(3) },
        { user_id: "player-c", created_at: daysAgo(10) },
        { user_id: "staff-1", created_at: daysAgo(1) },
        { user_id: "player-b", created_at: daysAgo(45) }, // outside window
      ],
    });

    // makers_30d = {player-a} only
    expect(result.makers30d).toBe(1);
    // mau_30d = {player-a, player-b, player-c} — staff excluded
    expect(result.mau30d).toBe(3);
    expect(result.makerRate).toBeCloseTo(1 / 3);
  });

  it("excludes staff from numerator even if they published in-window", () => {
    const result = computeMakerRateFromFixture({
      now: NOW,
      users,
      sets: [
        { created_by_user_id: "staff-1", is_user_created: true, created_at: daysAgo(1) },
      ],
      events: [
        { user_id: "player-a", created_at: daysAgo(1) },
        { user_id: "staff-1", created_at: daysAgo(1) },
      ],
    });

    expect(result.makers30d).toBe(0);
    expect(result.mau30d).toBe(1); // player-a only
    expect(result.makerRate).toBe(0);
  });

  it("counts distinct makers once across multiple sets in window", () => {
    const result = computeMakerRateFromFixture({
      now: NOW,
      users,
      sets: [
        { created_by_user_id: "player-a", is_user_created: true, created_at: daysAgo(1) },
        { created_by_user_id: "player-a", is_user_created: true, created_at: daysAgo(2) },
        { created_by_user_id: "player-b", is_user_created: true, created_at: daysAgo(3) },
      ],
      events: [
        { user_id: "player-a", created_at: daysAgo(1) },
        { user_id: "player-b", created_at: daysAgo(1) },
      ],
    });

    expect(result.makers30d).toBe(2);
    expect(result.mau30d).toBe(2);
    expect(result.makerRate).toBe(1);
  });
});
