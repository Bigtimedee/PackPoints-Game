import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const select = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  db: {
    select,
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    insert: vi.fn(() => ({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    })),
  },
  pool: { on: vi.fn() },
}));

import {
  MaskBakeTimeoutError,
  getMaskedImagePath,
  maskBakeSlotsInUse,
  resetMaskBakeForTests,
  setMaskBakeTimingsForTests,
} from "../masking/maskingService";
import { runSetWarmup } from "../startup/maskWarmup";

const CARD_A = "warm-gate-a";
const CARD_B = "warm-gate-b";
const BLOCKERS = ["warm-gate-blocker-1", "warm-gate-blocker-2"];

function query(rows: unknown[]) {
  const builder = {
    from() { return builder; },
    where() { return builder; },
    limit() { return Promise.resolve(rows); },
  };
  return builder;
}

describe("warm bake live-gate deadlock", () => {
  const fetched: string[] = [];
  const releaseBlockers: Array<() => void> = [];

  beforeEach(() => {
    resetMaskBakeForTests();
    fetched.length = 0;
    releaseBlockers.length = 0;
    setMaskBakeTimingsForTests({ fetchMs: 8_000, deadlineMs: 8_000 });
    let n = 0;
    const ids = [...BLOCKERS, CARD_A, CARD_B];
    select.mockImplementation(() => {
      const step = n;
      n += 1;
      const cardId = ids[Math.floor(step / 3)] ?? `extra-${step}`;
      const phase = step % 3;
      if (phase === 1) {
        return query([{
          id: cardId,
          imageUrl: `https://images.example/${cardId}.jpg`,
          player: "Ken Phelps",
          imageRotation: 0,
          gameSetId: null,
          set: "1987 Topps",
          category: "baseball",
        }]);
      }
      return query([]);
    });
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (BLOCKERS.some((id) => url.includes(id))) {
        return new Promise((_resolve, reject) => {
          releaseBlockers.push(() => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const release of releaseBlockers) release();
    resetMaskBakeForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lets a live request promote a warm bake parked on the live gate, then warms the next card", async () => {
    const outcome = await Promise.race([
      runSetWarmup({
        setId: "set-deadlock",
        setName: "Deadlock Set",
        cards: [
          { id: CARD_A, player: "Ann" },
          { id: CARD_B, player: "Bob" },
        ],
        isBaked: () => false,
        isFailed: () => false,
        concurrency: 1,
        bake: async (id) => {
          if (id !== CARD_A) {
            await getMaskedImagePath(id, { priority: "warm" });
            return false;
          }

          const blocker1 = getMaskedImagePath(BLOCKERS[0]);
          await vi.waitFor(() => expect(maskBakeSlotsInUse()).toBe(1));
          const blocker2 = getMaskedImagePath(BLOCKERS[1]);
          await vi.waitFor(() => expect(maskBakeSlotsInUse()).toBe(2));
          const blockers = [blocker1, blocker2];

          const warm = getMaskedImagePath(CARD_A, { priority: "warm" });
          await vi.waitFor(() => expect(select.mock.calls.length).toBe(9));
          await new Promise((resolve) => setTimeout(resolve, 80));
          expect(fetched.some((url) => url.includes(CARD_A))).toBe(false);
          expect(maskBakeSlotsInUse()).toBe(2);

          const live = getMaskedImagePath(CARD_A);
          await new Promise((resolve) => setTimeout(resolve, 80));
          expect(fetched.some((url) => url.includes(CARD_A))).toBe(false);

          for (const release of releaseBlockers) release();
          releaseBlockers.length = 0;

          const settled = await Promise.allSettled([warm, live, ...blockers]);
          expect(settled[0].status).toBe("rejected");
          expect(settled[1].status).toBe("rejected");
          expect((settled[0] as PromiseRejectedResult).reason).toBeInstanceOf(MaskBakeTimeoutError);
          expect((settled[1] as PromiseRejectedResult).reason).toBeInstanceOf(MaskBakeTimeoutError);
          expect(maskBakeSlotsInUse()).toBe(0);
          return false;
        },
      }).then((counts) => ({ kind: "done" as const, counts })),
      new Promise<{ kind: "stalled" }>((resolve) => {
        setTimeout(() => resolve({ kind: "stalled" }), 2_500);
      }),
    ]);

    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(fetched.some((url) => url.includes(CARD_A))).toBe(true);
    expect(fetched.some((url) => url.includes(CARD_B))).toBe(true);
    expect(outcome.counts.failed).toBe(2);
    expect(outcome.counts.warmed).toBe(0);
    expect(maskBakeSlotsInUse()).toBe(0);
  });
});
