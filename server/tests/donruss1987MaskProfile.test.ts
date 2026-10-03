/**
 * 1987 Donruss Baseball: bottom 16% opaque plaque (Design approval 2026-10-03).
 * The set id and baseball|1987|donruss resolve to it. Other Donruss sports do not.
 * The id stays held. Bakes made before the fixed-band revision are dropped once.
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

const setCards = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("../db", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve(setCards.ids.map((id) => ({ id }))),
    delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
  };
  return { db: chain, pool: {} };
});

import { buildSetMaskHint } from "@shared/maskGeometry";
import {
  AWAITING_DESIGN_CLEARANCE_REASON,
  CLEARED_SET_IDS,
  holdReasonForIdentity,
} from "../config/heldSets";
import { maskBandFailure } from "../masking/maskBandLimit";
import { profileRebuildSignature, rebuildMaskCacheOnProfileChange } from "../masking/maskCachePurge";
import {
  DONRUSS_1987_PROFILE_ID,
  getMaskProfile,
  MASK_LAYOUT_SET_IDS,
  profileIsRegistered,
} from "../masking/maskProfiles";

const SET_ID = "3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4";
const HINT = "1987 Donruss baseball 1987 Donruss Baseball";
const IDENTITY = {
  id: SET_ID,
  year: 1987,
  brand: "Donruss",
  sport: "baseball",
  setName: "1987 Donruss Baseball",
  isActive: true,
  isUserCreated: false,
};

describe("1987 Donruss baseball mask profile", () => {
  it("resolves by set id to the bottom 16% plaque", () => {
    expect(MASK_LAYOUT_SET_IDS.donrussBaseball1987).toBe(SET_ID);
    const profile = getMaskProfile(HINT, SET_ID);
    expect(profile.id).toBe(DONRUSS_1987_PROFILE_ID);
    expect(profile.matched).toBe(true);
    expect(profile.layoutClass).toBe("BOTTOM_PLAQUE");
    expect(profile.bottomBandPct).toBeCloseTo(0.16);
    expect(profile.topBandPct).toBe(0);
    expect(profile.regions).toEqual([{ xPct: 0, yPct: 84, wPct: 100, hPct: 16, type: "blur", radiusPct: 0 }]);
    expect(profileIsRegistered(profile, SET_ID)).toBe(true);
  });

  it("resolves through baseball|1987|donruss without the id", () => {
    expect(buildSetMaskHint(IDENTITY)).toBe(HINT);
    expect(getMaskProfile(HINT).id).toBe(DONRUSS_1987_PROFILE_ID);
    expect(getMaskProfile(HINT, "11111111-2222-4333-8444-555555555555").id).toBe(DONRUSS_1987_PROFILE_ID);
  });

  it("does not match a football or basketball Donruss hint", () => {
    expect(getMaskProfile("1987 Donruss football 1987 Donruss Football").id).not.toBe(DONRUSS_1987_PROFILE_ID);
    expect(getMaskProfile("1987 Donruss basketball 1987 Donruss Basketball").id).not.toBe(DONRUSS_1987_PROFILE_ID);
    expect(getMaskProfile("1988 Donruss baseball 1988 Donruss Baseball").id).not.toBe(DONRUSS_1987_PROFILE_ID);
  });

  it("passes the band guard", () => {
    expect(maskBandFailure(getMaskProfile(HINT, SET_ID).regions)).toBeNull();
  });

  it("stays held until card and mask QA are complete", () => {
    expect(CLEARED_SET_IDS).not.toContain(SET_ID);
    expect(holdReasonForIdentity(IDENTITY)).toBe(AWAITING_DESIGN_CLEARANCE_REASON);
    expect(holdReasonForIdentity({ ...IDENTITY, id: "11111111-2222-4333-8444-555555555555" }))
      .toBe(AWAITING_DESIGN_CLEARANCE_REASON);
  });
});

describe("one-time mask rebuild for a new profile", () => {
  it("drops the set's bakes once, then leaves them alone", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "donruss-rebuild-"));
    setCards.ids = ["card-a", "card-b"];
    writeFileSync(path.join(dir, "card-a_v4.6.jpg"), "old");
    writeFileSync(path.join(dir, "card-a_v4.6.json"), "{}");
    writeFileSync(path.join(dir, "card-a_v4.6.ok"), "ok");
    writeFileSync(path.join(dir, "other_v4.6.jpg"), "keep");

    expect(await rebuildMaskCacheOnProfileChange(dir, [SET_ID], [dir])).toEqual([SET_ID]);
    expect(readdirSync(dir).filter((name) => !name.startsWith(".")).sort()).toEqual(["other_v4.6.jpg"]);
    expect(readFileSync(path.join(dir, `.profile-rebuild-${SET_ID}.json`), "utf8").trim())
      .toBe(profileRebuildSignature(SET_ID));

    writeFileSync(path.join(dir, "card-b_v4.6.jpg"), "new bake");
    expect(await rebuildMaskCacheOnProfileChange(dir, [SET_ID], [dir])).toEqual([]);
    expect(readdirSync(dir)).toContain("card-b_v4.6.jpg");
  });
});
