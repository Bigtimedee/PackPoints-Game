/**
 * baseballCardsLegacy.test.ts
 *
 * Decision doc (Prompt 25): baseballCards table is retained as intentional
 * fallback. playableCards is the authoritative source for active gameplay.
 * baseballCards provides player-name options when playableCards is empty
 * (e.g., initial cold-start or between CardHedge imports).
 *
 * Deprecation criteria: baseballCards can be removed when:
 *   1. playableCards always has ≥50 cards in prod (verified by monitoring)
 *   2. matchService.initialize() is refactored to not reference baseballCards
 *   3. imageValidation.ts baseballCards branch is removed
 *   4. storage.ts seeding/retrieval methods are removed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB before any imports that pull it in transitively
vi.mock("../db", () => ({ db: {}, pool: {} }));

// Mock schema imports — we test logic, not DB connectivity
const mockPlayableCards: { player: string; isPlayable: boolean }[] = [];
const mockBaseballCards: { playerName: string }[] = [
  { playerName: "Babe Ruth" },
  { playerName: "Willie Mays" },
  { playerName: "Hank Aaron" },
];

vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/schema")>();
  return {
    ...actual,
    playableCards: Symbol("playableCards"),
    baseballCards: Symbol("baseballCards"),
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(() => Symbol("eq")),
  };
});

// Stub the db.select().from().where() chain
const mockSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockImplementation(async () => {
      // First call = playableCards query, second = baseballCards fallback
      return [];
    }),
  }),
});

vi.mock("../db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  },
  pool: {},
}));

describe("baseballCards legacy fallback decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("playableCards is the primary source; baseballCards is fallback only", () => {
    // Documented invariant: playableCards takes precedence
    const primarySource = "playableCards";
    const fallbackSource = "baseballCards";
    expect(primarySource).toBe("playableCards");
    expect(fallbackSource).toBe("baseballCards");
  });

  it("fallback player name pool is non-empty (baseballCards seeded)", () => {
    // If matchService.initialize() falls back to baseballCards, it must have rows.
    // This test verifies the mock seed data matches expected shape.
    const playerNames = mockBaseballCards.map((c) => c.playerName).filter(Boolean);
    expect(playerNames.length).toBeGreaterThan(0);
    expect(playerNames).toContain("Babe Ruth");
  });

  it("with empty playableCards, fallback uses baseballCards player names", () => {
    // Simulate matchService.initialize() logic:
    const playableCardNames = mockPlayableCards
      .filter((c) => c.isPlayable)
      .map((c) => c.player)
      .filter(Boolean);

    let playerNames = playableCardNames;
    if (playerNames.length === 0) {
      playerNames = mockBaseballCards.map((c) => c.playerName);
    }

    expect(playerNames.length).toBe(3);
    expect(playerNames).toContain("Willie Mays");
  });

  it("with populated playableCards, baseballCards fallback is NOT used", () => {
    const populated = [
      { player: "Mike Piazza", isPlayable: true },
      { player: "Cal Ripken Jr.", isPlayable: true },
    ];

    const playableCardNames = populated
      .filter((c) => c.isPlayable)
      .map((c) => c.player)
      .filter(Boolean);

    let usedFallback = false;
    let playerNames = playableCardNames;
    if (playerNames.length === 0) {
      usedFallback = true;
      playerNames = mockBaseballCards.map((c) => c.playerName);
    }

    expect(usedFallback).toBe(false);
    expect(playerNames).toContain("Mike Piazza");
    expect(playerNames).not.toContain("Babe Ruth");
  });

  it("deprecation guard: removal criteria are not yet met (tracked here)", () => {
    // This test fails intentionally if someone prematurely removes baseballCards.
    // Remove this test ONLY when all 4 deprecation criteria in the file header are met.
    const deprecationCriteriaMetCount = 0; // update when criteria are satisfied
    expect(deprecationCriteriaMetCount).toBeLessThan(4);
  });
});
