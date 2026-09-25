import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { MASKED_CARDS_DIR } from "./maskPlanStore";

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface OrientNote {
  rotation: QuarterTurn;
  /** True when a horizontal design was intentionally left landscape. */
  landscapeDesign: boolean;
}

export function normalizeQuarterTurn(value: unknown): QuarterTurn {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

export function orientNoteFilename(cardId: string): string {
  return `${cardId}_${CURRENT_MASK_VERSION}.orient.json`;
}

function notePath(cardId: string): string {
  return path.join(MASKED_CARDS_DIR, orientNoteFilename(cardId));
}

export function readOrientNote(cardId: string): OrientNote | null {
  if (!cardId) return null;
  const filePath = notePath(cardId);
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as { rotation?: unknown; landscapeDesign?: unknown };
    return {
      rotation: normalizeQuarterTurn(raw.rotation),
      landscapeDesign: raw.landscapeDesign === true,
    };
  } catch {
    return null;
  }
}

export function writeOrientNote(cardId: string, note: OrientNote): void {
  if (!cardId) return;
  mkdirSync(MASKED_CARDS_DIR, { recursive: true });
  writeFileSync(notePath(cardId), JSON.stringify({
    rotation: note.rotation,
    landscapeDesign: note.landscapeDesign,
  }));
}

export function clearOrientNote(cardId: string): void {
  if (!cardId) return;
  try {
    unlinkSync(notePath(cardId));
  } catch {
    // already gone
  }
}

/** JPEG SOF width/height. Null when the file is not a readable JPEG. */
export function readJpegSize(filePath: string): { width: number; height: number } | null {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch {
    return null;
  }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buf.length) return null;
    const isSof = marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3;
    if (isSof) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    offset += 2 + length;
  }
  return null;
}

export function isLandscapeJpegFile(filePath: string, minAspect = 1.3): boolean {
  const size = readJpegSize(filePath);
  if (!size) return false;
  return size.width / size.height > minAspect;
}
