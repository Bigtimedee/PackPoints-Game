import sharp from "sharp";
import type { MaskProfile } from "./maskProfiles";
import { matchPlayerNameBoxes, tokenizePlayerName, type OcrWordBox } from "./nameLocalization";
import { ocrDeadlineMs, recognizeWords, type OcrWordResult } from "./ocrRuntime";
import { normalizeQuarterTurn, type QuarterTurn } from "./orientNote";

/** Shared across 0°, 90°, and 270°. Three full 8s passes blow the 20s bake deadline. */
export const ORIENTATION_OCR_BUDGET_MS = 12_000;
export const ORIENTATION_BAKE_RESERVE_MS = 1_500;
/** Stop once a last-name hit in the name anchor is at least this confident (0–100). */
export const CONFIDENT_ORIENTATION_CONFIDENCE = 70;
/** 0° is cheapest (no rotate) and the likely hit for a real landscape card. */
export const ORIENTATION_OCR_PASS_ORDER: QuarterTurn[] = [0, 90, 270];

export function orientationOcrBudgetMs(input: {
  deadlineMs: number;
  elapsedMs: number;
  reserveMs?: number;
  capMs?: number;
}): number {
  const cap = input.capMs ?? ORIENTATION_OCR_BUDGET_MS;
  const reserve = input.reserveMs ?? ORIENTATION_BAKE_RESERVE_MS;
  const left = input.deadlineMs - input.elapsedMs - reserve;
  return Math.max(0, Math.min(cap, left));
}

export function isConfidentOrientationHit(probe: { inAnchor: boolean; confidence: number }): boolean {
  return probe.inAnchor && probe.confidence >= CONFIDENT_ORIENTATION_CONFIDENCE;
}

/** A file wider than this is landscape. Card-shaped sideways scans sit near 1.40. */
export const LANDSCAPE_FILE_ASPECT = 1.3;

export interface UprightCard {
  buffer: Buffer;
  rotation: QuarterTurn;
  source: "field" | "ocr" | "profile" | "none";
  landscapeDesign: boolean;
  /**
   * Landscape file, no imageRotation, and OCR could not place the last name.
   * The file is not turned. The bake covers the name band for 0°, 90°, and 270°.
   */
  orientationAmbiguous: boolean;
  /** null: OCR has not run on the upright image. An array: probe already finished. */
  words: OcrWordBox[] | null;
  ocrTimedOut: boolean;
  ocrMs: number;
}

async function rotateBuffer(buffer: Buffer, rotation: QuarterTurn): Promise<Buffer> {
  if (rotation === 0) return buffer;
  return sharp(buffer).rotate(rotation).toBuffer();
}

export async function applyServedRotation(buffer: Buffer, rotation: QuarterTurn): Promise<Buffer> {
  return rotateBuffer(buffer, rotation);
}

function lastNameInAnchor(boxes: OcrWordBox[], profile: MaskProfile, imageHeight: number): boolean {
  if (boxes.length === 0 || imageHeight <= 0) return false;
  return boxes.some((box) => {
    const cy = (box.y + box.h / 2) / imageHeight;
    if (profile.nameAnchor === "top") return cy <= 0.45;
    if (profile.nameAnchor === "both") return cy <= 0.28 || cy >= 0.62;
    return cy >= 0.5;
  });
}

