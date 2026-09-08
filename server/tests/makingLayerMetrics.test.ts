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
  assembleFrictionKpis,
  assembleMakingFunnelWindow,
  computeMakerRate,
  computeMakerRateFromFixture,
  computeMakerSupplyGate,
  computeMakingFunnelFromFixture,
  MAKER_SUPPLY_GATE_TARGET,
  makingFunnelSql,
  makingTimeToPublishSql,
  percentileMs,
} from "../services/makingLayerMetrics";
import { MAKING_LAYER_EVENTS } from "../services/makingLayerEvents";

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
    // lifetime published sets: player-a in-window + player-b outside window; staff + official excluded
    expect(result.publishedSetsNonStaff).toBe(2);
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
    expect(result.publishedSetsNonStaff).toBe(0);
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
    expect(result.publishedSetsNonStaff).toBe(3);
  });

  it("counts co_creator_user_id as a maker (collab publish) and excludes staff co-creators", () => {
    const result = computeMakerRateFromFixture({
      now: NOW,
      users,
      sets: [
        {
          created_by_user_id: "player-a",
          co_creator_user_id: "player-b",
          is_user_created: true,
          created_at: daysAgo(2),
        },
        {
          created_by_user_id: "player-c",
          co_creator_user_id: "staff-1",
          is_user_created: true,
          created_at: daysAgo(1),
        },
      ],
      events: [
        { user_id: "player-a", created_at: daysAgo(1) },
        { user_id: "player-b", created_at: daysAgo(1) },
        { user_id: "player-c", created_at: daysAgo(1) },
        { user_id: "staff-1", created_at: daysAgo(1) },
      ],
    });

    // makers = {player-a, player-b, player-c}; staff co-creator excluded
    expect(result.makers30d).toBe(3);
    expect(result.mau30d).toBe(3);
    expect(result.makerRate).toBe(1);
    // both collab sets have non-admin created_by → count both (staff co-creator does not drop the set)
    expect(result.publishedSetsNonStaff).toBe(2);
  });

  it("counts lifetime published non-staff sets (diligence ≥10 gate), including outside the 30d window", () => {
    const result = computeMakerRateFromFixture({
      now: NOW,
      users,
      sets: Array.from({ length: 10 }, (_, i) => ({
        created_by_user_id: i < 8 ? "player-a" : "player-b",
        is_user_created: true,
        created_at: daysAgo(i < 3 ? 1 : 90),
      })),
      events: [{ user_id: "player-a", created_at: daysAgo(1) }],
    });

    expect(result.publishedSetsNonStaff).toBe(10);
    // only the 3 in-window sets from player-a count as makers_30d
    expect(result.makers30d).toBe(1);
  });
});

describe("computeMakerSupplyGate", () => {
  it("tracks progress toward the ≥10 non-staff published-set gate", () => {
    expect(MAKER_SUPPLY_GATE_TARGET).toBe(10);
    const mid = computeMakerSupplyGate(3);
    expect(mid.publishedSetsNonStaff).toBe(3);
    expect(mid.target).toBe(10);
    expect(mid.remaining).toBe(7);
    expect(mid.progress).toBeCloseTo(0.3);
    expect(mid.reached).toBe(false);

    const done = computeMakerSupplyGate(10);
    expect(done.remaining).toBe(0);
    expect(done.progress).toBe(1);
    expect(done.reached).toBe(true);

    const over = computeMakerSupplyGate(14);
    expect(over.remaining).toBe(0);
    expect(over.progress).toBe(1);
    expect(over.reached).toBe(true);
  });
});

