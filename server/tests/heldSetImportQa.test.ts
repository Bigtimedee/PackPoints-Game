/** Held-import QA tools: allowlist identity, and the raw source route never serves a cleared set. */
import { describe, expect, it } from "vitest";

const { FILL_MISSING_SETS, UD_1995_BASKETBALL_HOLD_ID, fillExclusionReason } = await import("../services/setFillMissing");
const { isHeldForQa } = await import("../routes/heldSetImportQa");
const { CLEARED_SET_IDS, isDesignApprovedSetId } = await import("../config/heldSets");

describe("1995 Upper Deck Basketball held import", () => {
  const config = FILL_MISSING_SETS[UD_1995_BASKETBALL_HOLD_ID];
  it("is allowlisted, held, and not cleared", () => {
    expect(config.baseCount).toBe(360);
    expect(config.createIdentity?.setName).toBe("1995 Upper Deck Basketball");
    expect((CLEARED_SET_IDS as readonly string[]).includes(UD_1995_BASKETBALL_HOLD_ID)).toBe(false);
    expect(isDesignApprovedSetId(UD_1995_BASKETBALL_HOLD_ID)).toBe(false);
  });
  it("excludes inserts, off-set rows and out-of-run numbers", () => {
    const ctx = { sport: "basketball", canonicalSet: config.canonicalSet!, config };
    const base = { player: "Grant Hill", set: "1995 Upper Deck Basketball", number: "1", variant: "Base", category: "Basketball" };
    expect(fillExclusionReason(base, ctx)).toBeNull();
    expect(fillExclusionReason({ ...base, variant: "Electric Court" }, ctx)).toBe("not_base");
    expect(fillExclusionReason({ ...base, set: "1995 Upper Deck Collector's Choice Basketball" }, ctx)).toBe("off_set");
    expect(fillExclusionReason({ ...base, number: "361" }, ctx)).toBe("bad_number");
    expect(fillExclusionReason({ ...base, player: "Michael Jordan", number: "4" }, ctx)).toBe("off_base_jordan_insert");
    expect(fillExclusionReason({ ...base, player: "Michael Jordan", number: "23" }, ctx)).toBeNull();
  });
  it("raw source route refuses every Design-cleared set", () => {
    for (const id of CLEARED_SET_IDS) expect(isHeldForQa(id)).toBe(false);
    expect(isHeldForQa("not-a-uuid")).toBe(false);
  });
});

describe("1986 Topps Baseball held import config", async () => {
  const { TOPPS_1986_BASEBALL_HOLD_ID } = await import("../services/setFillMissing");
  const config = FILL_MISSING_SETS[TOPPS_1986_BASEBALL_HOLD_ID];
  const ctx = { sport: "baseball", canonicalSet: "1986 Topps Baseball", config };
  const card = (o: Record<string, string>) => ({ category: "Baseball", set: "1986 Topps Baseball", variant: "Base", ...o });
  it("is held, not cleared", () => {
    expect((CLEARED_SET_IDS as readonly string[]).includes(TOPPS_1986_BASEBALL_HOLD_ID)).toBe(false);
    expect(isDesignApprovedSetId(TOPPS_1986_BASEBALL_HOLD_ID)).toBe(false);
    expect(config.baseCount).toBe(792);
  });
  it("keeps a base card and refuses subsets, leaders, multi-player, autos and off-set", () => {
    expect(fillExclusionReason(card({ number: "180", player: "Don Mattingly" }), ctx)).toBeNull();
    expect(fillExclusionReason(card({ number: "180", player: "Cal Ripken, Jr." }), ctx)).toBeNull();
    expect(fillExclusionReason(card({ number: "4", player: "Pete Rose" }), ctx)).toBe("subset_rose_tribute");
    expect(fillExclusionReason(card({ number: "712", player: "Dwight Gooden" }), ctx)).toBe("subset_all_star");
    expect(fillExclusionReason(card({ number: "36", player: "Rangers Leaders" }), ctx)).toMatch(/leaders/);
    expect(fillExclusionReason(card({ number: "50", player: "Smith & Jones" }), ctx)).toMatch(/multi/);
    expect(fillExclusionReason(card({ number: "50", player: "Dan Pasqua Autograph" }), ctx)).toBe("auto_slab_relic");
    expect(fillExclusionReason(card({ number: "50", player: "Dan Pasqua", set: "1986 Topps Traded" }), ctx)).toBe("off_set");
    expect(fillExclusionReason(card({ number: "793", player: "Dan Pasqua" }), ctx)).toBe("bad_number");
  });
});
