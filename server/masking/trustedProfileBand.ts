/**
 * Fixed-profile band fallback for top-plate designs flagged `trustProfileBand`
 * (only 1990 Hoops today).
 *
 * On those cards the printed name sits in the top ~5-10%, inside the 18%
 * profile band. The plate detector can read the dark photo arch as part of the
 * plate (a 28-41% "plate" whose fitted band fails the 35% guard), or find no
 * top letter run while a logo strip at the bottom has one
 * (`name_plate_unresolved`), or the plate row check can trip on the gray
 * border / photo arch rows just under the band (`name_text_visible`).
 *
 * In exactly those three cases the bake may paint the profile band instead,
 * when `trustedProfileBandCheck` passes. The masked JPEG must then pass
 * `verifyTrustedProfileBand`: OCR of the whole masked card and of the strip
 * directly under the band. Three or more consecutive surname letters anywhere
 * outside the band refuses the card (`name_text_visible`). An OCR timeout
 * refuses it too (`profile_band_unverified`).
 *
 * Profiles without the flag never reach this file.
 */
import sharp from "sharp";
import type { MaskRegion } from "@shared/schema";
import type { NamePlateBox } from "@shared/maskGeometry";
import type { MaskProfile } from "./maskProfiles";
import {
  matchPlayerNameBoxes,
  splitNamePlateHits,
  type LocalizedNamePlan,
  type OcrWordBox,
} from "./nameLocalization";
import { normalizeNameLetters, playerSurname, wordSitsOutsideMask } from "./nameOutsideMask";
import { recognizeNameWords, type OcrWordResult } from "./ocrRuntime";

/** Consecutive surname letters that refuse a trusted-band card. */
export const TRUSTED_BAND_SURNAME_RUN = 3;

/** A top letter run ending this far past the band still counts as inside it (detector jitter). */
export const TRUSTED_BAND_INSIDE_SLACK = 0.02;

/**
 * A top letter run ending at least this far past the band is the photo or the
 * arch, not a name plate (the Hoops name line is ~5% tall).
 * Between the two slacks the run might be a name pushed down: no fallback.
 */
export const TRUSTED_BAND_PHOTO_MARGIN = 0.04;

/** Strip under the band that gets its own OCR pass, as a fraction of height. */
export const TRUSTED_BAND_STRIP_PCT = 0.12;

/** Per-pass OCR cap. Passes run in parallel. */
export const TRUSTED_BAND_OCR_DEADLINE_MS = 6_000;

export const PROFILE_BAND_UNVERIFIED = "profile_band_unverified";

/** Refusals the fallback may replace. */
export type TrustedBandTrigger = "mask_band_oversized" | "name_plate_unresolved" | "name_text_visible";

export interface TrustedBandCheck {
  ok: boolean;
  why: string;
}

export interface TrustedBandVerdict {
  ok: boolean;
  reason: string | null;
  /** OCR token that matched, for the log. */
  token: string | null;
}

/**
 * True when the profile band may stand in for the detected plate on this card.
 * Pure. `topTextPlate` is the letter-run box from `detectAnchorTextPlate(top)`.
 */
export function trustedProfileBandCheck(input: {
  profile: MaskProfile;
  topTextPlate: NamePlateBox | null | undefined;
  bottomTextPlate?: NamePlateBox | null | undefined;
  words: OcrWordBox[] | null | undefined;
  playerName: string;
  imageWidth: number;
  imageHeight: number;
}): TrustedBandCheck {
  const { profile } = input;
  if (!profile.trustProfileBand) return { ok: false, why: "profile not flagged trustProfileBand" };
  if (profile.matched && profile.nameAnchor === "bottom" && profile.layoutClass === "BOTTOM_PLAQUE") {
    return trustedBottomBandCheck(input);
  }
  if (!profile.matched || profile.nameAnchor !== "top" || profile.layoutClass !== "TOP_PLATE") {
    return { ok: false, why: "profile is not a fixed top plate" };
  }
  if (!(profile.topBandPct > 0) || profile.regions.length === 0) {
    return { ok: false, why: "profile has no top band" };
  }
  const height = Math.max(1, input.imageHeight);
  const width = Math.max(1, input.imageWidth);
  if (width > height) return { ok: false, why: "landscape file" };

  const bandBottom = profile.topBandPct * height;
  const ocr = matchPlayerNameBoxes(input.playerName, input.words ?? []);
  const hits = splitNamePlateHits(ocr.boxes, height);
  if (hits.bottom.length > 0) return { ok: false, why: "surname read on the bottom plate" };
  if (hits.top.some((box) => box.y + box.h > bandBottom)) {
    return { ok: false, why: "surname read below the profile band" };
  }

  const run = input.topTextPlate;
  if (!run || run.h <= 0) return { ok: true, why: "no top letter run" };
  const end = (run.y + run.h) / height;
  if (end <= profile.topBandPct + TRUSTED_BAND_INSIDE_SLACK) {
    return { ok: true, why: `top letter run ends inside the band (${(end * 100).toFixed(1)}%)` };
  }
  if (end >= profile.topBandPct + TRUSTED_BAND_PHOTO_MARGIN) {
    return { ok: true, why: `top letter run is the photo (${(end * 100).toFixed(1)}%)` };
  }
  return { ok: false, why: `top letter run ends just past the band (${(end * 100).toFixed(1)}%)` };
}

