import sharp from "sharp";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";

const PLACEHOLDER_PATTERNS = [
  /silhouette/i,
  /placeholder/i,
  /default\.(jpg|png|gif|webp)/i,
  /example\.(jpg|png|gif|webp)/i,
  /no[_-]?image/i,
  /missing/i,
  /blank\.(jpg|png)/i,
];

const MIN_IMAGE_SIZE_BYTES = 8 * 1024;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_IMAGE_WIDTH = 200;
const MIN_IMAGE_HEIGHT = 200;
const DOWNLOAD_TIMEOUT_MS = 15000;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function isPlaceholderUrl(url: string): boolean {
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  return false;
}

export async function downloadImageToTemp(url: string): Promise<{ path: string; sizeBytes: number }> {
  const ext = path.extname(new URL(url).pathname) || ".jpg";
  const tmpPath = path.join(os.tmpdir(), `vf_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const timeout = setTimeout(() => {
      reject(new Error(`Image download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`));
    }, DOWNLOAD_TIMEOUT_MS);

    const req = protocol.get(url, { timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout);
        downloadImageToTemp(res.headers.location).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        clearTimeout(timeout);
        reject(new Error(`HTTP ${res.statusCode} downloading image`));
        return;
      }

      const file = fs.createWriteStream(tmpPath);
      let totalBytes = 0;

      res.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_IMAGE_SIZE_BYTES) {
          clearTimeout(timeout);
          file.destroy();
          fs.unlinkSync(tmpPath);
          reject(new Error(`Image too large (>${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB)`));
        }
      });

      res.pipe(file);

      file.on("finish", () => {
        clearTimeout(timeout);
        file.close(() => resolve({ path: tmpPath, sizeBytes: totalBytes }));
      });

      file.on("error", (err) => {
        clearTimeout(timeout);
        fs.unlinkSync(tmpPath);
        reject(err);
      });
    });

    req.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    req.on("timeout", () => {
      clearTimeout(timeout);
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

export async function verifyImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(imagePath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Cannot read image dimensions");
  }
  if (meta.width < MIN_IMAGE_WIDTH || meta.height < MIN_IMAGE_HEIGHT) {
    throw new Error(`Image too small: ${meta.width}x${meta.height} (min ${MIN_IMAGE_WIDTH}x${MIN_IMAGE_HEIGHT})`);
  }
  return { width: meta.width, height: meta.height };
}

export async function maskCardImage(
  inputPath: string,
  outputPath: string,
  options?: { topBandPercent?: number; bottomBandPercent?: number }
): Promise<string> {
  const topPct = options?.topBandPercent ?? 18;
  const bottomPct = options?.bottomBandPercent ?? 22;

  const meta = await sharp(inputPath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Cannot read image dimensions for masking");
  }

  const topBandHeight = Math.round(meta.height * (topPct / 100));
  const bottomBandHeight = Math.round(meta.height * (bottomPct / 100));

  const topOverlay = Buffer.from(
    `<svg width="${meta.width}" height="${topBandHeight}">
      <defs>
        <linearGradient id="topGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style="stop-color:black;stop-opacity:0.95"/>
          <stop offset="100%" style="stop-color:black;stop-opacity:0.7"/>
        </linearGradient>
      </defs>
      <rect width="${meta.width}" height="${topBandHeight}" fill="url(#topGrad)"/>
    </svg>`
  );

  const bottomOverlay = Buffer.from(
    `<svg width="${meta.width}" height="${bottomBandHeight}">
      <defs>
        <linearGradient id="botGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style="stop-color:black;stop-opacity:0.7"/>
          <stop offset="100%" style="stop-color:black;stop-opacity:0.95"/>
        </linearGradient>
      </defs>
      <rect width="${meta.width}" height="${bottomBandHeight}" fill="url(#botGrad)"/>
    </svg>`
  );

  await sharp(inputPath)
    .composite([
      { input: topOverlay, top: 0, left: 0 },
      { input: bottomOverlay, top: meta.height - bottomBandHeight, left: 0 },
    ])
    .toFile(outputPath);

  return outputPath;
}

export async function validateAndPrepareImage(
  imageUrl: string,
  outputDir: string
): Promise<{ maskedImagePath: string; originalPath: string; width: number; height: number }> {
  if (isPlaceholderUrl(imageUrl)) {
    throw new Error(`Rejected placeholder image URL: ${imageUrl}`);
  }

  const { path: downloadedPath, sizeBytes } = await downloadImageToTemp(imageUrl);

  try {
    if (sizeBytes < MIN_IMAGE_SIZE_BYTES) {
      throw new Error(`Image too small (${sizeBytes} bytes, min ${MIN_IMAGE_SIZE_BYTES} bytes) — likely a placeholder`);
    }

    const { width, height } = await verifyImageDimensions(downloadedPath);

    const maskedPath = path.join(outputDir, `maskedCard_${Date.now()}.png`);
    await maskCardImage(downloadedPath, maskedPath);

    return { maskedImagePath: maskedPath, originalPath: downloadedPath, width, height };
  } catch (err) {
    try { fs.unlinkSync(downloadedPath); } catch {}
    throw err;
  }
}
