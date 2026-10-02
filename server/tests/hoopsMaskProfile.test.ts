/**
 * 1990 NBA Hoops resolves to the Fleer-style top plate by set identity.
 * Dealable sets that are not hold-exempt never answer profileId default.
 * 2022 Panini Chronicles and 2024 Basketball stay on the unmatched default.
 */
import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSetMaskHint } from "@shared/maskGeometry";
import { DEFAULT_MASK_REGIONS } from "@shared/schema";
import {
  getMaskProfile,
  hoopsBottomBakeIsStale,
  HOOPS_1990_PROFILE_ID,
  MASK_HOLD_EXEMPT_SET_IDS,
  MASK_LAYOUT_SET_IDS,
  profileIsRegistered,
} from "../masking/maskProfiles";
import { resolveNameMaskPlan } from "../masking/nameLocalization";
import { getMaskConfig } from "../services/maskConfig";
import { setHasRegisteredMaskProfile } from "../config/heldSets";

const W = 500;
const H = 700;
const NEW_HOOPS_ID = "11111111-2222-4333-8444-555555555555";
const OLD_HOOPS_ID = "c2ce5d11-bc9b-43ea-888e-609fdcec76e0";

const MATCHED = [
  {
    id: MASK_LAYOUT_SET_IDS.toppsBaseball1987,
    hint: buildSetMaskHint({ year: 1987, brand: "Topps", sport: "baseball", setName: "1987 Topps" }),
    profileId: "1987-topps",
    anchor: "bottom",
  },
  {
    id: MASK_LAYOUT_SET_IDS.toppsFootball1987,
    hint: buildSetMaskHint({ year: 1987, brand: "Topps", sport: "football", setName: "1987 Topps Football" }),
    profileId: "1987-topps-football",
    anchor: "top",
  },
  {
    id: MASK_LAYOUT_SET_IDS.fleerBasketball1989,
    hint: buildSetMaskHint({ year: 1989, brand: "Fleer", sport: "basketball", setName: "1989 Fleer Basketball" }),
    profileId: "fleer-bball-top",
    anchor: "top",
  },
  {
    id: MASK_LAYOUT_SET_IDS.toppsBaseball1989,
    hint: buildSetMaskHint({ year: 1989, brand: "Topps", sport: "baseball", setName: "1989 Topps" }),
    profileId: "1989-topps",
    anchor: "bottom",
  },
  {
    id: MASK_LAYOUT_SET_IDS.toppsFootball1994,
    hint: buildSetMaskHint({ year: 1994, brand: "Topps", sport: "football", setName: "1994 Topps Football" }),
    profileId: "1994-topps-football",
    anchor: "bottom",
  },
] as const;

const OCR_DEFAULT_SETS = [
  {
    id: MASK_HOLD_EXEMPT_SET_IDS[0],
    hint: buildSetMaskHint({ year: 2022, brand: "Panini", sport: "football", setName: "2022 Panini Chronicles Football" }),
    reimport: { year: 2022, brand: "Panini", sport: "football", setName: "2022 Panini Chronicles Football" },
  },
  {
    id: MASK_HOLD_EXEMPT_SET_IDS[1],
    hint: buildSetMaskHint({
      year: 2025,
      brand: "Topps",
      sport: "basketball",
      setName: "2024 Basketball",
      category: "basketball",
    }),
    reimport: { year: 2025, brand: "Topps", sport: "basketball", setName: "2024 Basketball", category: "basketball" },
  },
] as const;

function expectTopHoops(setName: string, gameSetId: string) {
  const profile = getMaskProfile(setName, gameSetId);
  expect(profile.id).toBe(HOOPS_1990_PROFILE_ID);
  expect(profile.layoutClass).toBe("TOP_PLATE");
  expect(profile.nameAnchor).toBe("top");
  expect(profile.matched).toBe(true);
  expect(profile.regions[0].yPct).toBe(0);
  expect(profile.regions[0].hPct).toBe(18);
  expect(profile.regions).not.toEqual(DEFAULT_MASK_REGIONS);
}

