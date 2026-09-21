import sharp from "sharp";
import Tesseract from "tesseract.js";
import { CURRENT_MASK_VERSION } from "./maskProfiles";
import {
  resolveNameMaskPlan,
  type OcrWordBox,
} from "./nameLocalization";
import { detectPsaSlabLayout } from "./slabLayout";
import type { MaskRegion } from "@shared/schema";

const OCR_TIMEOUT_MS = 3500;
const OCR_DOWNSCALE_WIDTH = 700;

export interface MaskResult {
  maskedBuffer: Buffer;
  ocrApplied: boolean;
  ocrMatches: string[];
  source: "ocr+profile" | "profile" | "ocr" | "default";
  regions: MaskRegion[];
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

async function runOCRWords(
  imageBuffer: Buffer,
  originalWidth: number,
): Promise<OcrWordBox[]> {
  const scaledBuffer = await sharp(imageBuffer)
    .resize(OCR_DOWNSCALE_WIDTH)
    .grayscale()
    .normalize()
    .toBuffer();

  const scaledMeta = await sharp(scaledBuffer).metadata();
  const scaleFactor = originalWidth / (scaledMeta.width || OCR_DOWNSCALE_WIDTH);

  const worker = await Tesseract.createWorker("eng", 1, { logger: () => {} });
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    worker.terminate().catch(() => {});
  }, OCR_TIMEOUT_MS);

  let result: Awaited<ReturnType<typeof worker.recognize>> | null = null;
  try {
    result = await worker.recognize(scaledBuffer);
  } catch {
    // Worker terminated by timeout or failed
  } finally {
    clearTimeout(timeoutId);
    if (!timedOut) {
      await worker.terminate().catch(() => {});
    }
  }

  if (!result || timedOut) {
    if (timedOut) console.warn("[Masking] OCR timed out — worker terminated");
    return [];
  }

  const words = ((result.data as { words?: Array<{ text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number } }> }).words) || [];
  const boxes: OcrWordBox[] = [];
  for (const word of words) {
    const text = (word.text || "").trim();
    const bbox = word.bbox;
    if (!text || !bbox) continue;
    boxes.push({
      text,
      x: Math.round(bbox.x0 * scaleFactor),
      y: Math.round(bbox.y0 * scaleFactor),
      w: Math.round((bbox.x1 - bbox.x0) * scaleFactor),
      h: Math.round((bbox.y1 - bbox.y0) * scaleFactor),
    });
  }
  return boxes;
}

export async function maskCardImage(
  rawImageBuffer: Buffer,
  playerName: string,
  setName: string | null | undefined,
  opts: { skipOcr?: boolean; words?: OcrWordBox[] } = {},
): Promise<MaskResult> {
  const metadata = await sharp(rawImageBuffer).metadata();
  const originalWidth = metadata.width || 800;
  const originalHeight = metadata.height || 1000;

  let words: OcrWordBox[] = opts.words || [];
  if (!opts.skipOcr && !opts.words) {
    try {
      words = await runOCRWords(rawImageBuffer, originalWidth);
    } catch (error) {
      console.error("[Masking] OCR processing failed:", error);
      words = [];
    }
  }

  let slabLayout = false;
  try {
    slabLayout = await detectPsaSlabLayout(rawImageBuffer);
  } catch {
    slabLayout = false;
  }

  const plan = resolveNameMaskPlan({
    playerName,
    setHint: setName,
    words,
    imageWidth: originalWidth,
    imageHeight: originalHeight,
    slabLayout,
  });

  const maskedBuffer = await applyPercentRegions(rawImageBuffer, plan.regions);

  return {
    maskedBuffer,
    ocrApplied: plan.source === "ocr" || plan.source === "ocr+profile",
    ocrMatches: plan.matchedTokens,
    source: plan.source,
    regions: plan.regions,
  };
}

export { CURRENT_MASK_VERSION, applyPercentRegions };
