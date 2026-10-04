/**
 * 1987 Donruss: the trusted band fallback also covers the bottom bar. A top logo
 * can read as a text plate and refuse the card; the band stands in only when no
 * surname is read outside it.
 */
import { describe, expect, it } from "vitest";
import { buildSetMaskHint } from "@shared/maskGeometry";
import { getMaskProfile, MASK_LAYOUT_SET_IDS } from "../masking/maskProfiles";
import { trustedProfileBandCheck } from "../masking/trustedProfileBand";

const profile = getMaskProfile(
  buildSetMaskHint({ year: 1987, brand: "Donruss", sport: "baseball", setName: "1987 Donruss Baseball" }),
  MASK_LAYOUT_SET_IDS.donrussBaseball1987,
);
const base = { profile, imageWidth: 600, imageHeight: 900, playerName: "Mike Krukow", topTextPlate: null };

describe("Donruss trusted bottom band", () => {
  it("is flagged for the bottom plaque", () => {
    expect(profile.trustProfileBand).toBe(true);
    expect(profile.nameAnchor).toBe("bottom");
  });

  it("accepts a card with no surname read and no bottom letter run", () => {
    expect(trustedProfileBandCheck({ ...base, words: [], bottomTextPlate: null }).ok).toBe(true);
  });

  it("refuses a surname read above the band", () => {
    const words = [{ text: "KRUKOW", x: 40, y: 600, w: 200, h: 30 }];
    expect(trustedProfileBandCheck({ ...base, words, bottomTextPlate: null }).ok).toBe(false);
  });

  it("refuses a surname read on the top plate", () => {
    const words = [{ text: "KRUKOW", x: 40, y: 20, w: 200, h: 30 }];
    expect(trustedProfileBandCheck({ ...base, words, bottomTextPlate: null }).ok).toBe(false);
  });

  it("accepts a surname read inside the band", () => {
    const words = [{ text: "KRUKOW", x: 40, y: 820, w: 200, h: 30 }];
    expect(trustedProfileBandCheck({ ...base, words, bottomTextPlate: null }).ok).toBe(true);
  });

  it("refuses a letter run that starts just above the band", () => {
    const run = { x: 20, y: 0.81 * 900, w: 300, h: 40 };
    expect(trustedProfileBandCheck({ ...base, words: [], bottomTextPlate: run }).ok).toBe(false);
  });
});