describe("1990 Hoops top-name profile", () => {
  it("resolves by year, brand, and sport, and by normalized name, for any id", () => {
    expectTopHoops("1990 Hoops Basketball", NEW_HOOPS_ID);
    expectTopHoops("1990 NBA Hoops", NEW_HOOPS_ID);
    expectTopHoops("1990 nba hoops", OLD_HOOPS_ID);
    expectTopHoops(
      buildSetMaskHint({ year: 1990, brand: "Hoops", sport: "basketball", setName: "Series 1" }),
      NEW_HOOPS_ID,
    );
    expectTopHoops(
      buildSetMaskHint({ year: 1990, brand: "NBA Hoops", sport: "Basketball", setName: "1990 NBA Hoops" }),
      OLD_HOOPS_ID,
    );
    expect(getMaskProfile("1990 Hoops Basketball", NEW_HOOPS_ID).id).toBe(
      getMaskProfile("1990 Hoops Basketball", OLD_HOOPS_ID).id,
    );
    const baseball = getMaskProfile("1990 Hoops Baseball", NEW_HOOPS_ID);
    expect(baseball.id).not.toBe(HOOPS_1990_PROFILE_ID);
    expect(Object.values(MASK_LAYOUT_SET_IDS)).not.toContain(OLD_HOOPS_ID);
  });

  it("covers the top plate from the profile and from a top OCR box, never the default bottom plaque", () => {
    const prior = resolveNameMaskPlan({
      playerName: "Michael Jordan",
      setHint: "1990 Hoops Basketball",
      gameSetId: NEW_HOOPS_ID,
      words: [],
      imageWidth: W,
      imageHeight: H,
    });
    expect(prior.profileId).toBe(HOOPS_1990_PROFILE_ID);
    expect(prior.layoutClass).toBe("TOP_PLATE");
    expect(prior.source).toBe("profile");
    expect(prior.regions.some((region) => region.yPct === 54 && region.hPct === 46)).toBe(false);
    expect(prior.regions[0].yPct).toBe(0);

    const ocr = resolveNameMaskPlan({
      playerName: "Michael Jordan",
      setHint: buildSetMaskHint({ year: 1990, brand: "Hoops", sport: "basketball", setName: "1990 NBA Hoops" }),
      gameSetId: NEW_HOOPS_ID,
      words: [{ text: "JORDAN", x: 30, y: Math.round(H * 0.06), w: 140, h: 28 }],
      imageWidth: W,
      imageHeight: H,
    });
    expect(ocr.profileId).toBe(HOOPS_1990_PROFILE_ID);
    expect(ocr.profileId).not.toBe("default");
    expect(ocr.layoutClass).not.toBe("BOTTOM_PLAQUE");
    expect(ocr.regions.some((region) => region.yPct === 54 && region.hPct === 46)).toBe(false);
    expect(ocr.regions.some((region) => region.yPct <= 2)).toBe(true);
  });

  it("treats a cached default bottom plaque as stale for Hoops and keeps a fitted band", () => {
    expect(hoopsBottomBakeIsStale(HOOPS_1990_PROFILE_ID, "BOTTOM_PLAQUE", DEFAULT_MASK_REGIONS)).toBe(true);
    expect(hoopsBottomBakeIsStale(HOOPS_1990_PROFILE_ID, "BOTTOM_PLAQUE", null)).toBe(true);
    expect(hoopsBottomBakeIsStale(HOOPS_1990_PROFILE_ID, null, null)).toBe(true);
    expect(hoopsBottomBakeIsStale(
      HOOPS_1990_PROFILE_ID,
      "BOTTOM_PLAQUE",
      [{ xPct: 0, yPct: 78, wPct: 100, hPct: 16, type: "blur" }],
    )).toBe(false);
    expect(hoopsBottomBakeIsStale("fleer-bball-top", "BOTTOM_PLAQUE", DEFAULT_MASK_REGIONS)).toBe(false);
    expect(hoopsBottomBakeIsStale(HOOPS_1990_PROFILE_ID, "TOP_PLATE", [{ xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "blur" }])).toBe(false);
  });
});

describe("live sets", () => {
  it("matched sets resolve to their profiles", () => {
    for (const row of MATCHED) {
      const profile = getMaskProfile(row.hint, row.id);
      expect(profile.id, row.id).toBe(row.profileId);
      expect(profile.nameAnchor, row.id).toBe(row.anchor);
      expect(profileIsRegistered(profile, row.id), row.id).toBe(true);
      expect(profile.id, row.id).not.toBe("default");
      expect(setHasRegisteredMaskProfile({
        id: row.id,
        year: null,
        brand: null,
        sport: null,
        setName: row.hint,
      }), row.id).toBe(true);
    }
    const unprofiled = setHasRegisteredMaskProfile({
      id: NEW_HOOPS_ID,
      year: 1991,
      brand: "Donruss",
      sport: "basketball",
      setName: "1991 Donruss",
    });
    expect(unprofiled).toBe(false);
    const hoops = setHasRegisteredMaskProfile({
      id: NEW_HOOPS_ID,
      year: 1990,
      brand: "Hoops",
      sport: "basketball",
      setName: "1990 Hoops Basketball",
    });
    expect(hoops).toBe(true);
  });

  it("keeps 2022 Panini and 2024 Basketball on the unmatched default and unheld", () => {
    const mainDefault = getMaskProfile("no registered profile", null);
    expect(mainDefault.matched).toBe(false);
    expect(mainDefault.id).toBe("default");
    for (const row of OCR_DEFAULT_SETS) {
      const profile = getMaskProfile(row.hint, row.id);
      expect(profile, row.id).toEqual(mainDefault);
      expect(profile.matched, row.id).toBe(false);
      expect(profile.id, row.id).toBe("default");
      expect(profileIsRegistered(profile, row.id), row.id).toBe(true);
      expect(setHasRegisteredMaskProfile({ id: row.id, ...row.reimport }), row.id).toBe(true);
      const reimportId = `${row.id.slice(0, 8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      expect(setHasRegisteredMaskProfile({ id: reimportId, ...row.reimport }), reimportId).toBe(false);
      expect(getMaskProfile(row.hint, reimportId), reimportId).toEqual(mainDefault);
    }
  });

  const app = express();
  app.get("/api/card-sets/:setKey/mask", async (req, res) => {
    const config = await getMaskConfig(req.params.setKey || "");
    res.json(config);
  });
  const server = createServer(app);
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /api/card-sets/:id/mask returns default only for the OCR-default exempt sets", async () => {
    for (const row of MATCHED) {
      const res = await fetch(`${base}/api/card-sets/${row.id}/mask`);
      expect(res.status, row.id).toBe(200);
      const body = await res.json() as { profileId?: string };
      expect(body.profileId, row.id).toBe(row.profileId);
      expect(body.profileId, row.id).not.toBe("default");
    }
    for (const row of OCR_DEFAULT_SETS) {
      const res = await fetch(`${base}/api/card-sets/${row.id}/mask`);
      expect(res.status, row.id).toBe(200);
      const body = await res.json() as { profileId?: string };
      expect(body.profileId, row.id).toBe("default");
    }
  });
});
