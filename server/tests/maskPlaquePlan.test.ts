import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { DEFAULT_MASK_REGIONS } from "@shared/schema";
import { toPublicMaskPlan } from "@shared/maskPlan";
import { buildSetMaskHint, CURRENT_MASK_VERSION, inferLayoutClass } from "@shared/maskGeometry";
import { getMaskProfile, logDealtDefaultMaskProfiles, resetDefaultProfileLogForTests, MASK_LAYOUT_SET_IDS } from "../masking/maskProfiles";
import { resolveNameMaskPlan } from "../masking/nameLocalization";
import { applyPercentRegions } from "../masking/maskCardImage";
import { assertOpaqueIdentityCover } from "../masking/maskCoverage";

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
    expect(toPublicMaskPlan({ layoutClass: "UNKNOWN", regions: DEFAULT_MASK_REGIONS, maskVersion: CURRENT_MASK_VERSION })).toBeNull();
    expect(toPublicMaskPlan(null)).toBeNull();
    expect(toPublicMaskPlan({ layoutClass: "TOP_PLATE", regions: [], maskVersion: CURRENT_MASK_VERSION })).toBeNull();
  });
});

const DAILY5_BASKETBALL_SET = "229f0379-aa56-40a8-abe3-1af217a397e8";

const LIVE_HINTS = [
  {
    label: "2024 Basketball",
    gameSetId: DAILY5_BASKETBALL_SET,
    hint: buildSetMaskHint({
      year: 2025,
      brand: "Topps",
      sport: "basketball",
      setName: "2024 Basketball",
      category: "basketball",
    }),
    expectedHint: "2025 Topps basketball 2024 Basketball basketball",
  },
  {
    label: "2023 Panini basketball",
    gameSetId: "2023-panini-basketball",
    hint: buildSetMaskHint({
      year: 2023,
      brand: "Panini",
      sport: "basketball",
      setName: "2023 Panini",
      category: "basketball",
    }),
    expectedHint: "2023 Panini basketball 2023 Panini basketball",
  },
  {
    label: "1989 Topps MLB",
    gameSetId: "1989-topps-mlb",
    hint: buildSetMaskHint({
      year: 1989,
      brand: "Topps",
      sport: "MLB",
      setName: "1989 Topps MLB",
    }),
    expectedHint: "1989 Topps MLB 1989 Topps MLB",
  },
  {
    label: "sportless 1991 Donruss",
    gameSetId: null as string | null,
    hint: buildSetMaskHint({
      year: 1991,
      brand: "Donruss",
      setName: "1991 Donruss",
    }),
    expectedHint: "1991 Donruss 1991 Donruss",
  },
];