/**
 * Bottom-anchored fixed plaque (1987 Donruss). The name always prints in the
 * bottom bar. A logo at the top can read as a top text plate while the bar text
 * is not detected, which refuses the card as name_plate_unresolved. The band may
 * stand in when no surname is read outside it; the masked-image OCR decides.
 */
function trustedBottomBandCheck(input: {
  profile: MaskProfile;
  bottomTextPlate?: NamePlateBox | null | undefined;
  words: OcrWordBox[] | null | undefined;
  playerName: string;
  imageWidth: number;
  imageHeight: number;
}): TrustedBandCheck {
  const { profile } = input;
  if (!(profile.bottomBandPct > 0) || profile.regions.length === 0) {
    return { ok: false, why: "profile has no bottom band" };
  }
  const height = Math.max(1, input.imageHeight);
  const width = Math.max(1, input.imageWidth);
  if (width > height) return { ok: false, why: "landscape file" };

  const bandTopPct = 1 - profile.bottomBandPct;
  const bandTop = bandTopPct * height;
  const ocr = matchPlayerNameBoxes(input.playerName, input.words ?? []);
  const hits = splitNamePlateHits(ocr.boxes, height);
  if (hits.top.length > 0) return { ok: false, why: "surname read on the top plate" };
  if (hits.bottom.some((box) => box.y < bandTop)) {
    return { ok: false, why: "surname read above the profile band" };
  }

  const run = input.bottomTextPlate;
  if (!run || run.h <= 0) return { ok: true, why: "no bottom letter run" };
  const start = run.y / height;
  if (start >= bandTopPct - TRUSTED_BAND_INSIDE_SLACK) {
    return { ok: true, why: `bottom letter run starts inside the band (${(start * 100).toFixed(1)}%)` };
  }
  if (start <= bandTopPct - TRUSTED_BAND_PHOTO_MARGIN) {
    return { ok: true, why: `bottom letter run is the photo (${(start * 100).toFixed(1)}%)` };
  }
  return { ok: false, why: `bottom letter run starts just above the band (${(start * 100).toFixed(1)}%)` };
}

/** The plan with only the fixed profile band painted. */
export function trustedProfileBandPlan(
  profile: MaskProfile,
  plan: LocalizedNamePlan,
  trigger: TrustedBandTrigger,
  why: string,
): LocalizedNamePlan {
  const candidates = plan.plateTrace.candidates.map((candidate) => {
    if (candidate.id === "expected_profile") {
      return { ...candidate, accepted: true, why: `profile ${profile.id} band, trusted fallback for ${trigger}: ${why}` };
    }
    return { ...candidate, accepted: false };
  });
  return {
    ...plan,
    regions: profile.regions.map((region) => ({ ...region })),
    source: "profile",
    profileId: profile.id,
    layoutClass: profile.layoutClass,
    plate: null,
    layoutDisagreed: false,
    namePlateUnresolved: false,
    plateTrace: {
      ...plan.plateTrace,
      candidates,
      decision: "trusted_profile_band",
    },
  };
}

/**
 * Case-insensitive. A surname of 3 letters or fewer must appear whole; a longer
 * one leaks on any 3 consecutive letters.
 */
