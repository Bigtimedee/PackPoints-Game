import sharp from "sharp";
import Tesseract from "tesseract.js";
import { getMaskProfile, CURRENT_MASK_VERSION } from "./maskProfiles";

const OCR_TIMEOUT_MS = 2500;
const OCR_DOWNSCALE_WIDTH = 700;

interface MaskResult {
  maskedBuffer: Buffer;
  ocrApplied: boolean;
  ocrMatches: string[];
}

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function fuzzyMatch(detected: string, target: string): boolean {
  if (detected === target) return true;
  if (detected.length < 2 || target.length < 2) return false;
  
  const normalizedDetected = detected
    .replace(/1/g, "i")
    .replace(/0/g, "o")
    .replace(/5/g, "s");
  
  if (normalizedDetected === target) return true;
  
  if (Math.abs(detected.length - target.length) > 1) return false;
  
  let distance = 0;
  const maxLen = Math.max(detected.length, target.length);
  for (let i = 0; i < maxLen; i++) {
    if (detected[i] !== target[i]) distance++;
    if (distance > 1) return false;
  }
  return distance <= 1;
}

async function applyTemplateMasks(
  imageBuffer: Buffer,
  setName: string | null | undefined
): Promise<Buffer> {
  const profile = getMaskProfile(setName);
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 1000;

  const overlays: sharp.OverlayOptions[] = [];

  if (profile.topBandPct > 0) {
    const topHeight = Math.round(height * profile.topBandPct);
    const topOverlay = await sharp({
      create: {
        width,
        height: topHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.15 },
      },
    })
      .blur(profile.blurSigma || 10)
      .png()
      .toBuffer();

    overlays.push({ input: topOverlay, top: 0, left: 0 });
  }

  if (profile.bottomBandPct > 0) {
    const bottomHeight = Math.round(height * profile.bottomBandPct);
    const bottomTop = height - bottomHeight;
    const bottomOverlay = await sharp({
      create: {
        width,
        height: bottomHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.15 },
      },
    })
      .blur(profile.blurSigma || 10)
      .png()
      .toBuffer();

    overlays.push({ input: bottomOverlay, top: bottomTop, left: 0 });
  }

  if (profile.leftBandPct > 0) {
    const leftWidth = Math.round(width * profile.leftBandPct);
    const leftOverlay = await sharp({
      create: {
        width: leftWidth,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.15 },
      },
    })
      .blur(profile.blurSigma || 10)
      .png()
      .toBuffer();

    overlays.push({ input: leftOverlay, top: 0, left: 0 });
  }

  if (profile.rightBandPct > 0) {
    const rightWidth = Math.round(width * profile.rightBandPct);
    const rightLeft = width - rightWidth;
    const rightOverlay = await sharp({
      create: {
        width: rightWidth,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.15 },
      },
    })
      .blur(profile.blurSigma || 10)
      .png()
      .toBuffer();

    overlays.push({ input: rightOverlay, top: 0, left: rightLeft });
  }

  if (overlays.length === 0) {
    return imageBuffer;
  }

  return sharp(imageBuffer).composite(overlays).jpeg({ quality: 85 }).toBuffer();
}

async function runOCRWithTimeout(
  imageBuffer: Buffer,
  playerName: string,
  originalWidth: number,
  originalHeight: number
): Promise<{ matches: Array<{ x: number; y: number; w: number; h: number }>; tokens: string[] }> {
  const tokens = tokenize(playerName);
  if (tokens.length === 0) {
    return { matches: [], tokens: [] };
  }

  const scaledBuffer = await sharp(imageBuffer)
    .resize(OCR_DOWNSCALE_WIDTH)
    .grayscale()
    .normalize()
    .toBuffer();

  const scaledMeta = await sharp(scaledBuffer).metadata();
  const scaleFactor = originalWidth / (scaledMeta.width || OCR_DOWNSCALE_WIDTH);

  // Use an explicit worker so we can terminate it if the timeout fires,
  // preventing leaked background threads from abandoned OCR jobs.
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
    // Worker was terminated by timeout or failed
  } finally {
    clearTimeout(timeoutId);
    if (!timedOut) {
      await worker.terminate().catch(() => {});
    }
  }

  if (!result || timedOut) {
    if (timedOut) console.warn("[Masking] OCR timed out — worker terminated");
    return { matches: [], tokens: [] };
  }

  const matches: Array<{ x: number; y: number; w: number; h: number }> = [];
  const matchedTokens: string[] = [];

  const words = (result.data as any).words || [];
  for (const word of words) {
    const detectedText = word.text.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    for (const token of tokens) {
      if (fuzzyMatch(detectedText, token)) {
        const bbox = word.bbox;
        const padding = 15;
        
        matches.push({
          x: Math.max(0, Math.round((bbox.x0 - padding) * scaleFactor)),
          y: Math.max(0, Math.round((bbox.y0 - padding) * scaleFactor)),
          w: Math.round((bbox.x1 - bbox.x0 + padding * 2) * scaleFactor),
          h: Math.round((bbox.y1 - bbox.y0 + padding * 2) * scaleFactor),
        });
        
        if (!matchedTokens.includes(token)) {
          matchedTokens.push(token);
        }
        break;
      }
    }
  }

  return { matches, tokens: matchedTokens };
}

async function applyOCRMasks(
  imageBuffer: Buffer,
  regions: Array<{ x: number; y: number; w: number; h: number }>
): Promise<Buffer> {
  if (regions.length === 0) {
    return imageBuffer;
  }

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 1000;

  const overlays: sharp.OverlayOptions[] = [];

  for (const region of regions) {
    const safeW = Math.min(region.w, width - region.x);
    const safeH = Math.min(region.h, height - region.y);
    
    if (safeW <= 0 || safeH <= 0) continue;

    const overlay = await sharp({
      create: {
        width: safeW,
        height: safeH,
        channels: 4,
        background: { r: 40, g: 40, b: 40, alpha: 0.95 },
      },
    })
      .blur(8)
      .png()
      .toBuffer();

    overlays.push({ input: overlay, top: region.y, left: region.x });
  }

  if (overlays.length === 0) {
    return imageBuffer;
  }

  return sharp(imageBuffer).composite(overlays).jpeg({ quality: 85 }).toBuffer();
}

export async function maskCardImage(
  rawImageBuffer: Buffer,
  playerName: string,
  setName: string | null | undefined
): Promise<MaskResult> {
  const templateMasked = await applyTemplateMasks(rawImageBuffer, setName);

  const metadata = await sharp(rawImageBuffer).metadata();
  const originalWidth = metadata.width || 800;
  const originalHeight = metadata.height || 1000;

  let ocrApplied = false;
  let ocrMatches: string[] = [];
  let finalBuffer = templateMasked;

  try {
    const { matches, tokens } = await runOCRWithTimeout(
      rawImageBuffer,
      playerName,
      originalWidth,
      originalHeight
    );

    if (matches.length > 0) {
      finalBuffer = await applyOCRMasks(templateMasked, matches);
      ocrApplied = true;
      ocrMatches = tokens;
    }
  } catch (error) {
    console.error("[Masking] OCR processing failed:", error);
  }

  return {
    maskedBuffer: finalBuffer,
    ocrApplied,
    ocrMatches,
  };
}

export { CURRENT_MASK_VERSION };
