import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { readFileSync } from "fs";
vi.mock("../db", () => ({ db: {}, pool: {} }));
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { readyDonrussCardIds } from "../masking/donrussReadiness";
import { resolveNameMaskPlan } from "../masking/nameLocalization";
import { cardAwaitingReviewClause, setCardReviewGuardEnabled } from "../lib/cardReviewGuard";
import { holdReasonForIdentity, DONRUSS_1987_HOLD_ID } from "../config/heldSets";

const id = DONRUSS_1987_HOLD_ID;
const identity = { id, year: 1987, brand: "Donruss", sport: "baseball", setName: "1987 Donruss Baseball" };
const band = { xPct: 0, yPct: 84, wPct: 100, hPct: 16, type: "blur", radiusPct: 0 };
const input = { gameSetId: id, playerName: "Cal Ripken", setHint: "1987 Donruss baseball", imageWidth: 100, imageHeight: 100 };

describe("Donruss containment", () => {
  it("holds even a stale environment clearance", () => {
    const prev = process.env.CLEARED_SET_IDS_EXTRA;
    process.env.CLEARED_SET_IDS_EXTRA = id;
    try { expect(holdReasonForIdentity(identity)).toBe("awaiting_design_clearance"); }
    finally { if (prev === undefined) delete process.env.CLEARED_SET_IDS_EXTRA; else process.env.CLEARED_SET_IDS_EXTRA = prev; }
  });
  it("requires a real review rather than a seed, and fails closed when guard is off", () => {
    setCardReviewGuardEnabled(false);
    expect(cardAwaitingReviewClause("pc")).toContain(id);
    expect(cardAwaitingReviewClause("pc")).not.toContain("SELECT");
    setCardReviewGuardEnabled(true);
    expect(cardAwaitingReviewClause("pc")).toContain("cra.source = 'qa'");
    expect(cardAwaitingReviewClause("pc", { ignoreCardReview: true })).toBeNull();
    setCardReviewGuardEnabled(false);
  });
  it("never moves the fixed band to fit a plate, and refuses slabs", () => {
    for (const extra of [{}, { plateBox: { x: 0, y: 77.7, w: 100, h: 22.3 } }, { slabLayout: true }]) {
      const plan = resolveNameMaskPlan({ ...input, ...extra });
      expect(plan.regions).toEqual([band]);
      expect(plan.namePlateUnresolved).toBe(Object.keys(extra).length > 0);
    }
  });
  it("refuses a name detected outside the fixed band", () => {
    const plan = resolveNameMaskPlan({ ...input, words: [{ text: "Ripken", x: 10, y: 10, w: 20, h: 5, confidence: 99 }] });
    expect(plan.regions).toEqual([band]);
    expect(plan.namePlateUnresolved).toBe(true);
  });
  it("requires marker, JPEG, current exact-band plan, and no refusal", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "donruss-ready-"));
    const file = (ext: string, body: string) => writeFileSync(path.join(dir, `card-a_${CURRENT_MASK_VERSION}.${ext}`), body);
    try {
      expect(readyDonrussCardIds(dir)).toEqual([]);
      file("ok", "ok");
      expect(readyDonrussCardIds(dir)).toEqual([]);
      file("jpg", "fixture");
      expect(readyDonrussCardIds(dir)).toEqual([]);
      file("json", JSON.stringify({ maskVersion: CURRENT_MASK_VERSION, layoutClass: "BOTTOM_PLAQUE", regions: [band] }));
      expect(readyDonrussCardIds(dir)).toEqual(["card-a"]);
      file("json", JSON.stringify({ maskVersion: CURRENT_MASK_VERSION, layoutClass: "BOTTOM_PLAQUE", regions: [{ ...band, yPct: 77.7 }] }));
      expect(readyDonrussCardIds(dir)).toEqual([]);
      file("json", JSON.stringify({ maskVersion: CURRENT_MASK_VERSION, layoutClass: "BOTTOM_PLAQUE", regions: [band] }));
      file("fail", "name_visible_outside_mask");
      expect(readyDonrussCardIds(dir)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("uses eligible counts on both picker paths without imported-count fallback", () => {
    const context = readFileSync("server/services/marketplace/context.ts", "utf8");
    expect(context).toContain("await ensureHeldSets()");
    expect(context).toContain("eligibleCountsForSetIds(candidates.map");
    expect(context).toContain(">= PUBLIC_SET_MIN_ELIGIBLE_CARDS");
    const routes = readFileSync("server/routes.ts", "utf8");
    expect(routes).toContain("kept.filter(set => set.actualPlayableCards >= PUBLIC_SET_MIN_ELIGIBLE_CARDS)");
    expect(routes).not.toContain("set.actualPlayableCards || set.cardsImportedCount");
  });
});
