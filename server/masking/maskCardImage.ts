import sharp from "sharp";
import { CURRENT_MASK_VERSION, getMaskProfile } from "./maskProfiles";
import {
  resolveNameMaskPlan,
  type OcrWordBox,
} from "./nameLocalization";
import { detectPsaSlabLayout } from "./slabLayout";
import { assertOpaqueIdentityCover } from "./maskCoverage";
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

/** Profile band first, then the same band flipped 180° so a wrong turn still hides the name. */
function coverBothNameBands(regions: MaskRegion[]): MaskRegion[] {
  const covered = regions.map((region) => ({ ...region }));
  for (const region of regions) {
    const mirror = clampRegion({
      ...region,
      yPct: 100 - (region.yPct + region.hPct),
    });
    if (mirror.wPct < 2 || mirror.hPct < 2) continue;
    const already = covered.some((existing) =>
      Math.abs(existing.xPct - mirror.xPct) < 0.5 &&
      Math.abs(existing.yPct - mirror.yPct) < 0.5 &&
      Math.abs(existing.wPct - mirror.wPct) < 0.5 &&
      Math.abs(existing.hPct - mirror.hPct) < 0.5
    );
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

  const plan = resolveNameMaskPlan({
    playerName,
    setHint: setName,
    gameSetId: opts.gameSetId,
    words,
    imageWidth: originalWidth,
    imageHeight: originalHeight,
    slabLayout,
  });
  const regions = upright.orientationAmbiguous ? coverBothNameBands(plan.regions) : plan.regions;

  const maskedBuffer = await applyPercentRegions(upright.buffer, regions);
  const coverage = await assertOpaqueIdentityCover({
    buffer: maskedBuffer,
    regions,
    layoutClass: plan.layoutClass,
    nameBoxes: plan.nameBoxes,
    imageWidth: originalWidth,
    imageHeight: originalHeight,
  });

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
  };
}

export { CURRENT_MASK_VERSION, applyPercentRegions };
