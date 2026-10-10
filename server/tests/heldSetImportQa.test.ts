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
  });
  it("raw source route refuses every Design-cleared set", () => {
    for (const id of CLEARED_SET_IDS) expect(isHeldForQa(id)).toBe(false);
    expect(isHeldForQa("not-a-uuid")).toBe(false);
  });
});
