import { DEFAULT_MASK_REGIONS, type MaskRegion } from "@shared/schema";
import {
  fitNamePlateBand,
  pixelBoxToRegion,
  unionMaskRegions,
  type NamePlateBox,
} from "@shared/maskGeometry";
import { getMaskProfile, type LayoutClass, type MaskProfile } from "./maskProfiles";
import { ocrLooksLikeSlab, slabMaskRegions } from "./slabLayout";

export interface OcrWordBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tesseract word confidence, 0–100. Absent when the caller did not measure it. */
  confidence?: number;
}

export interface LocalizedNamePlan {
  regions: MaskRegion[];
  source: "ocr+profile" | "profile" | "ocr" | "default";
  matchedTokens: string[];
  profileId: string;
  layoutClass: LayoutClass;
  nameBoxes: OcrWordBox[];
  /** Plate the band was fitted to. Null when the fixed profile band was kept. */
  plate: NamePlateBox | null;
  /** Surname was found on a plate the set profile does not use. */
  layoutDisagreed: boolean;
  /** A letter plate sits on the other edge and no surname was read. Do not serve the profile band. */
  namePlateUnresolved: boolean;
}

/** Center of a word in the top name plate, as a fraction of image height. */
export const TOP_NAME_PLATE_MAX_CY = 0.35;
/** Center of a word in the bottom name plate. */
export const BOTTOM_NAME_PLATE_MIN_CY = 0.62;

const OCR_PAD_PCT = 1.6;

export function tokenizePlayerName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^(jr|sr|ii|iii|iv)$/g, ""))
    .filter((token) => token.length > 1);
}

export function fuzzyMatchToken(detected: string, target: string): boolean {
  if (!detected || !target) return false;
  const a = normalizeOcrToken(detected);
  const b = normalizeOcrToken(target);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  let distance = 0;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    if (a[i] !== b[i]) distance++;
    if (distance > 1) return false;
  }
  return distance <= 1;
}

function normalizeOcrToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/1/g, "i")
    .replace(/0/g, "o")
    .replace(/5/g, "s");
}

export function matchPlayerNameBoxes(
  playerName: string,
  words: OcrWordBox[],
): { boxes: OcrWordBox[]; tokens: string[] } {
  const tokens = tokenizePlayerName(playerName);
  if (tokens.length === 0) return { boxes: [], tokens: [] };

  const lastName = tokens[tokens.length - 1];
  const joined = tokens.join("");
  const boxes: OcrWordBox[] = [];
  const matchedTokens: string[] = [];

  for (const word of words) {
    const detected = normalizeOcrToken(word.text);
    if (!detected) continue;

    let hit: string | null = null;
    for (const token of tokens) {
      if (fuzzyMatchToken(detected, token)) {
        hit = token;
        break;
      }
    }
    if (!hit && lastName && fuzzyMatchToken(detected, lastName)) {
      hit = lastName;
    }
    if (!hit && joined.length >= 5 && fuzzyMatchToken(detected, joined)) {
      hit = lastName || tokens[0];
    }
    if (!hit) continue;

    boxes.push(word);
    if (!matchedTokens.includes(hit)) matchedTokens.push(hit);
  }

  return { boxes, tokens: matchedTokens };
}

export function boxesToPaddedRegions(
  boxes: OcrWordBox[],
  imageWidth: number,
  imageHeight: number,
): MaskRegion[] {
  const padX = (OCR_PAD_PCT / 100) * imageWidth;
  const padY = (OCR_PAD_PCT / 100) * imageHeight;
  const regions = boxes.map((box) =>
    pixelBoxToRegion(
      {
        x: box.x - padX,
        y: box.y - padY,
        w: box.w + padX * 2,
        h: box.h + padY * 2,
      },
      imageWidth,
      imageHeight,
    ),
  );
  return unionMaskRegions(regions);
}

export function plateBoxFromWords(words: OcrWordBox[]): NamePlateBox | null {
  if (words.length === 0) return null;
  const x = Math.min(...words.map((word) => word.x));
  const y = Math.min(...words.map((word) => word.y));
  const right = Math.max(...words.map((word) => word.x + word.w));
  const bottom = Math.max(...words.map((word) => word.y + word.h));
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}

export function mergePlateBoxes(anchor: "top" | "bottom", boxes: Array<NamePlateBox | null>): NamePlateBox | null {
  const present = boxes.filter((box): box is NamePlateBox => box != null && box.w > 0 && box.h > 0);
  if (present.length === 0) return null;
  const x = Math.min(...present.map((box) => box.x));
  const y = Math.min(...present.map((box) => box.y));
  const right = Math.max(...present.map((box) => box.x + box.w));
  const bottom = Math.max(...present.map((box) => box.y + box.h));
  if (anchor === "top") {
    return { x: 0, y: 0, w: right, h: bottom };
  }
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}

