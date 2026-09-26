import { describe, expect, it } from "vitest";
import {
  distinctBakedPlayers,
  orderWarmupCards,
  setNeedsMaskWarmup,
} from "../startup/maskWarmupPlan";
import { runSetWarmup } from "../startup/maskWarmup";

describe("mask warmup plan", () => {
  const cards = Array.from({ length: 12 }, (_, index) => ({
    id: `card-${index}`,
    player: index === 11 ? "Ken Phelps" : `Player ${index}`,
  }));

  it("warms a set that has fewer than eight distinct baked players", () => {
    expect(distinctBakedPlayers(cards, new Set())).toBe(0);
    expect(setNeedsMaskWarmup({
      distinctBakedPlayers: 3,
      versionChanged: false,
      alreadyFinished: false,
    })).toBe(true);
    expect(setNeedsMaskWarmup({
      distinctBakedPlayers: 8,
      versionChanged: false,
      alreadyFinished: false,
    })).toBe(false);
    expect(setNeedsMaskWarmup({
      distinctBakedPlayers: 8,
      versionChanged: true,
      alreadyFinished: true,
    })).toBe(true);
  });

  it("bakes eight distinct covers before the rest of the set", async () => {
    const started: string[] = [];
    const logs: string[] = [];
    const result = await runSetWarmup({
      setId: "set-1",
      setName: "1987 Topps",
      cards: [
        ...cards,
        { id: "failed", player: "Failed Player" },
        { id: "already", player: "Already Baked" },
      ],
      isBaked: (id) => id === "already",
      isFailed: (id) => id === "failed",
      concurrency: 1,
      bake: async (id) => {
        started.push(id);
        return true;
      },
      log: (line) => logs.push(line),
    });

    expect(started.slice(0, 8)).toEqual(cards.slice(0, 8).map((card) => card.id));
    expect(started).not.toContain("failed");
    expect(started).not.toContain("already");
    expect(result.warmed).toBe(started.length);
    expect(logs.some((line) => line.includes("1987 Topps") && line.includes("covers"))).toBe(true);
    const planned = orderWarmupCards(cards, { isBaked: () => false, isFailed: () => false });
    expect(planned.covers).toHaveLength(8);
    expect(planned.ordered.slice(0, 8)).toEqual(planned.covers);
  });
});
