import sharp from "sharp";
import { recognizeNameWords, type OcrWordResult } from "./ocrRuntime";
import { PROFILE_BAND_UNVERIFIED, tokenHasSurnameRun } from "./trustedProfileBand";
import { normalizeNameLetters } from "./nameOutsideMask";

type Recognize = (buffer: Buffer, originalWidth: number, opts?: { deadlineMs?: number }) => Promise<OcrWordResult>;

export const FIXED_BAND_ROTATED_REASON = "name_text_visible_rotated";
const DEADLINE_MS = 6000;

/**
 * Fixed authored bands only. The band itself is opaque, so any surname run the
 * OCR reads on the masked image, upright or turned 90 / 270 degrees, is a leak
 * (vertical edge names, sideways captions). A timeout fails closed.
 */
export async function verifyFixedBandRotations(input: {
  buffer: Buffer;
  playerName: string;
  recognize?: Recognize;
}): Promise<{ ok: true; reason: null; token: null } | { ok: false; reason: string; token: string | null }> {
  const recognize = input.recognize ?? recognizeNameWords;
  for (const deg of [90, 270] as const) {
    const turned = await sharp(input.buffer).rotate(deg).toBuffer({ resolveWithObject: true });
    const ocr = await recognize(turned.data, turned.info.width, { deadlineMs: DEADLINE_MS });
    if (ocr.timedOut) return { ok: false, reason: PROFILE_BAND_UNVERIFIED, token: null };
    const tokens = ocr.words.map((w) => normalizeNameLetters(w.text)).filter((t) => t.length >= 2);
    for (let i = 0; i < tokens.length; i++) {
      if (tokenHasSurnameRun(input.playerName, tokens[i])) return { ok: false, reason: FIXED_BAND_ROTATED_REASON, token: tokens[i] };
      if (i + 1 < tokens.length && tokenHasSurnameRun(input.playerName, tokens[i] + tokens[i + 1])) {
        return { ok: false, reason: FIXED_BAND_ROTATED_REASON, token: tokens[i] + tokens[i + 1] };
      }
    }
  }
  return { ok: true, reason: null, token: null };
}
