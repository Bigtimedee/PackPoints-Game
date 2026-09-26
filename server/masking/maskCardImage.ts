import sharp from "sharp";
import { CURRENT_MASK_VERSION, getMaskProfile } from "./maskProfiles";
import {
  resolveNameMaskPlan,
  type NamePlateTrace,
  type OcrWordBox,
} from "./nameLocalization";
import { detectPsaSlabLayout } from "./slabLayout";
import { assertOpaqueIdentityCover } from "./maskCoverage";
import { detectAnchorPlate, detectAnchorTextPlate } from "./namePlateDetect";
import { verifyMaskedNamePlate } from "./maskPlateVerify";
import { applyServedRotation, uprightCardImage } from "./cardOrientation";
import { recognizeWords } from "./ocrRuntime";
import { readOrientNote, writeOrientNote, type QuarterTurn } from "./orientNote";
import { clampRegion } from "@shared/maskGeometry";
import type { MaskRegion } from "@shared/schema";

export interface MaskResult {
  maskedBuffer: Buffer;
  ocrApplied: boolean;
  ocrMatches: string[];
  source: "ocr+profile" | "profile" | "ocr" | "default";
  regions: MaskRegion[];
  layoutClass: "TOP_PLATE" | "BOTTOM_PLAQUE" | "PSA_SLAB" | "UNKNOWN";
  /** False means the printed name is still readable or the photo was wiped. Do not serve. */
  coverageOk: boolean;
  coverageReason: string | null;
  /** Clockwise degrees applied before the mask. 0 means the file was already served upright. */
  servedRotation: QuarterTurn;
  /** True when OCR hit its deadline. The bake still used profile or default geometry. */
  ocrTimedOut: boolean;
  ocrMs: number;
  landscapeDesign: boolean;
  /** Guessed quarter-turn. Regions include the profile band and its 180° mirror. */
  orientationAmbiguous: boolean;
  /** The surname was found on a plate the set profile does not use. */
  layoutDisagreed: boolean;
  /** Resolver measurements. Present on every bake. */
  plateTrace: NamePlateTrace;
  /** Upright source the boxes were measured on. Not written to the mask cache. */
  sourceBuffer: Buffer;
}

/** Same navy as the GameCard name band (`#0a0e16`). No alpha channel. */
const MASK_FILL = { r: 10, g: 14, b: 22 };

/**
 * Cover name/identity regions with a solid rect.
 *
 * v4.2 used `{ alpha: 0.94 }` and `.blur(8)` on that rect. The blur feathers
 * the overlay; it does not blur the card. About 6% of the original contrast
 * stayed sharp, so PSA cert text and Fleer top-plate names remained readable
 * (Design re-QA 2026-09-21). An RGB overlay has no see-through window.
 */
async function applyPercentRegions(
  imageBuffer: Buffer,
  regions: MaskRegion[],
): Promise<Buffer> {
  if (regions.length === 0) return imageBuffer;

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 1000;
  const overlays: sharp.OverlayOptions[] = [];

  for (const region of regions) {
    const left = Math.max(0, Math.round((region.xPct / 100) * width));
    const top = Math.max(0, Math.round((region.yPct / 100) * height));
    const rw = Math.min(width - left, Math.max(0, Math.round((region.wPct / 100) * width)));
    const rh = Math.min(height - top, Math.max(0, Math.round((region.hPct / 100) * height)));
    if (rw < 2 || rh < 2) continue;

    const overlay = await sharp({
      create: {
        width: rw,
        height: rh,
        channels: 3,
        background: MASK_FILL,
      },
    })
      .png()
      .toBuffer();

    overlays.push({ input: overlay, top, left });
  }

  if (overlays.length === 0) return imageBuffer;
  return sharp(imageBuffer).composite(overlays).jpeg({ quality: 85 }).toBuffer();
}

function sameRegion(a: MaskRegion, b: MaskRegion): boolean {
  return Math.abs(a.xPct - b.xPct) < 0.5
    && Math.abs(a.yPct - b.yPct) < 0.5
    && Math.abs(a.wPct - b.wPct) < 0.5
    && Math.abs(a.hPct - b.hPct) < 0.5;
}

