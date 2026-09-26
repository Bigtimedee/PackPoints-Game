/**
 * Whole-image name check on an already masked JPEG.
 * The plate check only proves the printed name band is covered. A surname on a
 * jersey, a signature, or a headline still gives the card away. This does not
 * paint another mask and does not widen the band. A hit outside the mask
 * regions excludes the card.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import type { MaskRegion } from "@shared/schema";
import { anyRegionCoversPoint, CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { tokenizePlayerName } from "./nameLocalization";
import { recognizeNameWords, type OcrWordResult } from "./ocrRuntime";
import { maskReadySidecarDir } from "./maskReadySidecar";

/** Bump this when the matcher changes so warm JPEGs of this mask version are checked again. */
export const NAME_VISIBILITY_CHECK_VERSION = "n2";

export const NAME_VISIBLE_OUTSIDE_MASK = "name_visible_outside_mask";

/** Contiguous surname letters that count as a partial leak. */
export const PARTIAL_SURNAME_RUN = 4;

/**
 * Very common English words, plus a few card-chrome words, all exactly 4 letters.
 * A partial surname run is ignored only when the OCR token is exactly one of
 * these words. A longer token that merely contains the word still leaks
 * (`WITHER` contains `WITH`). The whole surname still leaks when the token is
 * that surname, including Long or Will.
 * `the` and `and` are 3 letters. They cannot form a 4-letter run, so they are
 * not listed. Surname-shaped words (john, king, lee, hall, wood, ford) are
 * not listed either.
 */
export const COMMON_OCR_WORDS: ReadonlySet<string> = new Set([
  "also", "back", "base", "been", "card", "come", "down", "each",
  "even", "ever", "find", "from", "give", "good", "have", "here",
  "home", "into", "just", "know", "last", "like", "long", "look",
  "made", "make", "many", "mint", "more", "most", "much", "only",
  "over", "said", "same", "some", "such", "take", "team", "than",
  "that", "them", "then", "they", "this", "time", "very", "want",
  "well", "were", "what", "when", "will", "with", "word", "work",
  "year", "your",
]);

export interface NameOcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NameVisibilityVerdict {
  ok: boolean;
  reason: string | null;
  /** OCR did not finish. The card is not excluded and is not marked checked. */
  skipped: boolean;
}

export function nameVisibilityPassFilename(cardId: string): string {
  return `${cardId}_${CURRENT_MASK_VERSION}.${NAME_VISIBILITY_CHECK_VERSION}`;
}

export function playerSurname(playerName: string): string {
  const tokens = tokenizePlayerName(playerName);
  return tokens[tokens.length - 1] || "";
}

export function normalizeNameLetters(value: string): string {
  return value
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/5/g, "s")
    .replace(/8/g, "b")
    .replace(/6/g, "g")
    .replace(/2/g, "z")
    .replace(/[^a-z]/g, "");
}

/**
 * Case-insensitive surname leak.
 * A token leaks when it contains the whole surname (this is the rule for a
 * surname of 4 letters or shorter, and it also catches a longer surname
 * written out). A longer surname also leaks when the token contains 4 or more
 * consecutive letters of that surname. The common-word guard applies only when
 * that 4-letter run is the entire OCR token.
 */
export function tokenMatchesPlayerName(playerName: string, rawToken: string): boolean {
  const token = normalizeNameLetters(rawToken);
  if (token.length < 2) return false;
  const surname = normalizeNameLetters(playerSurname(playerName));
  if (!surname) return false;
  if (token.includes(surname)) return true;
  if (surname.length <= PARTIAL_SURNAME_RUN || token.length < PARTIAL_SURNAME_RUN) return false;
  if (token.length === PARTIAL_SURNAME_RUN && surname.includes(token) && COMMON_OCR_WORDS.has(token)) {
    return false;
  }
  for (let i = 0; i + PARTIAL_SURNAME_RUN <= surname.length; i++) {
    if (token.includes(surname.slice(i, i + PARTIAL_SURNAME_RUN))) return true;
  }
  return false;
}

export function wordSitsOutsideMask(
  word: NameOcrWord,
  regions: MaskRegion[],
  imageWidth: number,
  imageHeight: number,
): boolean {
  if (regions.length === 0) return true;
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);
  const cx = ((word.x + word.w / 2) / width) * 100;
  const cy = ((word.y + word.h / 2) / height) * 100;
  return !anyRegionCoversPoint(regions, cx, cy);
}

/** True when the surname is legible outside every mask region. */
export function visiblePlayerNameOutsideMask(input: {
  playerName: string;
  words: NameOcrWord[];
  regions: MaskRegion[];
  imageWidth: number;
  imageHeight: number;
}): boolean {
  const outside = input.words
    .filter((word) => wordSitsOutsideMask(word, input.regions, input.imageWidth, input.imageHeight))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const tokens = outside.map((word) => normalizeNameLetters(word.text)).filter((token) => token.length >= 2);
  for (const token of tokens) {
    if (tokenMatchesPlayerName(input.playerName, token)) return true;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokenMatchesPlayerName(input.playerName, tokens[i] + tokens[i + 1])) return true;
  }
  return false;
}

export async function verifyNameVisibleOutsideMask(input: {
  buffer: Buffer;
  playerName: string;
  regions: MaskRegion[];
  imageWidth?: number;
  imageHeight?: number;
  recognize?: (buffer: Buffer, originalWidth: number) => Promise<OcrWordResult>;
}): Promise<NameVisibilityVerdict> {
  if (!playerSurname(input.playerName)) {
    return { ok: true, reason: null, skipped: false };
  }
  const meta = await sharp(input.buffer).metadata();
  const imageWidth = input.imageWidth || meta.width || 1;
  const imageHeight = input.imageHeight || meta.height || 1;
  const recognize = input.recognize ?? recognizeNameWords;
  const ocr = await recognize(input.buffer, imageWidth);
  if (ocr.timedOut) {
    return { ok: true, reason: null, skipped: true };
  }
  const visible = visiblePlayerNameOutsideMask({
    playerName: input.playerName,
    words: ocr.words,
    regions: input.regions,
    imageWidth,
    imageHeight,
  });
  if (visible) return { ok: false, reason: NAME_VISIBLE_OUTSIDE_MASK, skipped: false };
  return { ok: true, reason: null, skipped: false };
}

function safeCardId(cardId: string): boolean {
  return Boolean(cardId)
    && !cardId.includes("/")
    && !cardId.includes("\\")
    && !cardId.includes("..")
    && !cardId.includes("\0");
}

export function readNameVisibilityPassed(cardId: string, dir = maskReadySidecarDir()): boolean {
  if (!safeCardId(cardId)) return false;
  try {
    const text = readFileSync(path.join(dir, nameVisibilityPassFilename(cardId)), "utf8");
    return text.trim().length > 0;
  } catch {
    return false;
  }
}

export function writeNameVisibilityPassed(cardId: string, dir = maskReadySidecarDir()): void {
  if (!safeCardId(cardId)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, nameVisibilityPassFilename(cardId)), `${NAME_VISIBILITY_CHECK_VERSION}\n`);
}

export function clearNameVisibilityPassed(cardId: string, dir = maskReadySidecarDir()): void {
  if (!safeCardId(cardId)) return;
  try {
    unlinkSync(path.join(dir, nameVisibilityPassFilename(cardId)));
  } catch {
    // already gone
  }
}
