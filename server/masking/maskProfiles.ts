import { lifecycleProfile } from "../services/setLifecycleRegistry";
import { DEFAULT_MASK_REGIONS, type MaskRegion } from "@shared/schema";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";

import { TOPPS_1988_SET_ID, TOPPS_1988_PROFILE_ID, TOPPS_1988_REGIONS } from "./topps1988Geometry";

export type NameAnchor = "top" | "bottom" | "both";

/**
 * Where the printed player name lives.
 * UNKNOWN is a wire sentinel only. Bakes do not emit it.
 * TODO: excluding UNKNOWN cards from dealing is deferred until every active set has a registered profile.
 */
export type LayoutClass = "TOP_PLATE" | "BOTTOM_PLAQUE" | "PSA_SLAB" | "UNKNOWN";

export interface MaskProfile {
  id: string;
  matched: boolean;
  /** Admin-authored geometry is exact; detectors may reject it, never refit it. */
  fixedNameBand?: boolean;
  /**
   * Fail-closed base layout gate for a fixed band. A source scan whose pixel
   * size differs is not the base design this band was authored on and is
   * refused as `layout_not_base`. Unset on every other profile.
   */
  baseSourceSize?: { width: number; height: number };
  /**
   * Fail-closed aspect/width gate for a fixed band whose scans vary in size.
   * width/height outside [minRatio,maxRatio] or width < minWidth -> `layout_not_base`.
   * Opt-in; unset on every live profile.
   */
  sourceAspectGate?: { minRatio: number; maxRatio: number; minWidth: number };
  nameAnchor: NameAnchor;
  layoutClass: LayoutClass;
  /**
   * Explicit landscape flag for a horizontal card design. Nothing in production
   * sets this today; `"landscape"` keeps the file as-is and paints only the
   * profile band. Portrait sets stay `"portrait"`.
   */
  cardOrientation: "portrait" | "landscape";
  /**
   * Kept on the profile for a known sideways scan. An OCR miss does not apply
   * it: that case stays at 0° and covers every orientation's name band.
   */
  sidewaysFallbackDeg: 0 | 90 | 270;
  topBandPct: number;
  bottomBandPct: number;
  leftBandPct: number;
  rightBandPct: number;
  blurSigma: number;
  regions: MaskRegion[];
  /**
   * Fixed top-plate design whose printed name always sits inside the profile
   * band. When the plate detector reads the photo as part of the plate (band
   * would be oversized) or finds no top letter run (name_plate_unresolved), or
   * the plate row check trips on the photo arch below the band, the bake may
   * paint the profile band instead, then must pass the OCR surname check in
   * `trustedProfileBand.ts`. Only 1990 Hoops sets this. Every other profile is
   * false and bakes exactly as before.
   */
  trustProfileBand: boolean;
}

/**
 * Production game_sets ids. Lookup prefers these over year+brand.
 * 1987 Topps baseball and 1987 Topps football share a year and brand and must not share a mask.
 * 1990 Hoops is not in this map. It is matched by year, brand, and sport, or by set name,
 * because a re-import receives a new id.
 */
export const MASK_LAYOUT_SET_IDS = {
  toppsBaseball1988: TOPPS_1988_SET_ID,
  toppsBaseball1987: "37fd025d-2ae1-4c92-b8ad-133375d0c722",
  toppsFootball1987: "91cfdf3f-a620-4e73-adc8-22b8df221716",
  fleerBasketball1989: "aea515e2-24bc-42bd-a602-1514b89e8cd1",
  toppsBaseball1989: "352b33d1-c110-4e09-b641-8e3c02a94442",
  toppsFootball1994: "a09b2fe7-728e-431b-9df8-bbf2652aa3b2",
  donrussBaseball1987: "3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4",
  upperDeckBasketball1995: "3235b4fd-858a-424b-b9df-6f0f2d070d1b",
  toppsBaseball1986: "2b77043a-6583-4d79-b59d-d2ab20291a17",
} as const;

/**
 * Live sets that still bake from OCR location on the unmatched default profile.
 * These ids count as registered so they are not held for no_mask_profile.
 * Dealability is CLEARED_SET_IDS, not this list. A re-import gets a new id.
 */
export const MASK_HOLD_EXEMPT_SET_IDS = [
  "74885a41-2043-4b7c-ab58-f9e16c05e2e3",
  "229f0379-aa56-40a8-abe3-1af217a397e8",
] as const;

