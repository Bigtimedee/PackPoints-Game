/**
 * PriceCapture candidate selection, mapping, throttle, and capture loop.
 * No DATABASE_URL: db and the CardHedge client are mocked.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const cardHedge = vi.hoisted(() => ({
  fetchCardDetailsNormalized: vi.fn(),
  isCardHedgeConfigured: vi.fn(() => true),
}));

const database = vi.hoisted(() => ({
  execute: vi.fn(),
  cacheRows: [] as Array<{ cardId: string; payload: unknown; fetchedAt: Date | null }>,
  inserts: [] as Array<{ values: Record<string, unknown>; mode: "update" | "nothing" }>,
}));

vi.mock("../db", () => ({
  db: {
    execute: (...args: unknown[]) => database.execute(...args),
    select: () => ({
      from: () => ({
        where: async () => database.cacheRows,
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            database.inserts.push({ values, mode: "nothing" });
            return [{ id: "price-row" }];
          },
        }),
        onConflictDoUpdate: async () => {
          database.inserts.push({ values, mode: "update" });
        },
      }),
    }),
  },
  pool: {},
}));

vi.mock("../services/cardhedge/client", () => ({
  fetchCardDetailsNormalized: (...args: unknown[]) => cardHedge.fetchCardDetailsNormalized(...args),
  isCardHedgeConfigured: () => cardHedge.isCardHedgeConfigured(),
}));

import {
  FALLBACK_CANDIDATES_SQL,
  PLAYED_CANDIDATES_SQL,
  PRICE_CAPTURE_FETCH_CONCURRENCY,
  RECENT_ANSWER_COUNT_SQL,
  actionableCandidates,
  cacheUpsertValues,
  chooseCandidateSource,
  isCacheRowFresh,
  limitedSql,
  mapPriceCaptureRow,
  readPriceCaptureMaxFetch,
  runPriceCapture,
  runThrottled,
  type PriceCaptureCandidate,
  type PriceCapturePorts,
} from "../services/analytics/priceCaptureQuery";
import { capturePrices } from "../services/analytics/priceCaptureWorker";
import { normalizePlayerKey } from "../services/rewardEngine";

const DAY = new Date("2026-09-24T15:00:00.000Z");
const RAW = { prices: [{ grade: "PSA 10", price: "400.00" }, { grade: "Raw", price: "12.50" }] };

function candidate(id: string, player = "Mike Trout"): PriceCaptureCandidate {
  return {
    player,
    year: 2011,
    sport: "baseball",
    game_set_id: "set-1",
    cardhedge_card_id: id,
  };
}

function ports(overrides: Partial<PriceCapturePorts> = {}): PriceCapturePorts & {
  fetchDetails: ReturnType<typeof vi.fn>;
  upsertCache: ReturnType<typeof vi.fn>;
  insertPrice: ReturnType<typeof vi.fn>;
  countRecentAnswers: ReturnType<typeof vi.fn>;
  loadPlayedCandidates: ReturnType<typeof vi.fn>;
  loadFallbackCandidates: ReturnType<typeof vi.fn>;
  loadCacheRows: ReturnType<typeof vi.fn>;
} {
  const fetchDetails = vi.fn(async () => RAW);
  const upsertCache = vi.fn(async () => undefined);
  const insertPrice = vi.fn(async () => true);
  return {
    isConfigured: () => true,
    countRecentAnswers: vi.fn(async () => 3),
    loadPlayedCandidates: vi.fn(async () => [candidate("ch-1")]),
    loadFallbackCandidates: vi.fn(async () => [candidate("fallback-1")]),
    loadCacheRows: vi.fn(async () => []),
    fetchDetails,
    upsertCache,
    insertPrice,
    now: () => DAY,
    sleep: async () => undefined,
    maxFetch: 200,
    log: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };
}

describe("price capture query", () => {
  it("resolves played cards through playable_cards and game_sets, not the on-demand cache", () => {
    expect(PLAYED_CANDIDATES_SQL).toContain("FROM analytics_events ae");
    expect(PLAYED_CANDIDATES_SQL).toContain("event_type = 'answer_submitted'");
    expect(PLAYED_CANDIDATES_SQL).toContain("occurred_at > NOW() - INTERVAL '30 days'");
    expect(PLAYED_CANDIDATES_SQL).toContain("is_clean = true");
    expect(PLAYED_CANDIDATES_SQL).toContain("p.id = ae.card_id OR p.cardhedge_card_id = ae.card_id");
    expect(PLAYED_CANDIDATES_SQL).toContain("JOIN game_sets gs ON gs.id = pc.game_set_id");
    expect(PLAYED_CANDIDATES_SQL).toContain("gs.year AS year");
    expect(PLAYED_CANDIDATES_SQL).toContain("gs.sport AS sport");
    expect(PLAYED_CANDIDATES_SQL).toContain("ORDER BY plays DESC");
    expect(PLAYED_CANDIDATES_SQL).not.toContain("pc.year");
    expect(PLAYED_CANDIDATES_SQL).not.toContain("card_details_cache");
    expect(RECENT_ANSWER_COUNT_SQL).toContain("event_type = 'answer_submitted'");
    expect(RECENT_ANSWER_COUNT_SQL).toContain("is_clean = true");
  });

  it("falls back to playable cards in active sets", () => {
    expect(FALLBACK_CANDIDATES_SQL).toContain("pc.is_playable = true");
    expect(FALLBACK_CANDIDATES_SQL).toContain("gs.is_active = true");
    expect(FALLBACK_CANDIDATES_SQL).toContain("JOIN game_sets gs ON gs.id = pc.game_set_id");
    expect(FALLBACK_CANDIDATES_SQL).toContain("gs.year AS year");
    expect(FALLBACK_CANDIDATES_SQL).not.toContain("pc.year");
    expect(FALLBACK_CANDIDATES_SQL).not.toContain("analytics_events");
  });

  it("caps the default fetch budget at 200", () => {
    expect(readPriceCaptureMaxFetch(undefined)).toBe(200);
    expect(readPriceCaptureMaxFetch("")).toBe(200);
    expect(readPriceCaptureMaxFetch("0")).toBe(200);
    expect(readPriceCaptureMaxFetch("25")).toBe(25);
    expect(limitedSql("SELECT 1", 25)).toBe("SELECT 1\nLIMIT 25");
  });

  it("uses played cards only when recent answers exist", () => {
    expect(chooseCandidateSource(0)).toBe("fallback");
    expect(chooseCandidateSource(4)).toBe("played");
  });

  it("drops blank and duplicate cardhedge ids before the cap", () => {
    const rows = actionableCandidates([
      candidate(" ch-1 "),
      candidate("ch-1", "Someone Else"),
      { player: "No Id", cardhedge_card_id: "  " },
    ]);
    expect(rows.map((row) => row.cardhedge_card_id)).toEqual(["ch-1"]);
  });

  it("treats cache rows older than 24h as stale", () => {
    const now = new Date("2026-09-24T00:00:00.000Z");
    expect(isCacheRowFresh(new Date("2026-09-23T00:00:00.000Z"), now)).toBe(true);
    expect(isCacheRowFresh(new Date("2026-09-22T23:59:59.999Z"), now)).toBe(false);
    expect(isCacheRowFresh(null, now)).toBe(false);
  });

  it("upserts the shared cache with rawImagesOnly false", () => {
    const now = new Date("2026-09-24T00:00:00.000Z");
    const write = cacheUpsertValues("ch-1", RAW, now, 600);
    expect(write.values.rawImagesOnly).toBe(false);
    expect(write.values.cardId).toBe("ch-1");
    expect(write.values.payload).toBe(RAW);
    expect(write.values.expiresAt.toISOString()).toBe("2026-09-24T00:10:00.000Z");
    expect(write.update.fetchedAt).toBe(now);
    expect(write.update.payload).toBe(RAW);
  });

  it("builds player_key with the answer_submitted normalizer and the set sport", () => {
    const mapped = mapPriceCaptureRow({
      player: "Mike Trout",
      year: 2011,
      sport: "baseball",
      game_set_id: "set-1",
      cardhedge_card_id: "ch-1",
      payload: RAW,
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

describe("price capture throttle", () => {
  it("starts work on a fixed spacing", async () => {
    const startTimes: number[] = [];
    let virtual = 0;
    await runThrottled([1, 2, 3, 4], async () => {
      startTimes.push(virtual);
    }, {
      concurrency: 1,
      spacingMs: 250,
      now: () => virtual,
      sleep: async (ms) => {
        virtual += ms;
      },
    });
    expect(startTimes).toEqual([0, 250, 500, 750]);
  });

  it("keeps at most the configured number of fetches in flight", async () => {
    let active = 0;
    let maxActive = 0;
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = runThrottled([1, 2, 3, 4], async () => {
      active++;
      started++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
    }, {
      concurrency: PRICE_CAPTURE_FETCH_CONCURRENCY,
      spacingMs: 0,
      sleep: async () => undefined,
    });

    await vi.waitUntil(() => started >= PRICE_CAPTURE_FETCH_CONCURRENCY);
    expect(started).toBe(PRICE_CAPTURE_FETCH_CONCURRENCY);
    expect(maxActive).toBe(PRICE_CAPTURE_FETCH_CONCURRENCY);
    release();
    await done;
    expect(maxActive).toBe(PRICE_CAPTURE_FETCH_CONCURRENCY);
  });
});

describe("price capture run", () => {
  it("uses a fresh cache row and does not call CardHedge", async () => {
    const used = ports({
      loadCacheRows: vi.fn(async () => [{
        cardId: "ch-1",
        payload: RAW,
        fetchedAt: new Date("2026-09-24T14:00:00.000Z"),
      }]),
    });
    const summary = await runPriceCapture(used);
    expect(used.fetchDetails).not.toHaveBeenCalled();
    expect(used.upsertCache).not.toHaveBeenCalled();
    expect(used.insertPrice).toHaveBeenCalledWith(expect.objectContaining({
      cardhedgeCardId: "ch-1",
      rawPriceCents: 1250,
      playerKey: "baseball:miketrout",
    }));
    expect(summary).toMatchObject({
      candidates: 1,
      cacheHits: 1,
      fetched: 0,
      noPrice: 0,
      failed: 0,
      captured: 1,
      day: "2026-09-24",
    });
    expect(used.log).toHaveBeenCalledWith(
      "[PriceCapture] candidates=1 cacheHits=1 fetched=0 noPrice=0 failed=0 captured=1 for 2026-09-24",
    );
  });

  it("fetches on a stale cache, upserts, and captures the price", async () => {
    const used = ports({
      loadCacheRows: vi.fn(async () => [{
        cardId: "ch-1",
        payload: RAW,
        fetchedAt: new Date("2026-09-22T00:00:00.000Z"),
      }]),
    });
    const summary = await runPriceCapture(used);
    expect(used.fetchDetails).toHaveBeenCalledTimes(1);
    expect(used.fetchDetails).toHaveBeenCalledWith("ch-1");
    expect(used.upsertCache).toHaveBeenCalledWith("ch-1", RAW);
    expect(summary).toMatchObject({ cacheHits: 0, fetched: 1, captured: 1, noPrice: 0, failed: 0 });
  });

  it("counts a CardHedge card with no price and still caches the payload", async () => {
    const empty = { prices: [] as Array<{ grade: string; price: string }> };
    const used = ports({
      fetchDetails: vi.fn(async () => empty),
    });
    const summary = await runPriceCapture(used);
    expect(used.upsertCache).toHaveBeenCalledWith("ch-1", empty);
    expect(used.insertPrice).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ fetched: 1, noPrice: 1, captured: 0, failed: 0 });
  });

  it("counts a CardHedge failure once and keeps the first error", async () => {
    const used = ports({
      loadPlayedCandidates: vi.fn(async () => [candidate("ch-1"), candidate("ch-2", "Ken Griffey")]),
      fetchDetails: vi.fn(async (id: string) => {
        if (id === "ch-2") throw new Error("cardhedge down");
        return RAW;
      }),
    });
    const summary = await runPriceCapture(used);
    expect(summary).toMatchObject({ fetched: 1, failed: 1, captured: 1, firstError: "cardhedge down" });
    expect(used.error).toHaveBeenCalledWith("[PriceCapture] 1 rows failed: cardhedge down");
    expect(used.insertPrice).toHaveBeenCalledTimes(1);
  });

  it("respects the per-run cap", async () => {
    const many = ["ch-1", "ch-2", "ch-3", "ch-4", "ch-5"].map((id, index) => (
      candidate(id, `Player ${index}`)
    ));
    const used = ports({
      maxFetch: 2,
      loadPlayedCandidates: vi.fn(async () => many),
    });
    const summary = await runPriceCapture(used);
    expect(used.loadPlayedCandidates).toHaveBeenCalledWith(2);
    expect(used.fetchDetails).toHaveBeenCalledTimes(2);
    expect(used.fetchDetails).toHaveBeenNthCalledWith(1, "ch-1");
    expect(used.fetchDetails).toHaveBeenNthCalledWith(2, "ch-2");
    expect(summary.candidates).toBe(5);
    expect(summary.fetched).toBe(2);
    expect(summary.captured).toBe(2);
  });

  it("skips the run when CardHedge is not configured", async () => {
    const used = ports({ isConfigured: () => false });
    const summary = await runPriceCapture(used);
    expect(summary.skipped).toBe(true);
    expect(used.countRecentAnswers).not.toHaveBeenCalled();
    expect(used.fetchDetails).not.toHaveBeenCalled();
    expect(used.log).toHaveBeenCalledTimes(1);
    expect(used.log).toHaveBeenCalledWith("[PriceCapture] skipped: CardHedge is not configured");
  });

  it("uses active playable cards when analytics has no rows", async () => {
    const used = ports({ countRecentAnswers: vi.fn(async () => 0) });
    const summary = await runPriceCapture(used);
    expect(used.loadPlayedCandidates).not.toHaveBeenCalled();
    expect(used.loadFallbackCandidates).toHaveBeenCalledWith(200);
    expect(used.fetchDetails).toHaveBeenCalledWith("fallback-1");
    expect(summary.captured).toBe(1);
  });

  it("does not fall back when answers exist but none resolve to a card", async () => {
    const used = ports({
      loadPlayedCandidates: vi.fn(async () => []),
    });
    const summary = await runPriceCapture(used);
    expect(used.loadFallbackCandidates).not.toHaveBeenCalled();
    expect(used.fetchDetails).not.toHaveBeenCalled();
    expect(summary.candidates).toBe(0);
    expect(summary.captured).toBe(0);
    expect(used.log).toHaveBeenCalledWith(
      "[PriceCapture] candidates=0 cacheHits=0 fetched=0 noPrice=0 failed=0 captured=0 for 2026-09-24",
    );
  });
});

describe("price capture worker", () => {
  const logs: string[] = [];
  const errors: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const previousMax = process.env.PRICE_CAPTURE_MAX_FETCH;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    database.execute.mockReset();
    database.inserts.length = 0;
    database.cacheRows = [];
    cardHedge.fetchCardDetailsNormalized.mockReset();
    cardHedge.isCardHedgeConfigured.mockReset();
    cardHedge.isCardHedgeConfigured.mockReturnValue(true);
    logSpy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });
    delete process.env.PRICE_CAPTURE_MAX_FETCH;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    if (previousMax === undefined) delete process.env.PRICE_CAPTURE_MAX_FETCH;
    else process.env.PRICE_CAPTURE_MAX_FETCH = previousMax;
  });

  it("does not call CardHedge when the API key is unset", async () => {
    cardHedge.isCardHedgeConfigured.mockReturnValue(false);
    await capturePrices();
    expect(cardHedge.fetchCardDetailsNormalized).not.toHaveBeenCalled();
    expect(database.execute).not.toHaveBeenCalled();
    expect(logs).toEqual(["[PriceCapture] skipped: CardHedge is not configured"]);
  });

  it("fetches through the CardHedge client and upserts rawImagesOnly false", async () => {
    database.execute
      .mockResolvedValueOnce({ rows: [{ event_count: 2 }] })
      .mockResolvedValueOnce({
        rows: [{
          player: "Mike Trout",
          year: 2011,
          sport: "baseball",
          game_set_id: "set-1",
          cardhedge_card_id: "ch-1",
          plays: 4,
        }],
      });
    cardHedge.fetchCardDetailsNormalized.mockResolvedValue(RAW);

    await capturePrices();

    expect(cardHedge.fetchCardDetailsNormalized).toHaveBeenCalledWith("ch-1", false);
    expect(database.inserts.map((row) => row.mode)).toEqual(["update", "nothing"]);
    expect(database.inserts[0]?.values.rawImagesOnly).toBe(false);
    expect(database.inserts[0]?.values.cardId).toBe("ch-1");
    expect(database.inserts[1]?.values).toMatchObject({
      playerKey: "baseball:miketrout",
      rawPriceCents: 1250,
      capturedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(logs.some((line) => line.startsWith("[PriceCapture] candidates=1 cacheHits=0 fetched=1"))).toBe(true);
    expect(errors).toEqual([]);
  });

  it("uses a 24h cache row without calling CardHedge", async () => {
    database.execute
      .mockResolvedValueOnce({ rows: [{ event_count: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          player: "Mike Trout",
          year: 2011,
          sport: "baseball",
          game_set_id: "set-1",
          cardhedge_card_id: "ch-1",
          plays: 1,
        }],
      });
    database.cacheRows = [{
      cardId: "ch-1",
      payload: RAW,
      fetchedAt: new Date(),
    }];

    await capturePrices();

    expect(cardHedge.fetchCardDetailsNormalized).not.toHaveBeenCalled();
    expect(database.inserts).toHaveLength(1);
    expect(database.inserts[0]?.mode).toBe("nothing");
    expect(logs.some((line) => line.includes("cacheHits=1 fetched=0"))).toBe(true);
  });
});