/**
 * The fixed profile band already hides this plate. A couple percent of slack
 * absorbs detector jitter on a normal ~750x1030 scan. A tight crop whose plate
 * sticks out past that slack is not covered.
 */
export function profileCoversPlate(profile: MaskProfile, plate: NamePlateBox, imageHeight: number): boolean {
  const height = Math.max(1, imageHeight);
  const slack = height * 0.02;
  const bottom = plate.y + plate.h;
  if (profile.nameAnchor === "top") {
    return plate.y >= -2 && bottom <= profile.topBandPct * height + slack;
  }
  if (profile.nameAnchor === "bottom") {
    const bandTop = (1 - profile.bottomBandPct) * height;
    return plate.y >= bandTop - slack && bottom <= height + 2;
  }
  return false;
}

export function splitNamePlateHits(
  words: OcrWordBox[],
  imageHeight: number,
): { top: OcrWordBox[]; bottom: OcrWordBox[] } {
  const height = Math.max(1, imageHeight);
  const top: OcrWordBox[] = [];
  const bottom: OcrWordBox[] = [];
  for (const word of words) {
    const cy = (word.y + word.h / 2) / height;
    if (cy <= TOP_NAME_PLATE_MAX_CY) top.push(word);
    else if (cy >= BOTTOM_NAME_PLATE_MIN_CY) bottom.push(word);
  }
  return { top, bottom };
}

function planFromOffProfileHits(
  profile: MaskProfile,
  offProfileHits: OcrWordBox[],
  onProfileHits: OcrWordBox[],
  imageWidth: number,
  imageHeight: number,
  matchedTokens: string[],
): LocalizedNamePlan {
  const offAnchor = profile.nameAnchor === "top" ? "bottom" : "top";
  const plate = plateBoxFromWords(offProfileHits);
  const regions: MaskRegion[] = [];
  if (plate) {
    regions.push(fitNamePlateBand({
      anchor: offAnchor,
      imageWidth,
      imageHeight,
      profileFraction: 0.18,
      plate,
    }));
  }
  if (onProfileHits.length > 0) {
    regions.push(...profile.regions.map((region) => ({ ...region })));
  }
  const layoutClass: LayoutClass = onProfileHits.length > 0
    ? "PSA_SLAB"
    : offAnchor === "top"
      ? "TOP_PLATE"
      : "BOTTOM_PLAQUE";
  const boxes = [...offProfileHits, ...onProfileHits];
  return {
    regions: unionMaskRegions(regions),
    source: "ocr+profile",
    matchedTokens,
    profileId: profile.id,
    layoutClass,
    nameBoxes: boxes,
    plate: plateBoxFromWords(boxes),
    layoutDisagreed: true,
    namePlateUnresolved: false,
  };
}