const holdExemptSetIds = new Set<string>(MASK_HOLD_EXEMPT_SET_IDS);

/** 1990 NBA Hoops prints the name in the top plate. Same band as 1989 Fleer Basketball. */
export const HOOPS_1990_PROFILE_ID = "1990-hoops-top";

/**
 * Reference floor for a ~750x1030 Fleer scan that still has its outer margin.
 * The bake replaces this when the detected plate on that file sticks out.
 */
const TOP_NAME_PLATE: MaskRegion[] = [
  { xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "blur", radiusPct: 0 },
];

/** 1987 Topps Football header: team banner + position + player name. Tuned on Dixon / Kosar / Monk scans (name inside ~22%, face below). */
const TOP_PLATE_24: MaskRegion[] = [
  { xPct: 0, yPct: 0, wPct: 100, hPct: 24, type: "blur", radiusPct: 0 },
];

const BOTTOM_PLAQUE_46: MaskRegion[] = DEFAULT_MASK_REGIONS.map((region) => ({ ...region }));

const BOTTOM_PLAQUE_20: MaskRegion[] = [
  { xPct: 0, yPct: 80, wPct: 100, hPct: 20, type: "blur", radiusPct: 0 },
];

const BOTTOM_PLAQUE_35: MaskRegion[] = [
  { xPct: 0, yPct: 65, wPct: 100, hPct: 35, type: "blur", radiusPct: 0 },
];

/**
 * 1994 Topps Football in production is 1994 Topps Finest (name on the bottom bar, not a top plate).
 * 28% covers that bar. The baseball 46% plaque hides the jersey.
 */
const BOTTOM_PLAQUE_28: MaskRegion[] = [
  { xPct: 0, yPct: 72, wPct: 100, hPct: 28, type: "blur", radiusPct: 0 },
];

/**
 * 1987 Donruss baseball: the name prints in the team-colour bar at the bottom of
 * the photo window. Diamond Kings use a gold plaque in the same place. Design
 * approved this band on 2026-10-03. It is painted opaque like the other plaques.
 */
const BOTTOM_PLAQUE_16: MaskRegion[] = [
  { xPct: 0, yPct: 84, wPct: 100, hPct: 16, type: "blur", radiusPct: 0 },
];

function layoutClassFor(nameAnchor: NameAnchor): LayoutClass {
  if (nameAnchor === "top") return "TOP_PLATE";
  if (nameAnchor === "both") return "PSA_SLAB";
  return "BOTTOM_PLAQUE";
}

function profile(
  id: string,
  nameAnchor: NameAnchor,
  regions: MaskRegion[],
  extras: Partial<Pick<MaskProfile, "topBandPct" | "bottomBandPct" | "blurSigma" | "cardOrientation" | "sidewaysFallbackDeg" | "trustProfileBand" | "fixedNameBand" | "baseSourceSize" | "sourceAspectGate">> = {},
): MaskProfile {
  const topBandPct = extras.topBandPct ?? (nameAnchor === "top" || nameAnchor === "both" ? regions[0]?.hPct / 100 : 0);
  const bottomBandPct = extras.bottomBandPct ?? (nameAnchor === "bottom" ? (regions[0]?.hPct ?? 46) / 100 : 0);
  const cardOrientation = extras.cardOrientation ?? "portrait";
  const sidewaysFallbackDeg = extras.sidewaysFallbackDeg ?? (cardOrientation === "portrait" ? 90 : 0);
  return {
    id,
    matched: id !== "default",
    nameAnchor,
    layoutClass: layoutClassFor(nameAnchor),
    cardOrientation,
    sidewaysFallbackDeg,
    topBandPct: topBandPct || 0,
    bottomBandPct: bottomBandPct || 0,
    leftBandPct: 0,
    rightBandPct: 0,
    blurSigma: extras.blurSigma ?? 25,
    regions: regions.map((region) => ({ ...region })),
    trustProfileBand: extras.trustProfileBand === true,
    ...(extras.fixedNameBand === true ? { fixedNameBand: true } : {}),
    ...(extras.baseSourceSize ? { baseSourceSize: { ...extras.baseSourceSize } } : {}),
    ...(extras.sourceAspectGate ? { sourceAspectGate: { ...extras.sourceAspectGate } } : {}),
  };
}

const defaultProfile = profile("default", "bottom", BOTTOM_PLAQUE_46, { bottomBandPct: 0.46, topBandPct: 0 });