/**
 * Region defined in the image after a clockwise `rotation`, expressed in the
 * unrotated source. 90° CW sends a bottom band to the right edge; 270° CW
 * sends it to the left edge.
 */
function regionInSource(region: MaskRegion, rotation: QuarterTurn): MaskRegion {
  if (rotation === 0) return { ...region };
  const x = region.xPct;
  const y = region.yPct;
  const right = x + region.wPct;
  const bottom = y + region.hPct;
  const corners = rotation === 90
    ? [
      [y, 100 - x],
      [y, 100 - right],
      [bottom, 100 - x],
      [bottom, 100 - right],
    ]
    : rotation === 270
      ? [
        [100 - y, x],
        [100 - y, right],
        [100 - bottom, x],
        [100 - bottom, right],
      ]
      : [
        [100 - x, 100 - y],
        [100 - right, 100 - y],
        [100 - x, 100 - bottom],
        [100 - right, 100 - bottom],
      ];
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return clampRegion({
    ...region,
    xPct: minX,
    yPct: minY,
    wPct: Math.max(...xs) - minX,
    hPct: Math.max(...ys) - minY,
  });
}

/**
 * Profile band in the file as stored, plus that same band after a 90° and a
 * 270° turn, mapped back onto the unrotated image. A full-width horizontal
 * name and a full-height side name are both covered, with no gap through either.
 */
function coverNameBandsForBothOrientations(regions: MaskRegion[]): MaskRegion[] {
  const covered = regions.map((region) => ({ ...region }));
  for (const region of regions) {
    for (const rotation of [90, 270] as const) {
      const mapped = regionInSource(region, rotation);
      if (mapped.wPct < 2 || mapped.hPct < 2) continue;
      if (covered.some((existing) => sameRegion(existing, mapped))) continue;
      covered.push(mapped);
    }
  }
  return covered;
}

/** Profile band first, then the same band flipped 180° so a wrong turn still hides the name. */
function coverBothNameBands(regions: MaskRegion[]): MaskRegion[] {
  const covered = regions.map((region) => ({ ...region }));
  for (const region of regions) {
    const mirror = clampRegion({
      ...region,
      yPct: 100 - (region.yPct + region.hPct),
    });
    if (mirror.wPct < 2 || mirror.hPct < 2) continue;
    const already = covered.some((existing) => sameRegion(existing, mirror));
    if (!already) covered.push(mirror);
  }
  return covered;
}