function meanConfidence(boxes: OcrWordBox[]): number {
  const values = boxes
    .map((box) => box.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

interface NameProbe {
  rotation: QuarterTurn;
  buffer: Buffer;
  words: OcrWordBox[];
  inAnchor: boolean;
  confidence: number;
}

/** 0° replaces another candidate only when its confidence is strictly better. */
function betterProbe(next: NameProbe, current: NameProbe): boolean {
  if (next.inAnchor !== current.inAnchor) return next.inAnchor;
  if (next.confidence !== current.confidence) return next.confidence > current.confidence;
  return current.rotation === 0 && next.rotation !== 0;
}

function ambiguousStay(raw: Buffer, ocrMs: number, ocrTimedOut: boolean): UprightCard {
  return {
    buffer: raw,
    rotation: 0,
    source: "profile",
    landscapeDesign: false,
    orientationAmbiguous: true,
    words: [],
    ocrTimedOut,
    ocrMs,
  };
}

function lastNameHit(playerName: string, words: OcrWordBox[]): { boxes: OcrWordBox[]; hit: boolean } {
  const matched = matchPlayerNameBoxes(playerName, words);
  const lastName = tokenizePlayerName(playerName).slice(-1)[0];
  const hit = lastName ? matched.tokens.includes(lastName) : matched.tokens.length > 0;
  return { boxes: matched.boxes, hit };
}

/**
 * Turn a scan into the card's upright orientation before the mask is painted.
 * Evidence, in order: `imageRotation`, then OCR of the 0°, 90°, and 270°
 * candidates. The highest-confidence last-name hit wins, and 0° wins only
 * when it is strictly better. A profile with `cardOrientation: "landscape"`
 * stays landscape. An OCR miss does not turn the file.
 */
export async function uprightCardImage(
  raw: Buffer,
  input: {
    imageRotation?: number | null;
    playerName: string;
    profile: MaskProfile;
    cardOrientation?: "portrait" | "landscape";
    skipOcr?: boolean;
    recognize?: (buffer: Buffer, width: number, opts?: { deadlineMs?: number }) => Promise<OcrWordResult>;
    /** Wall-clock cap for every orientation pass together. Default 12s. */
    orientationBudgetMs?: number;
  },
): Promise<UprightCard> {
  const field = normalizeQuarterTurn(input.imageRotation);
  if (field !== 0) {
    return {
      buffer: await rotateBuffer(raw, field),
      rotation: field,
      source: "field",
      landscapeDesign: false,
      orientationAmbiguous: false,
      words: null,
      ocrTimedOut: false,
      ocrMs: 0,
    };
  }

  const meta = await sharp(raw).metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const aspect = width / height;
  if (aspect <= LANDSCAPE_FILE_ASPECT) {
    return {
      buffer: raw,
      rotation: 0,
      source: "none",
      landscapeDesign: false,
      orientationAmbiguous: false,
      words: null,
      ocrTimedOut: false,
      ocrMs: 0,
    };
  }

  const orientation = input.cardOrientation ?? input.profile.cardOrientation;
  if (orientation === "landscape") {
    return {
      buffer: raw,
      rotation: 0,
      source: "profile",
      landscapeDesign: true,
      orientationAmbiguous: false,
      words: null,
      ocrTimedOut: false,
      ocrMs: 0,
    };
  }

  const recognize = input.recognize ?? recognizeWords;
  if (input.skipOcr) return ambiguousStay(raw, 0, false);

  const budget = input.orientationBudgetMs ?? ORIENTATION_OCR_BUDGET_MS;
  const started = Date.now();
  let ocrMs = 0;
  let best: NameProbe | null = null;
  let timedOut = false;
  for (const rotation of ORIENTATION_OCR_PASS_ORDER) {
    const remaining = budget - (Date.now() - started);
    if (remaining < 250) return ambiguousStay(raw, ocrMs, true);
    const turned = rotation === 0 ? raw : await rotateBuffer(raw, rotation);
    const turnedMeta = await sharp(turned).metadata();
    const turnedWidth = turnedMeta.width || 1;
    const turnedHeight = turnedMeta.height || 1;
    const ocr = await recognize(turned, turnedWidth, {
      deadlineMs: Math.min(ocrDeadlineMs(), remaining),
    });
    ocrMs += ocr.ms;
    if (ocr.timedOut) {
      timedOut = true;
      if (budget - (Date.now() - started) < 250) return ambiguousStay(raw, ocrMs, true);
      continue;
    }
    const matched = lastNameHit(input.playerName, ocr.words);
    if (!matched.hit) continue;
    const probe: NameProbe = {
      rotation,
      buffer: turned,
      words: ocr.words,
      inAnchor: lastNameInAnchor(matched.boxes, input.profile, turnedHeight),
      confidence: meanConfidence(matched.boxes),
    };
    if (isConfidentOrientationHit(probe)) {
      return {
        buffer: probe.buffer,
        rotation: probe.rotation,
        source: "ocr",
        landscapeDesign: probe.rotation === 0,
        orientationAmbiguous: false,
        words: probe.words,
        ocrTimedOut: false,
        ocrMs,
      };
    }
    if (!best || betterProbe(probe, best)) best = probe;
  }

  if (!best) return ambiguousStay(raw, ocrMs, timedOut);
  return {
    buffer: best.buffer,
    rotation: best.rotation,
    source: "ocr",
    landscapeDesign: best.rotation === 0,
    orientationAmbiguous: false,
    words: best.words,
    ocrTimedOut: false,
    ocrMs,
  };
}