describe("Making Layer funnel — period + staff exclusion", () => {
  const users = [
    { id: "player-a", is_admin: false },
    { id: "player-b", is_admin: false },
    { id: "staff-1", is_admin: true },
  ];

  it("excludes staff events and events outside the window", () => {
    const result = computeMakingFunnelFromFixture({
      now: NOW,
      users,
      windowDays: 7,
      events: [
        { event_type: MAKING_LAYER_EVENTS.makeStarted, user_id: "player-a", created_at: daysAgo(1) },
        { event_type: MAKING_LAYER_EVENTS.makeStarted, user_id: "player-b", created_at: daysAgo(2) },
        { event_type: MAKING_LAYER_EVENTS.makeStarted, user_id: "staff-1", created_at: daysAgo(1) },
        { event_type: MAKING_LAYER_EVENTS.makeStarted, user_id: "player-a", created_at: daysAgo(20) },
        { event_type: MAKING_LAYER_EVENTS.identifySuccess, user_id: "player-a", created_at: daysAgo(1) },
        { event_type: MAKING_LAYER_EVENTS.identifyFail, user_id: "player-b", created_at: daysAgo(1) },
        { event_type: MAKING_LAYER_EVENTS.publishSuccess, user_id: "player-a", created_at: daysAgo(1) },
        { event_type: MAKING_LAYER_EVENTS.shareGenerated, user_id: "player-a", created_at: daysAgo(1) },
        { event_type: MAKING_LAYER_EVENTS.setViewed, user_id: "player-b", created_at: daysAgo(1) },
        { event_type: MAKING_LAYER_EVENTS.setViewed, user_id: null, created_at: daysAgo(1) },
      ],
    });

    const byType = Object.fromEntries(result.steps.map((s) => [s.eventType, s]));
    expect(byType.make_started.uniqueUsers).toBe(2); // a + b; staff + 20d-old excluded
    expect(byType.make_started.events).toBe(2);
    expect(byType.identify_success.uniqueUsers).toBe(1);
    expect(byType.publish_success.uniqueUsers).toBe(1);
    expect(byType.share_generated.uniqueUsers).toBe(1);
    expect(byType.set_viewed.uniqueUsers).toBe(1); // player-b only; anonymous counts as event not user
    expect(byType.set_viewed.events).toBe(2);
    expect(result.fails.identifyFail.uniqueUsers).toBe(1);
    expect(result.fails.publishFail.events).toBe(0);
  });

  it("uses 7d vs 30d windows independently", () => {
    const events = [
      { event_type: MAKING_LAYER_EVENTS.makeStarted, user_id: "player-a", created_at: daysAgo(2) },
      { event_type: MAKING_LAYER_EVENTS.makeStarted, user_id: "player-b", created_at: daysAgo(20) },
      { event_type: MAKING_LAYER_EVENTS.identifySuccess, user_id: "player-b", created_at: daysAgo(20) },
    ];

    const last7 = computeMakingFunnelFromFixture({ now: NOW, users, windowDays: 7, events });
    const last30 = computeMakingFunnelFromFixture({ now: NOW, users, windowDays: 30, events });

    expect(last7.steps[0].uniqueUsers).toBe(1);
    expect(last30.steps[0].uniqueUsers).toBe(2);
    expect(last30.steps[1].uniqueUsers).toBe(1);
    expect(last7.steps[1].uniqueUsers).toBe(0);
  });

  it("reports the largest unique-user drop-off between consecutive success steps", () => {
    const result = assembleMakingFunnelWindow(7, [
      { event_type: "make_started", events: 20, unique_users: 10 },
      { event_type: "identify_success", events: 40, unique_users: 8 },
      { event_type: "name_started", events: 7, unique_users: 7 },
      { event_type: "publish_success", events: 3, unique_users: 2 },
      { event_type: "share_generated", events: 2, unique_users: 1 },
      { event_type: "share_opened", events: 1, unique_users: 1 },
      { event_type: "set_viewed", events: 1, unique_users: 1 },
    ]);

    // name/mixtape → publish loses 5 unique users (largest)
    expect(result.topDropOff).toEqual({
      from: "name_started",
      to: "publish_success",
      lostUsers: 5,
      lostEvents: 4,
    });
    expect(result.friction.nameMixtape.dropOffUsers).toBe(5);
    expect(result.friction.nameMixtape.dropOffRate).toBeCloseTo(5 / 7);
  });

  it("breaks unique-user ties using lost event count", () => {
    const result = assembleMakingFunnelWindow(30, [
      { event_type: "make_started", events: 10, unique_users: 5 },
      { event_type: "identify_success", events: 9, unique_users: 4 },
      { event_type: "name_started", events: 2, unique_users: 3 },
      { event_type: "publish_success", events: 2, unique_users: 3 },
      { event_type: "share_generated", events: 2, unique_users: 3 },
      { event_type: "share_opened", events: 2, unique_users: 3 },
      { event_type: "set_viewed", events: 2, unique_users: 3 },
    ]);

    // make→identify and identify→name both lose 1 user; identify→name loses more events
    expect(result.topDropOff).toEqual({
      from: "identify_success",
      to: "name_started",
      lostUsers: 1,
      lostEvents: 7,
    });
  });

  it("computes Design MAKE_FRICTION KPIs from event_log counts + time-to-publish", () => {
    const zero = { events: 0, uniqueUsers: 0 };
    const kpis = assembleFrictionKpis(
      {
        identifySuccess: { events: 8, uniqueUsers: 4 },
        identifyFail: { events: 2, uniqueUsers: 2 },
        nameStarted: { events: 4, uniqueUsers: 4 },
        publishSuccess: { events: 2, uniqueUsers: 2 },
        shareOpened: { events: 1, uniqueUsers: 1 },
      },
      { p50Ms: 120_000, p90Ms: 300_000, samples: 2 },
    );

    expect(kpis.identifyAttempts).toBe(10);
    expect(kpis.identifyFailRate).toBeCloseTo(0.2);
    expect(kpis.timeToPublish.p50Ms).toBe(120_000);
    expect(kpis.nameMixtape.dropOffUsers).toBe(2);
    expect(kpis.nameMixtape.dropOffRate).toBeCloseTo(0.5);
    expect(kpis.shareOpen.openRate).toBeCloseTo(0.5);
    expect(assembleFrictionKpis({
      identifySuccess: zero,
      identifyFail: zero,
      nameStarted: zero,
      publishSuccess: zero,
      shareOpened: zero,
    }, { p50Ms: null, p90Ms: null, samples: 0 }).identifyFailRate).toBe(0);
  });

  it("pairs last make_started → publish_success for time-to-publish (staff excluded)", () => {
    const result = computeMakingFunnelFromFixture({
      now: NOW,
      users,
      windowDays: 7,
      events: [
        { event_type: MAKING_LAYER_EVENTS.makeStarted, user_id: "player-a", created_at: daysAgo(2) },
        { event_type: MAKING_LAYER_EVENTS.makeStarted, user_id: "player-a", created_at: daysAgo(1) },
        { event_type: MAKING_LAYER_EVENTS.publishSuccess, user_id: "player-a", created_at: new Date(NOW.getTime() - 12 * 60 * 60 * 1000) },
        { event_type: MAKING_LAYER_EVENTS.makeStarted, user_id: "player-b", created_at: daysAgo(1) },
        { event_type: MAKING_LAYER_EVENTS.publishSuccess, user_id: "player-b", created_at: new Date(NOW.getTime() - 6 * 60 * 60 * 1000) },
        { event_type: MAKING_LAYER_EVENTS.makeStarted, user_id: "staff-1", created_at: daysAgo(1) },
        { event_type: MAKING_LAYER_EVENTS.publishSuccess, user_id: "staff-1", created_at: NOW },
      ],
    });

    // player-a: last start 1d ago → publish 12h ago = 12h
    // player-b: start 1d ago → publish 6h ago = 18h
    expect(result.friction.timeToPublish.samples).toBe(2);
    const expected = [12 * 60 * 60 * 1000, 18 * 60 * 60 * 1000];
    expect(result.friction.timeToPublish.p50Ms).toBe(percentileMs(expected, 0.5));
    expect(result.friction.timeToPublish.p90Ms).toBe(percentileMs(expected, 0.9));
  });

  it("SQL keeps the same staff-exclusion predicate as Maker Rate", () => {
    const flattenSql = (value: unknown): string => {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object") return "";
      const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
      if (!chunks) return JSON.stringify(value);
      return chunks.map(flattenSql).join("");
    };
    const compiled = flattenSql(makingFunnelSql(7));
    expect(compiled).toContain("COALESCE");
    expect(compiled).toContain("is_admin");
    expect(compiled).toContain("event_log");
    expect(compiled).toContain("make_started");
    expect(compiled).toContain("name_started");
    expect(compiled).toContain("share_opened");
    expect(compiled).toContain("set_viewed");
    expect(compiled).toContain("false");
    const ttp = flattenSql(makingTimeToPublishSql(30));
    expect(ttp).toContain("publish_success");
    expect(ttp).toContain("make_started");
    expect(ttp).toContain("is_admin");
  });
});