export async function maskCardImage(
  rawImageBuffer: Buffer,
  playerName: string,
  setName: string | null | undefined,
  opts: {
    skipOcr?: boolean;
    words?: OcrWordBox[];
    gameSetId?: string | null;
    imageRotation?: number | null;
    cardId?: string | null;
    /** Horizontal design. Overrides the set profile when the caller already knows. */
    cardOrientation?: "portrait" | "landscape";
    onStage?: (stage: "ocr" | "bake") => void;
    /** Shared cap for the 0°/90°/270° probes. The bake path shrinks this to fit 20s. */
    orientationBudgetMs?: number;
  } = {},
): Promise<MaskResult> {
  const profile = getMaskProfile(setName, opts.gameSetId);
  const existing = opts.cardId ? readOrientNote(opts.cardId) : null;
  if (!existing && !opts.skipOcr && !opts.words) opts.onStage?.("ocr");
  const upright = existing
    ? {
      buffer: await applyServedRotation(rawImageBuffer, existing.rotation),
      rotation: existing.rotation,
      landscapeDesign: existing.landscapeDesign,
      orientationAmbiguous: existing.coverBoth === true,
      words: null as null,
      ocrTimedOut: false,
      ocrMs: 0,
    }
    : await uprightCardImage(rawImageBuffer, {
      imageRotation: opts.imageRotation,
      playerName,
      profile,
      cardOrientation: opts.cardOrientation,
      skipOcr: Boolean(opts.skipOcr),
      recognize: recognizeWords,
      orientationBudgetMs: opts.orientationBudgetMs,
    });
  if (opts.cardId && !existing) {
    writeOrientNote(opts.cardId, {
      rotation: upright.rotation,
      landscapeDesign: upright.landscapeDesign,
      coverBoth: upright.orientationAmbiguous,
    });
  }

  const metadata = await sharp(upright.buffer).metadata();
  const originalWidth = metadata.width || 800;
  const originalHeight = metadata.height || 1000;

  let words: OcrWordBox[] = upright.words ?? [];
  let ocrTimedOut = upright.ocrTimedOut;
  let ocrMs = upright.ocrMs;
  const suppliedWords = upright.rotation === 0 ? opts.words : undefined;
  if (suppliedWords) {
    words = suppliedWords;
  } else if (!opts.skipOcr && upright.words == null && !ocrTimedOut) {
    opts.onStage?.("ocr");
    try {
      const ocr = await recognizeWords(upright.buffer, originalWidth);
      words = ocr.timedOut ? [] : ocr.words;
      ocrTimedOut = ocr.timedOut;
      ocrMs += ocr.ms;
    } catch (error) {
      console.error("[Masking] OCR processing failed:", error);
      words = [];
    }
  }

  opts.onStage?.("bake");
  let slabLayout = false;
  try {
    slabLayout = await detectPsaSlabLayout(upright.buffer);
  } catch {
    slabLayout = false;
  }

  let detectedPlate = null as Awaited<ReturnType<typeof detectAnchorPlate>>;
  let topTextPlate = null as Awaited<ReturnType<typeof detectAnchorTextPlate>>;
  let bottomTextPlate = null as Awaited<ReturnType<typeof detectAnchorTextPlate>>;
  // coverBoth already paints the profile band and its mirror. Measuring a plate
  // on a turn that was never resolved grows that band across the photo.
  if (!slabLayout && !upright.orientationAmbiguous) {
    try {
      if (profile.nameAnchor !== "both") {
        detectedPlate = await detectAnchorPlate(upright.buffer, profile.nameAnchor);
      }
      topTextPlate = await detectAnchorTextPlate(upright.buffer, "top");
      bottomTextPlate = await detectAnchorTextPlate(upright.buffer, "bottom");
    } catch {
      detectedPlate = null;
      topTextPlate = null;
      bottomTextPlate = null;
    }
  }

  const plan = resolveNameMaskPlan({
    playerName,
    setHint: setName,
    gameSetId: opts.gameSetId,
    words,
    imageWidth: originalWidth,
    imageHeight: originalHeight,
    slabLayout,
    plateBox: detectedPlate,
    topTextPlate,
    bottomTextPlate,
  });
  const regions = !upright.orientationAmbiguous
    ? plan.regions
    : upright.rotation === 0
      ? coverNameBandsForBothOrientations(plan.regions)
      : coverBothNameBands(plan.regions);

  const maskedBuffer = await applyPercentRegions(upright.buffer, regions);
  let coverage = await assertOpaqueIdentityCover({
    buffer: maskedBuffer,
    regions,
    layoutClass: plan.layoutClass,
    nameBoxes: plan.nameBoxes,
    imageWidth: originalWidth,
    imageHeight: originalHeight,
  });
  if (coverage.ok) {
    const text = await verifyMaskedNamePlate({
      buffer: maskedBuffer,
      plate: plan.plate ?? detectedPlate,
      layoutClass: plan.layoutClass,
      imageWidth: originalWidth,
      imageHeight: originalHeight,
    });
    if (!text.ok) coverage = text;
  }
  if (plan.namePlateUnresolved) {
    coverage = { ok: false, reason: "name_plate_unresolved" };
  }

  return {
    maskedBuffer,
    ocrApplied: plan.source === "ocr" || plan.source === "ocr+profile",
    ocrMatches: plan.matchedTokens,
    source: plan.source,
    regions,
    layoutClass: plan.layoutClass,
    coverageOk: coverage.ok,
    coverageReason: coverage.reason,
    servedRotation: upright.rotation,
    ocrTimedOut,
    ocrMs,
    landscapeDesign: upright.landscapeDesign,
    orientationAmbiguous: upright.orientationAmbiguous,
    layoutDisagreed: plan.layoutDisagreed,
    plateTrace: plan.plateTrace,
    sourceBuffer: upright.buffer,
  };
}

export { CURRENT_MASK_VERSION, applyPercentRegions };
