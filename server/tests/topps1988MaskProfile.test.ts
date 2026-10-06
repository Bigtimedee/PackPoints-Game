import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("../db", () => ({ db: {}, pool: {} }));
import { getMaskProfile, profileIsRegistered } from "../masking/maskProfiles";
import { TOPPS_1988_SET_ID as ID, TOPPS_1988_PROFILE_ID, TOPPS_1988_REGIONS, TOPPS_1988_REVIEWED_SOURCES, isTopps1988Plan } from "../masking/topps1988Geometry";
import { holdReasonForIdentity, CLEARED_SET_IDS } from "../config/heldSets";
import { maskBandFailure } from "../masking/maskBandLimit";
import { preparedTopps1988MaskFile } from "../masking/topps1988Readiness";
import { preparedMaskFile, explicitPreparationIds } from "../services/heldMaskPreparation";
import { maskCardImage, applyPercentRegions } from "../masking/maskCardImage";
import { resetOcrRuntimeForTests } from "../masking/ocrRuntime";
import { cardAwaitingReviewClause, setCardReviewGuardEnabled } from "../lib/cardReviewGuard";
import { topps1988OcrRefusal } from "../masking/topps1988Mask";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
const identity = { id: ID, year: 1988, brand: "Topps", sport: "baseball", setName: "1988 Topps Baseball", isActive: true };
afterEach(() => { resetOcrRuntimeForTests(); setCardReviewGuardEnabled(false); });
describe("1988 Topps reviewed diagonal profile", () => {
  it("registers exact ID only and never grants design clearance", () => {
    const profile = getMaskProfile("1988 Topps baseball", ID);
    expect(profile.id).toBe(TOPPS_1988_PROFILE_ID);
    expect(profileIsRegistered(profile, ID)).toBe(true);
    expect(profile.trustProfileBand).toBe(false);
    expect(profile.regions).toEqual(TOPPS_1988_REGIONS);
    expect(getMaskProfile("1988 Topps baseball").id).toBe("default");
    expect(getMaskProfile("1988 Topps football").id).toBe("default");
    expect(CLEARED_SET_IDS).not.toContain(ID);
    expect(holdReasonForIdentity(identity)).toBe("awaiting_design_clearance");
    expect(maskBandFailure(profile.regions)).toBeNull();
    expect(TOPPS_1988_REGIONS.every(r => r.wPct < 6 && r.yPct >= 57)).toBe(true);
  });
  it("requires QA, not seed; when general guard off it fails closed", () => {
    expect(cardAwaitingReviewClause("pc")).toContain(ID);
    setCardReviewGuardEnabled(true);
    expect(cardAwaitingReviewClause("pc")).toContain("cra.source = 'qa'");
    expect(cardAwaitingReviewClause("pc", { ignoreCardReview: true })).toBeNull();
  });
  it("requires exact plan, cohort ID, current .ok/.jpg and absence of .fail", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "topps1988-ready-"));
    const id = TOPPS_1988_REVIEWED_SOURCES[0].cardId, stem = path.join(dir, `${id}_${CURRENT_MASK_VERSION}`);
    const plan = { layoutClass: "BOTTOM_PLAQUE", maskVersion: CURRENT_MASK_VERSION, regions: TOPPS_1988_REGIONS };
    try {
      expect(preparedMaskFile(id, dir, ID)).toBeNull();
      writeFileSync(stem + ".json", JSON.stringify(plan)); writeFileSync(stem + ".ok", "ok"); writeFileSync(stem + ".jpg", "jpeg");
      expect(preparedMaskFile(id, dir, ID)).toBe(stem + ".jpg");
      expect(preparedMaskFile(id, dir)).toBeNull(); // Donruss route unchanged
      expect(preparedTopps1988MaskFile("unknown", dir)).toBeNull();
      writeFileSync(stem + ".fail", "name_visible_outside_mask");
      expect(preparedMaskFile(id, dir, ID)).toBeNull(); rmSync(stem + ".fail");
      writeFileSync(stem + ".json", JSON.stringify({ ...plan, regions: [{ xPct: 0, yPct: 54, wPct: 100, hPct: 46, type: "blur" }] }));
      expect(preparedMaskFile(id, dir, ID)).toBeNull();
      expect(isTopps1988Plan({ ...plan, regions: TOPPS_1988_REGIONS.map(r => ({ ...r, wPct: NaN })) })).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("refuses unknown/slab/special IDs and source replacement without falling back", async () => {
    const raw = await sharp({ create: { width: 400, height: 600, channels: 3, background: "white" } }).jpeg().toBuffer();
    const unknown = await maskCardImage(raw, "Stan Musial", "1988 Topps Baseball", { cardId: "0573d467-38e8-4255-b69b-103cc1792ee2", gameSetId: ID });
    expect(unknown.coverageOk).toBe(false); expect(unknown.coverageReason).toBe("topps1988_source_not_reviewed");
    const known = TOPPS_1988_REVIEWED_SOURCES[0];
    const changed = await maskCardImage(raw, known.player, "1988 Topps Baseball", { cardId: known.cardId, gameSetId: ID });
    expect(changed.coverageReason).toBe("topps1988_source_changed");
  });
  it("paint is opaque and preserves upper photo pixels; mask area under 15%", async () => {
    const raw = await sharp({ create: { width: 1000, height: 1400, channels: 3, background: { r: 200, g: 170, b: 120 } } }).png().toBuffer();
    const masked = await applyPercentRegions(raw, [...TOPPS_1988_REGIONS]);
    const { data, info } = await sharp(masked).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(at(500, 350)[0]).toBeGreaterThan(150);
    expect(at(960, 1000).every(v => v < 28)).toBe(true);
    const area = TOPPS_1988_REGIONS.reduce((sum,r) => sum + r.wPct * r.hPct, 0) / 10000;
    expect(area).toBeLessThan(0.15);
  });
  it("rejects empty OCR, timeout and a surname anywhere outside the corner", () => {
    expect(topps1988OcrRefusal({ words: [], timedOut: false, ms: 0 }, "Jim Presley", 1000, 1400)).toBe("topps1988_mask_unverified");
    const word = { text: "PRESLEY", confidence: 95, x: 100, y: 200, w: 150, h: 40 };
    expect(topps1988OcrRefusal({ words: [word], timedOut: true, ms: 1 }, "Jim Presley", 1000, 1400)).toBe("topps1988_mask_unverified");
    expect(topps1988OcrRefusal({ words: [word], timedOut: false, ms: 1 }, "Jim Presley", 1000, 1400)).toBe("name_visible_outside_mask");
  });
  it("does not accept all/duplicate/implicit preparation", () => {
    const id = TOPPS_1988_REVIEWED_SOURCES[0].cardId;
    expect(explicitPreparationIds({ reviewed: true, all: true, cardIds: [id] })).toBeNull();
    expect(explicitPreparationIds({ reviewed: true, cardIds: [id,id] })).toBeNull();
    expect(explicitPreparationIds({ cardIds: [id] })).toBeNull();
  });
});