describe("live hints stay dealable and bake a region", () => {
  it("buildSetMaskHint matches the production strings", () => {
    expect(LIVE_HINTS[0].hint).toBe("2025 Topps basketball 2024 Basketball basketball");
    expect(LIVE_HINTS[2].hint).toContain("MLB");
    for (const row of LIVE_HINTS) {
      expect(row.hint).toBe(row.expectedHint);
    }
  });

  it("dealing does not filter on a registered mask profile", () => {
    const files = [
      "storage.ts",
      "services/daily5Service.ts",
      "services/matchService.ts",
      "services/matches/replaceQuestion.ts",
    ];
    for (const file of files) {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(src).not.toContain("shouldDealMaskedCard");
    }
    const profiles = readFileSync(new URL("../masking/maskProfiles.ts", import.meta.url), "utf8");
    expect(profiles).not.toContain("shouldDealMaskedCard");
    expect(profiles).toContain("UNKNOWN exclusion is deferred");
  });

  it("an OCR miss on an unmatched set bakes the default bottom 46% and does not quarantine", async () => {
    const raw = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 20, g: 180, b: 40 } },
    }).jpeg().toBuffer();

    for (const row of LIVE_HINTS) {
      const profile = getMaskProfile(row.hint, row.gameSetId);
      const plan = resolveNameMaskPlan({
        playerName: "Someone Else",
        setHint: row.hint,
        gameSetId: row.gameSetId,
        words: [],
        imageWidth: W,
        imageHeight: H,
      });
      expect(plan.regions.length, row.label).toBeGreaterThan(0);
      expect(plan.layoutClass, row.label).not.toBe("UNKNOWN");
      expect(plan.layoutClass, row.label).toBe("BOTTOM_PLAQUE");
      expect(plan.regions[0].yPct, row.label).toBe(54);
      expect(plan.regions[0].hPct, row.label).toBe(46);
      const painted = await applyPercentRegions(raw, plan.regions);
      const coverage = await assertOpaqueIdentityCover({
        buffer: painted,
        regions: plan.regions,
        layoutClass: plan.layoutClass,
        nameBoxes: plan.nameBoxes,
        imageWidth: W,
        imageHeight: H,
      });
      expect(coverage.reason, row.label).not.toBe("unclassified_name_region");
      expect(coverage.ok, row.label).toBe(true);
      if (!profile.matched) {
        expect(plan.source, row.label).toBe("default");
        expect(plan.profileId, row.label).toBe("default");
      }
    }
  });

  it("logs the default profile for unmatched dealt cards and skips matched baseball", () => {
    resetDefaultProfileLogForTests();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logDealtDefaultMaskProfiles([
      { setHint: LIVE_HINTS[0].hint, gameSetId: DAILY5_BASKETBALL_SET },
      { setHint: LIVE_HINTS[0].hint, gameSetId: DAILY5_BASKETBALL_SET },
      { setHint: "1987 Topps baseball", gameSetId: MASK_LAYOUT_SET_IDS.toppsBaseball1987 },
    ]);
    expect(spy).toHaveBeenCalledWith(
      `[MaskProfile] default profile used set=${DAILY5_BASKETBALL_SET} count=2`,
    );
    spy.mockRestore();
    resetDefaultProfileLogForTests();
  });

  it("logs an unmatched set at most once per 10 minutes", () => {
    resetDefaultProfileLogForTests();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const now = 1_700_000_000_000;
    const card = { setHint: "unknown set", gameSetId: DAILY5_BASKETBALL_SET };
    logDealtDefaultMaskProfiles([card], now);
    logDealtDefaultMaskProfiles([card, card], now + 60_000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      `[MaskProfile] default profile used set=${DAILY5_BASKETBALL_SET} count=1`,
    );
    logDealtDefaultMaskProfiles([card, card, card], now + 10 * 60 * 1000);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(
      `[MaskProfile] default profile used set=${DAILY5_BASKETBALL_SET} count=3`,
    );
    spy.mockRestore();
    resetDefaultProfileLogForTests();
  });
});

describe("baseball year and brand fallback", () => {
  it("keeps a sportless or MLB 1987 Topps card on the bottom 46% plaque", () => {
    const sportless = getMaskProfile("1987 Topps");
    const mlb = getMaskProfile("1987 Topps MLB");
    const baseball = getMaskProfile("1987 Topps Baseball");
    for (const profile of [sportless, mlb, baseball]) {
      expect(profile.layoutClass).toBe("BOTTOM_PLAQUE");
      expect(profile.regions).toEqual(DEFAULT_MASK_REGIONS);
      expect(profile.bottomBandPct).toBe(0.46);
    }
    expect(sportless.matched).toBe(true);
    expect(mlb.id).toBe("1987-topps");
    expect(getMaskProfile("1989 Topps MLB").id).toBe("1989-topps");
    expect(getMaskProfile("1989 Topps MLB").regions[0].hPct).toBe(46);
  });

  it("keeps 1987 Topps Football on the top plate by name and by gameSetId", () => {
    const footballName = getMaskProfile("1987 Topps Football");
    const footballId = getMaskProfile("1987 Topps", MASK_LAYOUT_SET_IDS.toppsFootball1987);
    expect(footballName.layoutClass).toBe("TOP_PLATE");
    expect(footballName.id).toBe("1987-topps-football");
    expect(footballId.layoutClass).toBe("TOP_PLATE");
    expect(footballId.topBandPct).toBe(0.24);
    expect(footballId.regions[0].hPct).toBe(24);
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