export function tokenHasSurnameRun(playerName: string, rawToken: string, run = TRUSTED_BAND_SURNAME_RUN): boolean {
  const token = normalizeNameLetters(rawToken);
  const surname = normalizeNameLetters(playerSurname(playerName));
  if (!surname || token.length < Math.min(run, surname.length)) return false;
  if (surname.length <= run) return token.includes(surname);
  for (let i = 0; i + run <= surname.length; i++) {
    if (token.includes(surname.slice(i, i + run))) return true;
  }
  return false;
}

/** First token (or adjacent pair) outside every region with a surname run, else null. */
export function surnameRunOutsideBand(input: {
  playerName: string;
  words: Array<{ text: string; x: number; y: number; w: number; h: number }>;
  regions: MaskRegion[];
  imageWidth: number;
  imageHeight: number;
}): string | null {
  const outside = input.words
    .filter((word) => wordSitsOutsideMask(word, input.regions, input.imageWidth, input.imageHeight))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const tokens = outside.map((word) => normalizeNameLetters(word.text)).filter((token) => token.length >= 2);
  for (const token of tokens) {
    if (tokenHasSurnameRun(input.playerName, token)) return token;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const pair = tokens[i] + tokens[i + 1];
    if (tokenHasSurnameRun(input.playerName, pair)) return pair;
  }
  return null;
}

type Recognize = (buffer: Buffer, originalWidth: number, opts?: { deadlineMs?: number }) => Promise<OcrWordResult>;

/**
 * OCR the masked card and the strip right under the band (left and right
 * halves, so each is read at about twice the scale). Refuse on 3+ surname
 * letters outside the band or on any OCR timeout.
 */
export async function verifyTrustedProfileBand(input: {
  buffer: Buffer;
  playerName: string;
  regions: MaskRegion[];
  bandBottomPct: number;
  /** "bottom": bandBottomPct is the band height and the strip sits just above the band. */
  anchor?: "top" | "bottom";
  imageWidth: number;
  imageHeight: number;
  recognize?: Recognize;
  deadlineMs?: number;
}): Promise<TrustedBandVerdict> {
  const recognize = input.recognize ?? recognizeNameWords;
  const deadlineMs = input.deadlineMs ?? TRUSTED_BAND_OCR_DEADLINE_MS;
  const width = Math.max(1, input.imageWidth);
  const height = Math.max(1, input.imageHeight);
  if (!playerSurname(input.playerName)) return { ok: false, reason: PROFILE_BAND_UNVERIFIED, token: null };

  let stripTop: number;
  let stripHeight: number;
  if (input.anchor === "bottom") {
    const bandTop = Math.round((1 - input.bandBottomPct) * height);
    stripHeight = Math.max(1, Math.min(bandTop, Math.round(TRUSTED_BAND_STRIP_PCT * height)));
    stripTop = Math.max(0, bandTop - stripHeight);
  } else {
    stripTop = Math.min(height - 1, Math.max(0, Math.round(input.bandBottomPct * height)));
    stripHeight = Math.max(1, Math.min(height - stripTop, Math.round(TRUSTED_BAND_STRIP_PCT * height)));
  }
  const half = Math.round(width * 0.55);
  const crops = [
    { left: 0, width: Math.min(width, half) },
    { left: Math.max(0, width - half), width: Math.min(width, half) },
  ];
  const stripBuffers = await Promise.all(crops.map((crop) => sharp(input.buffer)
    .extract({ left: crop.left, top: stripTop, width: crop.width, height: stripHeight })
    .toBuffer()));

  const [full, ...strips] = await Promise.all([
    recognize(input.buffer, width, { deadlineMs }),
    ...stripBuffers.map((buffer, index) => recognize(buffer, crops[index].width, { deadlineMs })),
  ]);
  if (full.timedOut || strips.some((strip) => strip.timedOut)) {
    return { ok: false, reason: PROFILE_BAND_UNVERIFIED, token: null };
  }

  const fullHit = surnameRunOutsideBand({
    playerName: input.playerName,
    words: full.words,
    regions: input.regions,
    imageWidth: width,
    imageHeight: height,
  });
  if (fullHit) return { ok: false, reason: "name_text_visible", token: fullHit };

  for (let i = 0; i < strips.length; i++) {
    // Strip words are already below the band. No region applies inside the crop.
    const hit = surnameRunOutsideBand({
      playerName: input.playerName,
      words: strips[i].words,
      regions: [],
      imageWidth: crops[i].width,
      imageHeight: stripHeight,
    });
    if (hit) return { ok: false, reason: "name_text_visible", token: hit };
  }
  return { ok: true, reason: null, token: null };
}