const fleerBasketballTop = profile("fleer-bball-top", "top", TOP_NAME_PLATE, {
  topBandPct: 0.18,
  bottomBandPct: 0,
});

const hoopsBasketball1990 = profile(HOOPS_1990_PROFILE_ID, "top", TOP_NAME_PLATE, {
  topBandPct: 0.18,
  bottomBandPct: 0,
  // Name and position print in the top ~5-10% of every base card. The plate
  // detector often reads the dark photo arch as plate (28-41% tall).
  trustProfileBand: true,
});

const toppsBaseball1987 = profile("1987-topps", "bottom", BOTTOM_PLAQUE_46, { bottomBandPct: 0.46, topBandPct: 0 });
const toppsBaseball1989 = profile("1989-topps", "bottom", BOTTOM_PLAQUE_46, { bottomBandPct: 0.46, topBandPct: 0 });
const toppsFootball1987 = profile("1987-topps-football", "top", TOP_PLATE_24, {
  topBandPct: 0.24,
  bottomBandPct: 0,
});
const toppsFootball1994 = profile("1994-topps-football", "bottom", BOTTOM_PLAQUE_28, {
  bottomBandPct: 0.28,
  topBandPct: 0,
});

export const DONRUSS_1987_PROFILE_ID = "1987-donruss";
const donrussBaseball1987 = profile(DONRUSS_1987_PROFILE_ID, "bottom", BOTTOM_PLAQUE_16, {
  bottomBandPct: 0.16,
  // Name always prints in the bottom bar. The top logo can read as a text plate and refuse the card.
  trustProfileBand: true,
});

/**
 * 1995-96 Upper Deck Basketball: foil name across the bottom (~86-91%), team and
 * position line ~93%. Design profile 2026-10-10. Opaque, exact fixed band (#210):
 * never refit or widened; an OCR surname outside the band refuses the card.
 */
export const UPPER_DECK_1995_BASKETBALL_PROFILE_ID = "1995-upper-deck-bb";
const BOTTOM_PLAQUE_17_UD95: MaskRegion[] = [
  { xPct: 0, yPct: 83, wPct: 100, hPct: 17, type: "blur", radiusPct: 0 },
];
const upperDeckBasketball1995 = profile(UPPER_DECK_1995_BASKETBALL_PROFILE_ID, "bottom", BOTTOM_PLAQUE_17_UD95, {
  bottomBandPct: 0.17,
  topBandPct: 0,
  sidewaysFallbackDeg: 0,
  fixedNameBand: true,
  // Design: base design is the 705x1200 scan (UD logo top left, foil name across the bottom).
  baseSourceSize: { width: 705, height: 1200 },
});

/** 1986 Topps Baseball (2b77043a): gate for Design's fixed-band profile (not registered here). */
export const TOPPS_1986_SOURCE_ASPECT_GATE = { minRatio: 0.68, maxRatio: 0.76, minWidth: 360 } as const;

/** Pure: does a source of this size pass the aspect/width gate? */
export function passesSourceAspectGate(width: number, height: number, gate: { minRatio: number; maxRatio: number; minWidth: number }): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const r = width / height;
  return width >= gate.minWidth && r >= gate.minRatio && r <= gate.maxRatio;
}

/**
 * 1986 Topps Baseball: player name in a small box at the bottom. Design profile
 * 2026-10-10: opaque fixed band y 86-100%, never refit or widened. Team name (top
 * black band) and the position circle stay visible. Scans vary in size, so the
 * aspect/width gate refuses composites, extra margin and under-card watermarks.
 */
export const TOPPS_1986_BASEBALL_PROFILE_ID = "1986-topps";
const toppsBaseball1986 = profile(TOPPS_1986_BASEBALL_PROFILE_ID, "bottom", [
  { xPct: 0, yPct: 86, wPct: 100, hPct: 14, type: "blur", radiusPct: 0 },
], {
  bottomBandPct: 0.14,
  topBandPct: 0,
  sidewaysFallbackDeg: 0,
  fixedNameBand: true,
  sourceAspectGate: { ...TOPPS_1986_SOURCE_ASPECT_GATE },
});

/** Year+brand keys. Applied when sport is baseball or absent. A present non-baseball sport must not hit these. */
const baseballNamedProfiles: Record<string, MaskProfile> = {
  "1987 topps": toppsBaseball1987,
  "1989 upper deck": profile("1989-upper-deck", "bottom", BOTTOM_PLAQUE_20, { bottomBandPct: 0.20, topBandPct: 0 }),
  "1952 topps": profile("1952-topps", "bottom", BOTTOM_PLAQUE_35, { bottomBandPct: 0.35, topBandPct: 0 }),
};

