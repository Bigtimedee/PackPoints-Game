import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("../db", () => ({ db: {}, pool: {} }));
import { getMaskProfile, profileIsRegistered } from "../masking/maskProfiles";
import { TOPPS_1988_SET_ID as ID, TOPPS_1988_PROFILE_ID, TOPPS_1988_REGIONS, TOPPS_1988_REVIEWED_SOURCES, isTopps1988Plan } from "../masking/topps1988Geometry";
import { holdReasonForIdentity, CLEARED_SET_IDS, NO_MASK_PROFILE_REASON } from "../config/heldSets";
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
  it("clears only the source-bound set id and leaves its profile unchanged", () => {
    const profile = getMaskProfile("1988 Topps baseball", ID);
    expect(profile.id).toBe(TOPPS_1988_PROFILE_ID);
    expect(profileIsRegistered(profile, ID)).toBe(true);
    expect(profile.trustProfileBand).toBe(false);
    expect(profile.regions).toEqual(TOPPS_1988_REGIONS);
    expect(getMaskProfile("1988 Topps baseball").id).toBe("default");
    expect(getMaskProfile("1988 Topps football").id).toBe("default");
    expect(CLEARED_SET_IDS).toContain(ID);
    expect(holdReasonForIdentity(identity)).toBeNull();
    const reimportedIdentity = { ...identity, id: "11111111-2222-4333-8444-555555555555" };
    expect(getMaskProfile(reimportedIdentity.setName, reimportedIdentity.id).id).toBe("default");
    expect(holdReasonForIdentity(reimportedIdentity)).toBe(NO_MASK_PROFILE_REASON);
    expect(maskBandFailure(profile.regions)).toBeNull();
    expect(TOPPS_1988_REGIONS.every(r => r.wPct < 6 && r.yPct >= 57)).toBe(true);
  });
  it("requires QA, not seed; when general guard off it fails closed", () => {
    expect(CLEARED_SET_IDS).toContain(ID);
    
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
  it("keeps the expanded reviewed cohort exact-source bound, with unique UUIDs and no inferred all-card clearance", () => {
    expect(TOPPS_1988_REVIEWED_SOURCES).toHaveLength(563);
    expect(new Set(TOPPS_1988_REVIEWED_SOURCES.map(s => s.cardId)).size).toBe(563);
    for (const s of TOPPS_1988_REVIEWED_SOURCES) {
      expect(s.cardId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.imageUrl.startsWith("https://")).toBe(true);
      expect(s.player.length).toBeGreaterThan(0);
    }
    expect(CLEARED_SET_IDS).toContain(ID);
  });
  it("excludes all 16 real OCR refusals and the visually rejected Al Pedrique source", async () => {
    const excluded = [
      "24cd0a53-d8dc-49f7-aff6-2774a5bf2923",
      "3eb38dea-ccf6-4bc8-be29-d934dadd5e3b",
      "3e7085ee-2c7f-4e16-874b-365bd15abc49",
      "4bbc8c17-1543-4d2b-a674-5b06a0dc8f36",
      "78a6b49e-1dba-460c-813f-4958a29ccc5c",
      "82eede2c-2d3d-475b-a144-74855a8757e8",
      "960b9b51-31d5-4c75-9bbe-3a1588db3f58",
      "a37d846a-069b-4038-88c7-0c2be49eaf06",
      "a67a6684-e1a3-4c3f-96a6-0ddb3311fdf3",
      "b2b1320e-4e8a-4ebb-854c-caffab00f50a",
      "b75fb316-251f-446b-b4fd-c3dd336609d4",
      "cbd05901-1cca-43c1-a6b1-e2cedb0fe487",
      "d00acc0d-e97b-45f1-8324-ce80f924dd61",
      "d7f2bb72-da6e-4640-9c5d-9057de9bd2b9",
      "d9741bb6-0b5c-4546-b640-16a7f70d3a03",
      "fe159daf-04bf-4835-860d-9b354f7a1bdc",
      "97265426-25cf-41e5-931f-d36f7adcc7c4"
];
    const raw = await sharp({ create: { width: 400, height: 600, channels: 3, background: "white" } }).jpeg().toBuffer();
    for (const cardId of excluded) {
      expect(TOPPS_1988_REVIEWED_SOURCES.some(s => s.cardId === cardId)).toBe(false);
      expect(preparedTopps1988MaskFile(cardId)).toBeNull();
      const result = await maskCardImage(raw, "not a reviewed player", "1988 Topps Baseball", { cardId, gameSetId: ID });
      expect(result.coverageOk).toBe(false);
      expect(result.coverageReason).toBe("topps1988_source_not_reviewed");
    }
  });
  it("does not accept all/duplicate/implicit preparation", () => {
    const id = TOPPS_1988_REVIEWED_SOURCES[0].cardId;
    expect(explicitPreparationIds({ reviewed: true, all: true, cardIds: [id] })).toBeNull();
    expect(explicitPreparationIds({ reviewed: true, cardIds: [id,id] })).toBeNull();
    expect(explicitPreparationIds({ cardIds: [id] })).toBeNull();
  });
});
