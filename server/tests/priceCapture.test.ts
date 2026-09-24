/**
 * PriceCapture SQL and player_key mapping. No DATABASE_URL: db is mocked
 * because rewardEngine (the shared normalizer) imports it.
 */
import { vi, describe, it, expect } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));

import { PRICE_CAPTURE_SQL, mapPriceCaptureRow } from "../services/analytics/priceCaptureQuery";
import { normalizePlayerKey } from "../services/rewardEngine";

describe("price capture query", () => {
  it("reads year and sport from game_sets, not playable_cards.year", () => {
    expect(PRICE_CAPTURE_SQL).toContain("JOIN game_sets gs ON gs.id = pc.game_set_id");
    expect(PRICE_CAPTURE_SQL).toContain("gs.year AS year");
    expect(PRICE_CAPTURE_SQL).toContain("gs.sport AS sport");
    expect(PRICE_CAPTURE_SQL).toContain("DISTINCT ON (pc.player, gs.year)");
    expect(PRICE_CAPTURE_SQL).toContain("ORDER BY pc.player, gs.year, cdc.fetched_at DESC");
    expect(PRICE_CAPTURE_SQL).not.toContain("pc.year");
  });

  it("builds player_key with the answer_submitted normalizer and the set sport", () => {
    const mapped = mapPriceCaptureRow({
      player: "Mike Trout",
      year: 2011,
      sport: "baseball",
      game_set_id: "set-1",
      cardhedge_card_id: "ch-1",
      payload: { prices: [{ grade: "PSA 10", price: "400.00" }, { grade: "Raw", price: "12.50" }] },
    }, "2026-09-24");

    expect(mapped).toEqual({
      capturedOn: "2026-09-24",
      playerKey: "baseball:miketrout",
      cardhedgeCardId: "ch-1",
      gameSetId: "set-1",
      year: 2011,
      rawPriceCents: 1250,
      source: "cardhedge",
    });
    expect(mapped?.playerKey).toBe(normalizePlayerKey("Mike Trout", "baseball"));
  });

  it("falls back to baseball when the set sport is missing", () => {
    const mapped = mapPriceCaptureRow({
      player: "LeBron James",
      year: "2003",
      sport: "",
      payload: { prices: [{ grade: "Raw", price: "9" }] },
    }, "2026-09-24");

    expect(mapped?.playerKey).toBe(normalizePlayerKey("LeBron James", "baseball"));
    expect(mapped?.playerKey).toBe("baseball:lebronjames");
    expect(mapped?.year).toBe(2003);
  });

  it("uses a non-baseball sport the same way answer_submitted does", () => {
    const mapped = mapPriceCaptureRow({
      player: "LeBron James",
      year: 2003,
      sport: "basketball",
      payload: { prices: [{ grade: "RAW", price: "1.5" }] },
    }, "2026-09-24");

    expect(mapped?.playerKey).toBe(normalizePlayerKey("LeBron James", "basketball"));
    expect(mapped?.playerKey).toBe("basketball:lebronjames");
    expect(mapped?.rawPriceCents).toBe(150);
  });

  it("skips rows with no price", () => {
    expect(mapPriceCaptureRow({
      player: "Mike Trout",
      year: 2011,
      sport: "baseball",
      payload: { prices: [] },
    }, "2026-09-24")).toBeNull();
  });
});