/** sport|year|brand. Sport is required — year+brand alone is not a key. */
const sportProfiles: Record<string, MaskProfile> = {
  "football|1987|topps": toppsFootball1987,
  "football|1994|topps": toppsFootball1994,
  "baseball|1987|topps": toppsBaseball1987,
  "baseball|1989|topps": toppsBaseball1989,
  "baseball|1987|donruss": donrussBaseball1987,
  "basketball|1995|upper deck": upperDeckBasketball1995,
  "baseball|1986|topps": toppsBaseball1986,
};

const toppsBaseball1988 = profile(TOPPS_1988_PROFILE_ID, "bottom", [...TOPPS_1988_REGIONS], {
  bottomBandPct: 0, topBandPct: 0, trustProfileBand: false, sidewaysFallbackDeg: 0,
});

const setIdProfiles: Record<string, MaskProfile> = {
  [MASK_LAYOUT_SET_IDS.toppsBaseball1988]: toppsBaseball1988,
  [MASK_LAYOUT_SET_IDS.toppsFootball1987]: toppsFootball1987,
  [MASK_LAYOUT_SET_IDS.toppsFootball1994]: toppsFootball1994,
  [MASK_LAYOUT_SET_IDS.toppsBaseball1987]: toppsBaseball1987,
  [MASK_LAYOUT_SET_IDS.fleerBasketball1989]: fleerBasketballTop,
  [MASK_LAYOUT_SET_IDS.toppsBaseball1989]: toppsBaseball1989,
  [MASK_LAYOUT_SET_IDS.donrussBaseball1987]: donrussBaseball1987,
  [MASK_LAYOUT_SET_IDS.upperDeckBasketball1995]: upperDeckBasketball1995,
  [MASK_LAYOUT_SET_IDS.toppsBaseball1986]: toppsBaseball1986,
};

export interface ParsedSetHint {
  raw: string;
  year: number | null;
  brand: string;
  sport: string;
}

export function parseSetHint(setName: string | null | undefined): ParsedSetHint {
  const raw = (setName || "").trim().toLowerCase().replace(/\s+/g, " ");
  const yearMatch = raw.match(/\b((?:19|20)\d{2})\b/);
  const sportMatch = raw.match(/\b(basketball|baseball|football|hockey)\b/);
  const brandMatch = raw.match(/\b(fleer|topps|upper deck|bowman|donruss|score|ud|panini|prizm|chrome|hoops)\b/);
  // MLB is baseball. A real sport token wins when both appear, so football stays football.
  const sport = sportMatch ? sportMatch[1] : (/\bmlb\b/.test(raw) ? "baseball" : "");
  return {
    raw,
    year: yearMatch ? Number(yearMatch[1]) : null,
    brand: brandMatch ? brandMatch[1] : "",
    sport,
  };
}

function isFleerBasketballTopName(hint: ParsedSetHint): boolean {
  if (!hint.raw.includes("fleer")) return false;
  if (hint.sport === "baseball" || hint.sport === "football" || hint.sport === "hockey") return false;
  if (hint.sport !== "basketball") return false;
  if (hint.year == null) return hint.raw.includes("fleer");
  return hint.year >= 1986 && hint.year <= 1990;
}

/**
 * 1990 NBA Hoops, same shape as the Fleer top-name check.
 * Year 1990 + brand Hoops + basketball, or the normalized names
 * "1990 Hoops Basketball" and "1990 NBA Hoops". The game_sets id is not a key.
 */
function is1990HoopsBasketball(hint: ParsedSetHint): boolean {
  if (hint.sport === "baseball" || hint.sport === "football" || hint.sport === "hockey") return false;
  if (hint.raw.includes("1990 hoops basketball") || hint.raw.includes("1990 nba hoops")) return true;
  return hint.year === 1990 && hint.brand === "hoops" && hint.sport === "basketball";
}

function sportLayoutKey(hint: ParsedSetHint): string | null {
  if (!hint.sport || hint.year == null || !hint.brand) return null;
  return `${hint.sport}|${hint.year}|${hint.brand}`;
}