export function resolveNameMaskPlan(input: {
  playerName: string;
  setHint: string | null | undefined;
  gameSetId?: string | null;
  words?: OcrWordBox[];
  imageWidth: number;
  imageHeight: number;
  slabLayout?: boolean;
  /** Detected name plate in this image's pixels. OCR boxes are merged in. */
  plateBox?: NamePlateBox | null;
  /** Letter rows on the top edge, independent of the set profile. */
  topTextPlate?: NamePlateBox | null;
  /** Letter rows on the bottom edge, independent of the set profile. */
  bottomTextPlate?: NamePlateBox | null;
}): LocalizedNamePlan {
  const profile = getMaskProfile(input.setHint, input.gameSetId);
  const ocr = matchPlayerNameBoxes(input.playerName, input.words || []);
  const ocrRegions = boxesToPaddedRegions(ocr.boxes, input.imageWidth, input.imageHeight);
  const lastName = tokenizePlayerName(input.playerName).slice(-1)[0];
  const lastNameMatched = lastName ? ocr.tokens.includes(lastName) : ocr.tokens.length > 0;
  const isSlab = Boolean(input.slabLayout) || ocrLooksLikeSlab(input.words || [], input.imageHeight);

  if (isSlab) {
    const regions = unionMaskRegions([
      ...slabMaskRegions(profile),
      ...(lastNameMatched ? ocrRegions : []),
    ]);
    return {
      regions,
      source: lastNameMatched && ocrRegions.length > 0 ? "ocr+profile" : "profile",
      matchedTokens: ocr.tokens,
      profileId: "psa-slab",
      layoutClass: "PSA_SLAB",
      nameBoxes: lastNameMatched ? ocr.boxes : [],
      plate: null,
      layoutDisagreed: false,
      namePlateUnresolved: false,
    };
  }

  const plateHits = splitNamePlateHits(ocr.boxes, input.imageHeight);
  const offProfileHits = profile.nameAnchor === "top"
    ? plateHits.bottom
    : profile.nameAnchor === "bottom"
      ? plateHits.top
      : [];
  const onProfileHits = profile.nameAnchor === "top"
    ? plateHits.top
    : profile.nameAnchor === "bottom"
      ? plateHits.bottom
      : [];
  if (profile.matched && offProfileHits.length > 0) {
    return planFromOffProfileHits(
      profile,
      offProfileHits,
      onProfileHits,
      input.imageWidth,
      input.imageHeight,
      ocr.tokens,
    );
  }
  if (profile.matched && profile.nameAnchor !== "both" && plateHits.top.length === 0 && plateHits.bottom.length === 0) {
    const onProfile = profile.nameAnchor === "top" ? input.topTextPlate : input.bottomTextPlate;
    const onOther = profile.nameAnchor === "top" ? input.bottomTextPlate : input.topTextPlate;
    if (onOther && !onProfile) {
      return {
        regions: profile.regions.map((region) => ({ ...region })),
        source: "profile",
        matchedTokens: ocr.tokens,
        profileId: profile.id,
        layoutClass: profile.layoutClass,
        nameBoxes: [],
        plate: null,
        layoutDisagreed: true,
        namePlateUnresolved: true,
      };
    }
  }

  const anchor = profile.nameAnchor === "top" ? "top" : "bottom";
  const plate = mergePlateBoxes(anchor, [
    input.plateBox ?? null,
    lastNameMatched ? plateBoxFromWords(ocr.boxes) : null,
  ]);
  if (
    profile.matched
    && profile.nameAnchor === "bottom"
    && plate
    && plate.h / Math.max(1, input.imageHeight) + 0.06 < profile.bottomBandPct
  ) {
    const band = fitNamePlateBand({
      anchor: "bottom",
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
      profileFraction: profile.bottomBandPct,
      plate,
    });
    return {
      regions: [band],
      source: lastNameMatched && ocrRegions.length > 0 ? "ocr+profile" : "profile",
      matchedTokens: ocr.tokens,
      profileId: profile.id,
      layoutClass: profile.layoutClass,
      nameBoxes: lastNameMatched ? ocr.boxes : [],
      plate,
      layoutDisagreed: false,
      namePlateUnresolved: false,
    };
  }
  if (
    profile.matched
    && (profile.nameAnchor === "top" || profile.nameAnchor === "bottom")
    && plate
    && !profileCoversPlate(profile, plate, input.imageHeight)
  ) {
    const band = fitNamePlateBand({
      anchor,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
      profileFraction: anchor === "top" ? profile.topBandPct : profile.bottomBandPct,
      plate,
    });
    return {
      regions: unionMaskRegions([band, ...profile.regions]),
      source: lastNameMatched && ocrRegions.length > 0 ? "ocr+profile" : "profile",
      matchedTokens: ocr.tokens,
      profileId: profile.id,
      layoutClass: profile.layoutClass,
      nameBoxes: lastNameMatched ? ocr.boxes : [],
      plate,
      layoutDisagreed: false,
      namePlateUnresolved: false,
    };
  }

  if (profile.matched && ocrRegions.length > 0 && lastNameMatched) {
    return {
      regions: unionMaskRegions([...profile.regions, ...ocrRegions]),
      source: "ocr+profile",
      matchedTokens: ocr.tokens,
      profileId: profile.id,
      layoutClass: profile.layoutClass,
      nameBoxes: ocr.boxes,
      plate: null,
      layoutDisagreed: false,
      namePlateUnresolved: false,
    };
  }

  if (profile.matched) {
    return {
      regions: profile.regions.map((region) => ({ ...region })),
      source: "profile",
      matchedTokens: ocr.tokens,
      profileId: profile.id,
      layoutClass: profile.layoutClass,
      nameBoxes: lastNameMatched ? ocr.boxes : [],
      plate: null,
      layoutDisagreed: false,
      namePlateUnresolved: false,
    };
  }

  if (ocrRegions.length > 0 && lastNameMatched) {
    const topName = ocr.boxes.some((box) => (box.y + box.h / 2) / input.imageHeight <= 0.35);
    return {
      regions: ocrRegions,
      source: "ocr",
      matchedTokens: ocr.tokens,
      profileId: profile.id,
      layoutClass: topName ? "TOP_PLATE" : "BOTTOM_PLAQUE",
      nameBoxes: ocr.boxes,
      plate: plateBoxFromWords(ocr.boxes),
      layoutDisagreed: false,
      namePlateUnresolved: false,
    };
  }

  return {
    regions: DEFAULT_MASK_REGIONS.map((region) => ({ ...region })),
    source: "default",
    matchedTokens: ocr.tokens,
    profileId: profile.id,
    layoutClass: profile.layoutClass,
    nameBoxes: lastNameMatched ? ocr.boxes : [],
    plate: null,
    layoutDisagreed: false,
    namePlateUnresolved: false,
  };
}
