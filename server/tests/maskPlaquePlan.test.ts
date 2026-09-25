import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MASK_REGIONS } from "@shared/schema";
import { toPublicMaskPlan } from "@shared/maskPlan";
import { CURRENT_MASK_VERSION, inferLayoutClass } from "@shared/maskGeometry";
import { getMaskProfile, MASK_LAYOUT_SET_IDS, shouldDealMaskedCard } from "../masking/maskProfiles";
import { resolveNameMaskPlan } from "../masking/nameLocalization";

const W = 500;
const H = 700;

describe("toPublicMaskPlan", () => {
  it("keeps layout, regions, and version and drops name, number, and team", () => {
    const plan = toPublicMaskPlan({
      layoutClass: "BOTTOM_PLAQUE",
      regions: [{ xPct: 0, yPct: 54, wPct: 100, hPct: 46, type: "blur", radiusPct: 0 }],
      maskVersion: CURRENT_MASK_VERSION,
      playerName: "Ken Phelps",
      cardNumber: "177",
      team: "Mariners",
    });
    expect(plan).toEqual({
      layoutClass: "BOTTOM_PLAQUE",
      regions: [{ xPct: 0, yPct: 54, wPct: 100, hPct: 46, type: "blur", radiusPct: 0 }],
      maskVersion: CURRENT_MASK_VERSION,
    });
    const wire = JSON.stringify(plan);
    expect(wire).not.toContain("Ken Phelps");
    expect(wire).not.toContain("177");
    expect(wire).not.toContain("Mariners");
    expect(wire).not.toContain("playerName");
    expect(wire).not.toContain("cardNumber");
    expect(wire).not.toContain("team");
  });

  it("returns null for UNKNOWN and for an empty bake", () => {
    expect(toPublicMaskPlan({ layoutClass: "UNKNOWN", regions: DEFAULT_MASK_REGIONS, maskVersion: "v4.5" })).toBeNull();
    expect(toPublicMaskPlan(null)).toBeNull();
    expect(toPublicMaskPlan({ layoutClass: "TOP_PLATE", regions: [], maskVersion: "v4.5" })).toBeNull();
  });
});

describe("UNKNOWN exclusion", () => {
  it("an unregistered set with no OCR name hit is UNKNOWN and is not dealt", () => {
    const plan = resolveNameMaskPlan({
      playerName: "Someone Else",
      setHint: "2024 Bowman Chrome basketball",
      words: [],
      imageWidth: W,
      imageHeight: H,
    });
    expect(plan.layoutClass).toBe("UNKNOWN");
    expect(plan.source).toBe("default");
    expect(plan.regions).toEqual([]);
    expect(getMaskProfile("2024 Bowman Chrome basketball").matched).toBe(false);
    expect(shouldDealMaskedCard({ setHint: "2024 Bowman Chrome basketball" })).toBe(false);
  });

  it("an OCR last-name hit on an unregistered set is still a playable layout", () => {
    const plan = resolveNameMaskPlan({
      playerName: "Mike Trout",
      setHint: "2011 Topps",
      words: [{ text: "TROUT", x: 20, y: Math.round(H * 0.82), w: 120, h: 28 }],
      imageWidth: W,
      imageHeight: H,
    });
    expect(plan.layoutClass).not.toBe("UNKNOWN");
    expect(plan.source).toBe("ocr");
  });
});

describe("baseball-only year and brand fallback", () => {
  it("does not paint a non-baseball or sportless 1987 Topps hint with the baseball plaque", () => {
    const sportless = getMaskProfile("1987 Topps");
    const footballName = getMaskProfile("1987 Topps Football");
    const footballId = getMaskProfile("1987 Topps", MASK_LAYOUT_SET_IDS.toppsFootball1987);
    expect(sportless.matched).toBe(false);
    expect(sportless.id).toBe("default");
    expect(footballName.layoutClass).toBe("TOP_PLATE");
    expect(footballName.id).toBe("1987-topps-football");
    expect(footballId.layoutClass).toBe("TOP_PLATE");
    expect(footballId.topBandPct).toBe(0.24);
    expect(shouldDealMaskedCard({
      setHint: "1987 Topps",
      gameSetId: MASK_LAYOUT_SET_IDS.toppsFootball1987,
    })).toBe(true);
    expect(shouldDealMaskedCard({ setHint: "1987 Topps" })).toBe(false);
  });

  it("still uses the baseball plaque when sport is confirmed baseball", () => {
    const profile = getMaskProfile("1987 Topps baseball");
    expect(profile.layoutClass).toBe("BOTTOM_PLAQUE");
    expect(profile.bottomBandPct).toBe(0.46);
    expect(shouldDealMaskedCard({ setHint: "1987 topps baseball" })).toBe(true);
  });
});

describe("inferLayoutClass", () => {
  it("reads top, bottom, and both bands", () => {
    expect(inferLayoutClass([{ xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "blur" }])).toBe("TOP_PLATE");
    expect(inferLayoutClass(DEFAULT_MASK_REGIONS)).toBe("BOTTOM_PLAQUE");
    expect(inferLayoutClass([
      { xPct: 0, yPct: 0, wPct: 100, hPct: 22, type: "blur" },
      { xPct: 0, yPct: 54, wPct: 100, hPct: 46, type: "blur" },
    ])).toBe("PSA_SLAB");
  });
});

describe("readWarmMaskPlan sidecar", () => {
  const originalCwd = process.cwd();
  let dir = "";

  afterEach(() => {
    process.chdir(originalCwd);
    vi.resetModules();
  });

  it("reads a sidecar and still strips identity fields", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "mask-plan-"));
    const cardId = "card-plan-1";
    const folder = path.join(dir, "data", "masked-cards");
    const { mkdirSync } = await import("fs");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, `${cardId}_${CURRENT_MASK_VERSION}.json`), JSON.stringify({
      layoutClass: "PSA_SLAB",
      regions: [
        { xPct: 0, yPct: 0, wPct: 100, hPct: 22, type: "blur" },
        { xPct: 0, yPct: 54, wPct: 100, hPct: 46, type: "blur" },
      ],
      maskVersion: CURRENT_MASK_VERSION,
      playerName: "Roger Clemens",
      team: "Red Sox",
      cardNumber: "340",
    }));
    process.chdir(dir);
    vi.resetModules();
    const { readWarmMaskPlan } = await import("../masking/maskPlanStore");
    const plan = readWarmMaskPlan(cardId);
    expect(plan?.layoutClass).toBe("PSA_SLAB");
    expect(plan?.regions).toHaveLength(2);
    const wire = JSON.stringify(plan);
    expect(wire).not.toContain("Clemens");
    expect(wire).not.toContain("Red Sox");
    expect(wire).not.toContain("340");
    expect(readWarmMaskPlan("missing-card")).toBeNull();
  });
});
