import { DEFAULT_MASK_REGIONS, type MaskRegion } from "@shared/schema";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";

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
}

/**
 * Production game_sets ids. Lookup prefers these over year+brand.
 * 1987 Topps baseball and 1987 Topps football share a year and brand and must not share a mask.
 */
export const MASK_LAYOUT_SET_IDS = {
  toppsBaseball1987: "37fd025d-2ae1-4c92-b8ad-133375d0c722",
  toppsFootball1987: "91cfdf3f-a620-4e73-adc8-22b8df221716",
  toppsFootball1994: "a09b2fe7-728e-431b-9df8-bbf2652aa3b2",
} as const;

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

function layoutClassFor(nameAnchor: NameAnchor): LayoutClass {
  if (nameAnchor === "top") return "TOP_PLATE";
  if (nameAnchor === "both") return "PSA_SLAB";
  return "BOTTOM_PLAQUE";
}

function profile(
  id: string,
  nameAnchor: NameAnchor,
  regions: MaskRegion[],
  extras: Partial<Pick<MaskProfile, "topBandPct" | "bottomBandPct" | "blurSigma" | "cardOrientation" | "sidewaysFallbackDeg">> = {},
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
  };
}

const defaultProfile = profile("default", "bottom", BOTTOM_PLAQUE_46, { bottomBandPct: 0.46, topBandPct: 0 });

const fleerBasketballTop = profile("fleer-bball-top", "top", TOP_NAME_PLATE, {
  topBandPct: 0.18,
  bottomBandPct: 0,
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
};

const setIdProfiles: Record<string, MaskProfile> = {
  [MASK_LAYOUT_SET_IDS.toppsFootball1987]: toppsFootball1987,
  [MASK_LAYOUT_SET_IDS.toppsFootball1994]: toppsFootball1994,
  [MASK_LAYOUT_SET_IDS.toppsBaseball1987]: toppsBaseball1987,
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
  const brandMatch = raw.match(/\b(fleer|topps|upper deck|bowman|donruss|score|ud|panini|prizm|chrome)\b/);
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
 * TODO: UNKNOWN exclusion is deferred until every active set has a registered profile.
 * Unmatched hints stay dealable and bake the default bottom 46% plaque.
 */
export function getMaskProfile(setName: string | null | undefined, gameSetId?: string | null): MaskProfile {
  const id = (gameSetId || "").trim().toLowerCase();
  if (id && setIdProfiles[id]) return setIdProfiles[id];

  const hint = parseSetHint(setName);
  if (!hint.raw && !id) return defaultProfile;

  const sportKey = sportLayoutKey(hint);
  if (sportKey && sportProfiles[sportKey]) return sportProfiles[sportKey];

  if (isFleerBasketballTopName(hint)) {
    return fleerBasketballTop;
  }

  const baseball = baseballYearBrandProfile(hint);
  if (baseball) return baseball;

  return defaultProfile;
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