function baseballYearBrandProfile(hint: ParsedSetHint): MaskProfile | null {
  if (hint.sport && hint.sport !== "baseball") return null;
  const exact = baseballNamedProfiles[hint.raw];
  if (exact) return exact;
  for (const [key, value] of Object.entries(baseballNamedProfiles)) {
    if (hint.raw.includes(key)) return value;
  }
  return null;
}

/**
 * An unmatched hint still returns the default bottom 46% profile.
 * Active integrated sets that resolve here are held unless the id is exempt.
 * MASK_HOLD_EXEMPT_SET_IDS stay on this same default. Clearance is separate.
 */
export function getMaskProfile(setName: string | null | undefined, gameSetId?: string | null): MaskProfile {
  const id = (gameSetId || "").trim().toLowerCase();
  if (id && setIdProfiles[id]) return setIdProfiles[id];
  const authored = lifecycleProfile(id);
  if (authored) return authored;

  const hint = parseSetHint(setName);
  if (!hint.raw && !id) return defaultProfile;

  const sportKey = sportLayoutKey(hint);
  if (sportKey && sportProfiles[sportKey]) return sportProfiles[sportKey];

  if (isFleerBasketballTopName(hint)) {
    return fleerBasketballTop;
  }

  if (is1990HoopsBasketball(hint)) {
    return hoopsBasketball1990;
  }

  const baseball = baseballYearBrandProfile(hint);
  if (baseball) return baseball;

  return defaultProfile;
}

export function isMaskHoldExemptSet(gameSetId?: string | null): boolean {
  const id = (gameSetId || "").trim().toLowerCase();
  return id.length > 0 && holdExemptSetIds.has(id);
}

/** A matched profile, or a legacy id in MASK_HOLD_EXEMPT_SET_IDS. */
export function profileIsRegistered(profile: MaskProfile, gameSetId?: string | null): boolean {
  if (isMaskHoldExemptSet(gameSetId)) return true;
  return profile.matched && profile.id !== "default";
}

/** The unmatched bottom 46% plaque. A 1990 Hoops bake with these pixels is stale. */
export function isDefaultBottomPlaque(regions: MaskRegion[] | null | undefined): boolean {
  if (!regions || regions.length !== DEFAULT_MASK_REGIONS.length) return false;
  return regions.every((region, index) => {
    const expected = DEFAULT_MASK_REGIONS[index];
    return region.xPct === expected.xPct
      && region.yPct === expected.yPct
      && region.wPct === expected.wPct
      && region.hPct === expected.hPct
      && region.type === expected.type;
  });
}

/**
 * A cached Hoops JPEG painted with the old default bottom plaque must be rebaked.
 * A band fitted to OCR boxes on that card is kept.
 */
export function hoopsBottomBakeIsStale(
  profileId: string,
  layoutClass: string | null | undefined,
  regions: MaskRegion[] | null | undefined,
): boolean {
  if (profileId !== HOOPS_1990_PROFILE_ID) return false;
  if (regions && regions.length > 0) return isDefaultBottomPlaque(regions);
  return layoutClass == null || layoutClass === "BOTTOM_PLAQUE";
}

export function profileToRegions(setName: string | null | undefined, gameSetId?: string | null): MaskRegion[] {
  return getMaskProfile(setName, gameSetId).regions.map((region) => ({ ...region }));
}

export interface DealtMaskHint {
  setHint?: string | null;
  gameSetId?: string | null;
}

const DEFAULT_PROFILE_LOG_INTERVAL_MS = 10 * 60 * 1000;
const defaultProfileLoggedAt = new Map<string, number>();

export function resetDefaultProfileLogForTests(): void {
  defaultProfileLoggedAt.clear();
}

/** One line per set when a dealt or baked card uses the unmatched default profile. At most once per set per process per 10 minutes. */
export function logDealtDefaultMaskProfiles(cards: DealtMaskHint[], now = Date.now()): void {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (getMaskProfile(card.setHint, card.gameSetId).matched) continue;
    const set = (card.gameSetId || "").trim() || "none";
    counts.set(set, (counts.get(set) || 0) + 1);
  }
  for (const [set, count] of counts) {
    const last = defaultProfileLoggedAt.get(set);
    if (last != null && now - last < DEFAULT_PROFILE_LOG_INTERVAL_MS) continue;
    defaultProfileLoggedAt.set(set, now);
    console.log(`[MaskProfile] default profile used set=${set} count=${count}`);
  }
}

export { CURRENT_MASK_VERSION };
