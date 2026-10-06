/** Fail-closed exact-source diagonal baker. No slab/special/unknown fallback. */
import { createHash } from "crypto";
import sharp from "sharp";
import type { MaskResult } from "./maskCardImage";
import { assertOpaqueIdentityCover } from "./maskCoverage";
import { recognizeNameWords, type OcrWordResult } from "./ocrRuntime";
import { surnameRunOutsideBand } from "./trustedProfileBand";
import { TOPPS_1988_REGIONS, TOPPS_1988_REVIEWED_SOURCES } from "./topps1988Geometry";

export async function maskReviewedTopps1988(
  raw: Buffer,
  player: string,
  opts: { cardId?: string | null; imageRotation?: number | null; skipOcr?: boolean; cardOrientation?: "portrait" | "landscape" },
): Promise<MaskResult> {
  const meta = await sharp(raw).metadata();
  const width = meta.width ?? 0, height = meta.height ?? 0;
  const regions = TOPPS_1988_REGIONS.map((r) => ({ ...r }));
  const reviewed = TOPPS_1988_REVIEWED_SOURCES.find((s) => s.cardId === opts.cardId);
  let reason: string | null = null;
  if (!reviewed || reviewed.player !== player) reason = "topps1988_source_not_reviewed";
  else if (createHash("sha256").update(raw).digest("hex") !== reviewed.sha256) reason = "topps1988_source_changed";
  else if ((opts.imageRotation ?? 0) !== 0 || opts.cardOrientation === "landscape" || !width || height <= width) reason = "topps1988_orientation_unverified";
  else if (opts.skipOcr) reason = "topps1988_ocr_required";
  // Even a refusal's diagnostic JPEG hides the known diagonal; it is never served.
  // Narrow strips need 4:4:4 high-quality encoding to preserve their opaque
  // interiors; the ordinary 4:2:0 JPEG bleeds photo color across strip edges.
  const overlays = await Promise.all(regions.map(async (r) => {
    const left = Math.round(r.xPct * width / 100), top = Math.round(r.yPct * height / 100);
    const w = Math.min(width - left, Math.round(r.wPct * width / 100));
    const h = Math.min(height - top, Math.round(r.hPct * height / 100));
    return { input: await sharp({ create: { width: Math.max(1,w), height: Math.max(1,h), channels: 3, background: { r: 10, g: 14, b: 22 } } }).png().toBuffer(), left, top };
  }));
  const maskedBuffer = await sharp(raw).composite(overlays).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
  let ocrMs = 0, ocrTimedOut = false;
  if (!reason) {
    const opaque = await assertOpaqueIdentityCover({ buffer: maskedBuffer, regions, layoutClass: "BOTTOM_PLAQUE", imageWidth: width, imageHeight: height });
    if (!opaque.ok) reason = opaque.reason;
  }
  if (!reason) {
    try {
      // Whole masked image, including jersey and slab-label zones. A silent OCR
      // error is represented as empty words by the runtime; do not accept it.
      const ocr = await recognizeNameWords(maskedBuffer, width, { deadlineMs: 6000 });
      ocrMs = ocr.ms; ocrTimedOut = ocr.timedOut;
      reason = topps1988OcrRefusal(ocr, player, width, height);
    } catch { reason = "topps1988_mask_unverified"; }
  }
  return {
    maskedBuffer, sourceBuffer: raw, ocrApplied: true, ocrMatches: [], source: "profile",
    regions, layoutClass: "BOTTOM_PLAQUE", coverageOk: !reason, coverageReason: reason,
    servedRotation: 0, ocrTimedOut, ocrMs, landscapeDesign: false, orientationAmbiguous: false,
    layoutDisagreed: !!reason, trustedBand: null,
    plateTrace: { imageWidth: width, imageHeight: height, expectedPlate: null, ocrBoxes: [], candidates: [],
      decision: reason ?? "reviewed_diagonal_source_and_mask_verified" },
  };
}

/** Keep silent OCR errors and whole-image surname leaks fail closed. */
export function topps1988OcrRefusal(ocr: OcrWordResult, player: string, width: number, height: number): string | null {
  if (ocr.timedOut || !ocr.words.length) return "topps1988_mask_unverified";
  return surnameRunOutsideBand({ playerName: player, words: ocr.words, regions: [...TOPPS_1988_REGIONS], imageWidth: width, imageHeight: height }) ? "name_visible_outside_mask" : null;
}
