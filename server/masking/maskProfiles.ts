import { DEFAULT_MASK_REGIONS, type MaskRegion } from "@shared/schema";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";

export type NameAnchor = "top" | "bottom" | "both";

export interface MaskProfile {
  id: string;
  matched: boolean;
  nameAnchor: NameAnchor;
  topBandPct: number;
  bottomBandPct: number;
  leftBandPct: number;
  rightBandPct: number;
  blurSigma: number;
  regions: MaskRegion[];
}

const TOP_NAME_PLATE: MaskRegion[] = [
  { xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "blur", radiusPct: 0 },
];

const BOTTOM_PLAQUE_46: MaskRegion[] = DEFAULT_MASK_REGIONS.map((region) => ({ ...region }));

const BOTTOM_PLAQUE_20: MaskRegion[] = [
  { xPct: 0, yPct: 80, wPct: 100, hPct: 20, type: "blur", radiusPct: 0 },
];

const BOTTOM_PLAQUE_35: MaskRegion[] = [
  { xPct: 0, yPct: 65, wPct: 100, hPct: 35, type: "blur", radiusPct: 0 },
];

function profile(
  id: string,
  nameAnchor: NameAnchor,
  regions: MaskRegion[],
  extras: Partial<Pick<MaskProfile, "topBandPct" | "bottomBandPct" | "blurSigma">> = {},
): MaskProfile {
  const topBandPct = extras.topBandPct ?? (nameAnchor === "top" || nameAnchor === "both" ? regions[0]?.hPct / 100 : 0);
  const bottomBandPct = extras.bottomBandPct ?? (nameAnchor === "bottom" ? (regions[0]?.hPct ?? 46) / 100 : 0);
  return {
    id,
    matched: id !== "default",
    nameAnchor,
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

const namedProfiles: Record<string, MaskProfile> = {
  "1987 topps": profile("1987-topps", "bottom", BOTTOM_PLAQUE_46, { bottomBandPct: 0.46, topBandPct: 0 }),
  "1989 upper deck": profile("1989-upper-deck", "bottom", BOTTOM_PLAQUE_20, { bottomBandPct: 0.20, topBandPct: 0 }),
  "1952 topps": profile("1952-topps", "bottom", BOTTOM_PLAQUE_35, { bottomBandPct: 0.35, topBandPct: 0 }),
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
  return {
    raw,
    year: yearMatch ? Number(yearMatch[1]) : null,
    brand: brandMatch ? brandMatch[1] : "",
    sport: sportMatch ? sportMatch[1] : "",
  };
}

function isFleerBasketballTopName(hint: ParsedSetHint): boolean {
  if (!hint.raw.includes("fleer")) return false;
  if (hint.sport === "baseball" || hint.sport === "football" || hint.sport === "hockey") return false;
  if (hint.sport !== "basketball") return false;
  if (hint.year == null) return hint.raw.includes("fleer");
  return hint.year >= 1986 && hint.year <= 1990;
}

export function getMaskProfile(setName: string | null | undefined): MaskProfile {
  const hint = parseSetHint(setName);
  if (!hint.raw) return defaultProfile;

  if (isFleerBasketballTopName(hint)) {
    return fleerBasketballTop;
  }

  const exact = namedProfiles[hint.raw];
  if (exact) return exact;

  for (const [key, value] of Object.entries(namedProfiles)) {
    if (hint.raw.includes(key)) return value;
  }

  return defaultProfile;
}

export function profileToRegions(setName: string | null | undefined): MaskRegion[] {
  return getMaskProfile(setName).regions.map((region) => ({ ...region }));
}

export { CURRENT_MASK_VERSION };
