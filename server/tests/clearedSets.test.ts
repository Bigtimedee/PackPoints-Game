/**
 * A registered mask profile does not make a set dealable.
 * The seven live ids stay unheld. Their bake geometry stays put.
 */
import { describe, expect, it } from "vitest";
import { buildSetMaskHint } from "@shared/maskGeometry";
import { DEFAULT_MASK_REGIONS } from "@shared/schema";
import {
  AWAITING_DESIGN_CLEARANCE_REASON,
  CLEARED_SET_IDS,
  holdReasonForIdentity,
  isClearedSetId,
  NO_MASK_PROFILE_REASON,
} from "../config/heldSets";
import { getMaskProfile, MASK_LAYOUT_SET_IDS } from "../masking/maskProfiles";

const LIVE = [
  {
    id: MASK_LAYOUT_SET_IDS.toppsBaseball1987,
    hint: buildSetMaskHint({ year: 1987, brand: "Topps", sport: "baseball", setName: "1987 Topps" }),
    profileId: "1987-topps",
    regions: DEFAULT_MASK_REGIONS,
  },
  {
    id: MASK_LAYOUT_SET_IDS.toppsFootball1987,
    hint: buildSetMaskHint({ year: 1987, brand: "Topps", sport: "football", setName: "1987 Topps Football" }),
    profileId: "1987-topps-football",
    regions: [{ xPct: 0, yPct: 0, wPct: 100, hPct: 24, type: "blur" as const, radiusPct: 0 }],
  },
  {
    id: MASK_LAYOUT_SET_IDS.fleerBasketball1989,
    hint: buildSetMaskHint({ year: 1989, brand: "Fleer", sport: "basketball", setName: "1989 Fleer Basketball" }),
    profileId: "fleer-bball-top",
    regions: [{ xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "blur" as const, radiusPct: 0 }],
  },
  {
    id: MASK_LAYOUT_SET_IDS.toppsBaseball1989,
    hint: buildSetMaskHint({ year: 1989, brand: "Topps", sport: "baseball", setName: "1989 Topps" }),
    profileId: "1989-topps",
    regions: DEFAULT_MASK_REGIONS,
  },
  {
    id: MASK_LAYOUT_SET_IDS.toppsFootball1994,
    hint: buildSetMaskHint({ year: 1994, brand: "Topps", sport: "football", setName: "1994 Topps Football" }),
    profileId: "1994-topps-football",
    regions: [{ xPct: 0, yPct: 72, wPct: 100, hPct: 28, type: "blur" as const, radiusPct: 0 }],
  },
  {
    id: "74885a41-2043-4b7c-ab58-f9e16c05e2e3",
    hint: buildSetMaskHint({ year: 2022, brand: "Panini", sport: "football", setName: "2022 Panini Chronicles Football" }),
    profileId: "default",
    regions: DEFAULT_MASK_REGIONS,
  },
  {
    id: "229f0379-aa56-40a8-abe3-1af217a397e8",
    hint: buildSetMaskHint({ year: 2025, brand: "Topps", sport: "basketball", setName: "2024 Basketball", category: "basketball" }),
    profileId: "default",
    regions: DEFAULT_MASK_REGIONS,
  },
] as const;

describe("cleared set allowlist", () => {
  it("keeps the seven live sets dealable and leaves their bake profiles unchanged", () => {
    expect([...CLEARED_SET_IDS]).toEqual(LIVE.map((row) => row.id));
    for (const row of LIVE) {
      expect(isClearedSetId(row.id)).toBe(true);
      expect(holdReasonForIdentity({
        id: row.id,
        setName: row.hint,
        isActive: true,
        isUserCreated: false,
      }), row.id).toBeNull();
      const profile = getMaskProfile(row.hint, row.id);
      expect(profile.id, row.id).toBe(row.profileId);
      expect(profile.regions, row.id).toEqual(row.regions.map((region) => ({ ...region })));
    }
  });

  it("holds a new profiled set until its id is in CLEARED_SET_IDS_EXTRA", () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const hoops = {
      id,
      year: 1990,
      brand: "Hoops",
      sport: "basketball",
      setName: "1990 Hoops Basketball",
      isActive: true,
      isUserCreated: false,
    };
    expect(getMaskProfile(hoops.setName, id).id).toBe("1990-hoops-top");
    expect(holdReasonForIdentity(hoops)).toBe(AWAITING_DESIGN_CLEARANCE_REASON);

    const previous = process.env.CLEARED_SET_IDS_EXTRA;
    process.env.CLEARED_SET_IDS_EXTRA = ` ${id.toUpperCase()} `;
    try {
      expect(holdReasonForIdentity(hoops)).toBeNull();
      const unprofiled = {
        ...hoops,
        id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        year: 1991,
        brand: "Donruss",
        setName: "1991 Donruss",
      };
      process.env.CLEARED_SET_IDS_EXTRA = unprofiled.id;
      expect(holdReasonForIdentity(unprofiled)).toBe(NO_MASK_PROFILE_REASON);
    } finally {
      if (previous === undefined) delete process.env.CLEARED_SET_IDS_EXTRA;
      else process.env.CLEARED_SET_IDS_EXTRA = previous;
    }
  });
});
