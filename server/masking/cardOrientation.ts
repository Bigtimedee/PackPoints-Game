import sharp from "sharp";
import type { MaskProfile } from "./maskProfiles";
import { matchPlayerNameBoxes, tokenizePlayerName, type OcrWordBox } from "./nameLocalization";
import { recognizeWords, type OcrWordResult } from "./ocrRuntime";
import { normalizeQuarterTurn, type QuarterTurn } from "./orientNote";

/** A file wider than this is landscape. Card-shaped sideways scans sit near 1.40. */
export const LANDSCAPE_FILE_ASPECT = 1.3;

export interface UprightCard {
  buffer: Buffer;
  rotation: QuarterTurn;
  source: "field" | "ocr" | "profile" | "none";
  landscapeDesign: boolean;
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

function fallbackTurn(profile: MaskProfile): QuarterTurn {
  const turn = profile.sidewaysFallbackDeg;
  if (turn === 90 || turn === 270) return turn;
  return 0;
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

function lastNameHit(playerName: string, words: OcrWordBox[]): { boxes: OcrWordBox[]; hit: boolean } {
  const matched = matchPlayerNameBoxes(playerName, words);
  const lastName = tokenizePlayerName(playerName).slice(-1)[0];
  const hit = lastName ? matched.tokens.includes(lastName) : matched.tokens.length > 0;
  return { boxes: matched.boxes, hit };
}

/**
 * Turn a scan into the card's upright orientation before the mask is painted.
 * Evidence, in order: `imageRotation`, OCR of the 90° and 270° candidates, then
 * the set profile. A horizontal design stays landscape.
 */
export async function uprightCardImage(
  raw: Buffer,
  input: {
    imageRotation?: number | null;
    playerName: string;
    profile: MaskProfile;
    cardOrientation?: "portrait" | "landscape";
    skipOcr?: boolean;
    recognize?: (buffer: Buffer, width: number) => Promise<OcrWordResult>;
  },
): Promise<UprightCard> {
  const field = normalizeQuarterTurn(input.imageRotation);
  if (field !== 0) {
    return {
      buffer: await rotateBuffer(raw, field),
      rotation: field,
      source: "field",
      landscapeDesign: false,
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
      words: null,
      ocrTimedOut: false,
      ocrMs: 0,
    };
  }

  const recognize = input.recognize ?? recognizeWords;
  if (input.skipOcr) {
    const rotation = fallbackTurn(input.profile);
    return {
      buffer: await rotateBuffer(raw, rotation),
      rotation,
      source: rotation ? "profile" : "none",
      landscapeDesign: false,
      words: [],
      ocrTimedOut: false,
      ocrMs: 0,
    };
  }

  let ocrMs = 0;
  let loose: { rotation: QuarterTurn; buffer: Buffer; words: OcrWordBox[] } | null = null;
  for (const rotation of [90, 270] as const) {
    const turned = await rotateBuffer(raw, rotation);
    const turnedMeta = await sharp(turned).metadata();
    const turnedWidth = turnedMeta.width || 1;
    const turnedHeight = turnedMeta.height || 1;
    const ocr = await recognize(turned, turnedWidth);
    ocrMs += ocr.ms;
    if (ocr.timedOut) {
      const fb = fallbackTurn(input.profile);
      return {
        buffer: await rotateBuffer(raw, fb),
        rotation: fb,
        source: "profile",
        landscapeDesign: false,
        words: [],
        ocrTimedOut: true,
        ocrMs,
      };
    }
    const matched = lastNameHit(input.playerName, ocr.words);
    if (!matched.hit) continue;
    if (lastNameInAnchor(matched.boxes, input.profile, turnedHeight)) {
      return {
        buffer: turned,
        rotation,
        source: "ocr",
        landscapeDesign: false,
        words: ocr.words,
        ocrTimedOut: false,
        ocrMs,
      };
    }
    if (!loose) loose = { rotation, buffer: turned, words: ocr.words };
  }

  if (loose) {
    return {
      buffer: loose.buffer,
      rotation: loose.rotation,
      source: "ocr",
      landscapeDesign: false,
      words: loose.words,
      ocrTimedOut: false,
      ocrMs,
    };
  }

  const fb = fallbackTurn(input.profile);
  return {
    buffer: await rotateBuffer(raw, fb),
    rotation: fb,
    source: fb ? "profile" : "none",
    landscapeDesign: false,
    words: [],
    ocrTimedOut: false,
    ocrMs,
  };
}
