import { DEFAULT_MASK_REGIONS, type MaskRegion } from "@shared/schema";
import {
  pixelBoxToRegion,
  unionMaskRegions,
} from "@shared/maskGeometry";
import { getMaskProfile, type LayoutClass } from "./maskProfiles";
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
}

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

export function resolveNameMaskPlan(input: {
  playerName: string;
  setHint: string | null | undefined;
  gameSetId?: string | null;
  words?: OcrWordBox[];
  imageWidth: number;
  imageHeight: number;
  slabLayout?: boolean;
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
    };
  }

  return {
    regions: DEFAULT_MASK_REGIONS.map((region) => ({ ...region })),
    source: "default",
    matchedTokens: ocr.tokens,
    profileId: profile.id,
    layoutClass: profile.layoutClass,
    nameBoxes: lastNameMatched ? ocr.boxes : [],
  };
}
