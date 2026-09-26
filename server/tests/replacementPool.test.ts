import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rankReplacementCandidates, REPLACEMENT_COLD_ATTEMPTS } from "../lib/replacementPool";

describe("replacement pool", () => {
  it("tries baked cards before a few cold candidates and drops failed ones", () => {
    const ranked = rankReplacementCandidates(
      [
        { id: "cold-a" },
        { id: "baked" },
        { id: "failed" },
        { id: "cold-b" },
        { id: "cold-c" },
        { id: "cold-d" },
      ],
      {
        isBaked: (card) => card.id === "baked",
        isFailed: (card) => card.id === "failed",
      },
    );
    expect(ranked.baked.map((card) => card.id)).toEqual(["baked"]);
    expect(ranked.cold.map((card) => card.id)).toEqual([
      "cold-a",
      "cold-b",
      "cold-c",
      "cold-d",
    ]);
    expect(REPLACEMENT_COLD_ATTEMPTS).toBe(3);
  });

  it("selects replacements with the shared deal filter, including unreviewed cards", () => {
    const source = readFileSync(new URL("../storage.ts", import.meta.url), "utf8");
    const start = source.indexOf("async getReplacementCardForSession");
    const end = source.indexOf("async flagCardForImageFailure");
    const body = source.slice(start, end);
    expect(body).toContain('eligibleDealFilter("playable_cards")');
    expect(body).toContain("isBlockedCard(");
    expect(body).toContain("isMaskBandExcluded(");
    expect(body).not.toContain("imageReviewStatus");
    expect(body).toContain("REPLACEMENT_COLD_ATTEMPTS");
  });
});
