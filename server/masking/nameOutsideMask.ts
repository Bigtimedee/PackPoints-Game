/**
 * Whole-image name check on an already masked JPEG.
 * The plate check only proves the printed name band is covered. A surname on a
 * jersey, a signature, or a headline still gives the card away. This does not
 * paint another mask. A hit outside the mask regions excludes the card.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import type { MaskRegion } from "@shared/schema";
import { anyRegionCoversPoint, CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { tokenizePlayerName } from "./nameLocalization";
import { recognizeNameWords, type OcrWordResult } from "./ocrRuntime";
import { maskReadySidecarDir } from "./maskReadySidecar";

/** Bump this when the matcher changes so warm v4.5 JPEGs are checked again. */
export const NAME_VISIBILITY_CHECK_VERSION = "n1";

export const NAME_VISIBLE_OUTSIDE_MASK = "name_visible_outside_mask";

const RATIO_MIN = 0.8;
const PARTIAL_RUN = 5;

/**
 * Surnames where a fuzzy or partial hit is too easy to confuse with other text.
 * An exact whole-word hit still counts.
 */
const AMBIGUOUS_SURNAMES = new Set([
  "smith", "johnson", "williams", "brown", "jones", "miller", "davis",
  "garcia", "wilson", "anderson", "taylor", "thomas", "moore", "jackson",
  "martin", "white", "harris", "clark", "lewis", "walker", "allen", "young",
  "wright", "green", "adams", "baker", "nelson", "carter", "mitchell",
  "roberts", "turner", "phillips", "campbell", "parker", "evans", "edwards",
  "collins", "stewart", "morris", "rogers", "morgan", "murphy", "bailey",
  "rivera", "cooper", "howard", "torres", "peterson", "watson", "brooks",
  "kelly", "sanders", "price", "bennett", "barnes", "henderson", "coleman",
  "jenkins", "perry", "powell", "hughes", "washington", "butler", "simmons",
  "foster", "bryant", "russell", "griffin", "hayes", "jordan", "james",
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

/** Very short, or common enough that a fuzzy hit would be ambiguous. */
export function surnameMatchIsAmbiguous(surname: string): boolean {
  const letters = normalizeNameLetters(surname);
  if (letters.length < 5) return true;
  return AMBIGUOUS_SURNAMES.has(letters);
}

export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  if (Math.abs(a.length - b.length) > Math.ceil(max * 0.34)) return 0;
  const cols = b.length + 1;
  let prev = new Array<number>(cols);
  let curr = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j < cols; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return 1 - prev[b.length] / max;
}

function hasPartialSurnameRun(surname: string, token: string): boolean {
  if (surname.length < 5 || token.length < PARTIAL_RUN) return false;
  if (surname.includes(token)) return true;
  for (let i = 0; i + PARTIAL_RUN <= surname.length; i++) {
    if (token.includes(surname.slice(i, i + PARTIAL_RUN))) return true;
  }
  return false;
}

/**
 * Case-insensitive match of one OCR token against the surname or the full name.
 * Short and common surnames match only as a whole word. Longer surnames also
 * match a Levenshtein ratio and a contiguous letter run.
 */
export function tokenMatchesPlayerName(playerName: string, rawToken: string): boolean {
  const token = normalizeNameLetters(rawToken);
  if (token.length < 2) return false;
  const surname = playerSurname(playerName);
  if (!surname) return false;
  const full = normalizeNameLetters(tokenizePlayerName(playerName).join(""));
  if (token === surname) return true;
  if (full.length >= 5 && token === full) return true;
  if (surnameMatchIsAmbiguous(surname)) return false;
  if (levenshteinRatio(token, surname) >= RATIO_MIN) return true;
  if (full.length >= 12 && levenshteinRatio(token, full) >= RATIO_MIN) return true;
  return hasPartialSurnameRun(surname, token);
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

/** True when the surname or full name is legible outside every mask region. */
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
