/**
 * Image Content Analyzer
 * Detects placeholder/silhouette images by analyzing actual image content
 * Uses sharp for image processing to identify:
 * - Low color diversity (silhouettes are often single-color)
 * - Low entropy/complexity (real cards have text, details, patterns)
 * - Common placeholder dimensions
 */

import sharp from "sharp";

export interface ImageAnalysisResult {
  isPlaceholder: boolean;
  confidence: number;
  reasons: string[];
  stats?: {
    width: number;
    height: number;
    channels: number;
    uniqueColors: number;
    entropy: number;
    dominantColorPercent: number;
  };
}

const FETCH_TIMEOUT_MS = 10000;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB max

const analysisCache = new Map<string, { result: ImageAnalysisResult; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedResult(url: string): ImageAnalysisResult | null {
  const cached = analysisCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  analysisCache.delete(url);
  return null;
}

function cacheResult(url: string, result: ImageAnalysisResult): void {
  if (analysisCache.size > 1000) {
    const firstKey = analysisCache.keys().next().value;
    if (firstKey) analysisCache.delete(firstKey);
  }
  analysisCache.set(url, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "PackPoints-ImageAnalyzer/1.0" }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log(`[ImageAnalyzer] Failed to fetch ${url}: HTTP ${response.status}`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      console.log(`[ImageAnalyzer] Invalid content type for ${url}: ${contentType}`);
      return null;
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_IMAGE_SIZE) {
      console.log(`[ImageAnalyzer] Image too large: ${contentLength} bytes`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error: any) {
    console.log(`[ImageAnalyzer] Error fetching ${url}: ${error.message}`);
    return null;
  }
}

function calculateEntropy(histogram: number[]): number {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;

  let entropy = 0;
  for (const count of histogram) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

async function analyzeImageBuffer(buffer: Buffer): Promise<{
  width: number;
  height: number;
  channels: number;
  uniqueColors: number;
  entropy: number;
  dominantColorPercent: number;
  hasDetailedEdges: boolean;
  silhouetteScore: number;
  warmBackgroundPercent: number;
  darkPixelPercent: number;
  coolGradientPercent: number;
}> {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const channels = metadata.channels || 3;

  const resized = await image
    .resize(100, 100, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data } = resized;
  const pixelCount = data.length / channels;

  const colorMap = new Map<string, number>();
  const histogram = new Array(256).fill(0);
  
  let warmPixels = 0;
  let darkPixels = 0;
  let orangeTanPixels = 0;
  let purplePixels = 0;
  let bluePixels = 0;
  let coolGradientPixels = 0;

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1] || 0;
    const b = data[i + 2] || 0;
    
    const colorKey = `${Math.floor(r / 16)}-${Math.floor(g / 16)}-${Math.floor(b / 16)}`;
    colorMap.set(colorKey, (colorMap.get(colorKey) || 0) + 1);
    
    const gray = Math.floor((r * 0.299 + g * 0.587 + b * 0.114));
    histogram[gray]++;
    
    if (r > 150 && g > 80 && g < 180 && b < 100) {
      warmPixels++;
      if (r > 180 && g > 100 && g < 160 && b < 80) {
        orangeTanPixels++;
      }
    }
    
    if (r < 60 && g < 60 && b < 60) {
      darkPixels++;
    }
    
    // Purple detection: high red, high blue, low-medium green
    if (r > 80 && b > 120 && g < 100 && b > g) {
      purplePixels++;
    }
    
    // Blue detection: high blue, low red
    if (b > 150 && r < 120 && g < 180) {
      bluePixels++;
    }
    
    // Cool gradient pixels: purple-blue spectrum (like basketball silhouettes)
    if ((r > 60 && b > 100 && b > r * 0.8 && g < Math.max(r, b)) || 
        (b > 120 && r > 50 && g < 120)) {
      coolGradientPixels++;
    }
  }

  const uniqueColors = colorMap.size;
  const entropy = calculateEntropy(histogram);

  let maxColorCount = 0;
  colorMap.forEach((count) => {
    if (count > maxColorCount) maxColorCount = count;
  });
  const dominantColorPercent = (maxColorCount / pixelCount) * 100;

  const edgeBuffer = await sharp(buffer)
    .resize(100, 100, { fit: "inside" })
    .greyscale()
    .convolve({
      width: 3,
      height: 3,
      kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1]
    })
    .raw()
    .toBuffer();

  let edgeSum = 0;
  for (let i = 0; i < edgeBuffer.length; i++) {
    edgeSum += edgeBuffer[i];
  }
  const avgEdgeValue = edgeSum / edgeBuffer.length;
  const hasDetailedEdges = avgEdgeValue > 15;

  const warmBackgroundPercent = (warmPixels / pixelCount) * 100;
  const darkPixelPercent = (darkPixels / pixelCount) * 100;
  const orangeTanPercent = (orangeTanPixels / pixelCount) * 100;
  const purplePercent = (purplePixels / pixelCount) * 100;
  const bluePercent = (bluePixels / pixelCount) * 100;
  const coolGradientPercent = (coolGradientPixels / pixelCount) * 100;
  
  let silhouetteScore = 0;
  // Silhouette detection requires MULTIPLE conditions to avoid false positives
  // Real cards have high color diversity and detailed edges
  const hasLowColorDiversity = uniqueColors < 100;
  const hasVeryLowColorDiversity = uniqueColors < 60;
  const hasWarmBackground = warmBackgroundPercent > 35 || orangeTanPercent > 25;
  const hasCoolBackground = coolGradientPercent > 30 || purplePercent > 20 || bluePercent > 25;
  const hasDarkSilhouetteShape = darkPixelPercent > 10 && darkPixelPercent < 50;
  const lacksDetailedEdges = !hasDetailedEdges;
  
  // === WARM COLOR SILHOUETTES (orange/tan backgrounds) ===
  // Strong signal: warm background + dark shape + low colors + no edges
  if (hasWarmBackground && hasDarkSilhouetteShape && hasLowColorDiversity && lacksDetailedEdges) {
    silhouetteScore += 50; // High confidence silhouette
  }
  // Medium signal: orange/tan specifically + dark shape + low colors
  else if (orangeTanPercent > 30 && darkPixelPercent > 15 && uniqueColors < 80) {
    silhouetteScore += 35;
  }
  // Weak signal: just warm background with dark pixels (but not enough on its own)
  else if (warmBackgroundPercent > 50 && darkPixelPercent > 20 && uniqueColors < 60) {
    silhouetteScore += 25;
  }
  
  // === COOL COLOR SILHOUETTES (purple/blue gradient backgrounds) ===
  // Strong signal: cool gradient + dark shape + low colors + no edges
  if (hasCoolBackground && hasDarkSilhouetteShape && hasLowColorDiversity && lacksDetailedEdges) {
    silhouetteScore += 50; // High confidence purple/blue silhouette
  }
  // Medium signal: significant purple or blue + dark shape + very low colors
  else if ((purplePercent > 15 || bluePercent > 20) && darkPixelPercent > 10 && hasVeryLowColorDiversity) {
    silhouetteScore += 40;
  }
  // Cool gradient with silhouette shape
  else if (coolGradientPercent > 40 && darkPixelPercent > 15 && uniqueColors < 80) {
    silhouetteScore += 35;
  }

  return {
    width,
    height,
    channels,
    uniqueColors,
    entropy,
    dominantColorPercent,
    hasDetailedEdges,
    silhouetteScore,
    warmBackgroundPercent,
    darkPixelPercent,
    coolGradientPercent
  };
}

export async function analyzeImageContent(url: string): Promise<ImageAnalysisResult> {
  const cached = getCachedResult(url);
  if (cached) {
    return cached;
  }

  try {
    const buffer = await fetchImageBuffer(url);
    if (!buffer) {
      const result: ImageAnalysisResult = {
        isPlaceholder: true,
        confidence: 100,
        reasons: ["Failed to fetch image"]
      };
      cacheResult(url, result);
      return result;
    }

    const stats = await analyzeImageBuffer(buffer);
    const reasons: string[] = [];
    let placeholderScore = 0;

    if (stats.uniqueColors < 50) {
      reasons.push(`Very low color diversity (${stats.uniqueColors} unique color clusters)`);
      placeholderScore += 40;
    } else if (stats.uniqueColors < 100) {
      reasons.push(`Low color diversity (${stats.uniqueColors} unique color clusters)`);
      placeholderScore += 20;
    }

    if (stats.entropy < 4.0) {
      reasons.push(`Very low image complexity (entropy: ${stats.entropy.toFixed(2)})`);
      placeholderScore += 40;
    } else if (stats.entropy < 5.5) {
      reasons.push(`Low image complexity (entropy: ${stats.entropy.toFixed(2)})`);
      placeholderScore += 15;
    }

    if (stats.dominantColorPercent > 60) {
      reasons.push(`Dominant color covers ${stats.dominantColorPercent.toFixed(1)}% of image`);
      placeholderScore += 30;
    } else if (stats.dominantColorPercent > 40) {
      reasons.push(`High dominant color presence (${stats.dominantColorPercent.toFixed(1)}%)`);
      placeholderScore += 15;
    }

    if (!stats.hasDetailedEdges) {
      reasons.push("Lacks detailed edges/text typical of real cards");
      placeholderScore += 25;
    }

    if (stats.silhouetteScore >= 40) {
      reasons.push(`Sport silhouette pattern detected (warm=${stats.warmBackgroundPercent.toFixed(1)}%, cool=${stats.coolGradientPercent.toFixed(1)}%, dark=${stats.darkPixelPercent.toFixed(1)}%)`);
      placeholderScore += stats.silhouetteScore;
    } else if (stats.silhouetteScore >= 20) {
      reasons.push(`Possible silhouette pattern (warm=${stats.warmBackgroundPercent.toFixed(1)}%, cool=${stats.coolGradientPercent.toFixed(1)}%, dark=${stats.darkPixelPercent.toFixed(1)}%)`);
      placeholderScore += stats.silhouetteScore;
    }

    const knownPlaceholderDimensions = [
      [300, 400], [200, 300], [150, 200], [100, 150],
      [400, 300], [300, 200]
    ];
    for (const [w, h] of knownPlaceholderDimensions) {
      if (stats.width === w && stats.height === h) {
        reasons.push(`Matches common placeholder dimensions (${w}x${h})`);
        placeholderScore += 15;
        break;
      }
    }

    const isPlaceholder = placeholderScore >= 50;
    const confidence = Math.min(placeholderScore, 100);

    const result: ImageAnalysisResult = {
      isPlaceholder,
      confidence,
      reasons: reasons.length > 0 ? reasons : ["Image appears to be authentic"],
      stats: {
        width: stats.width,
        height: stats.height,
        channels: stats.channels,
        uniqueColors: stats.uniqueColors,
        entropy: stats.entropy,
        dominantColorPercent: stats.dominantColorPercent
      }
    };

    cacheResult(url, result);
    console.log(`[ImageAnalyzer] ${url.slice(-50)}: placeholder=${isPlaceholder}, confidence=${confidence}%, reasons=${reasons.join("; ")}`);
    
    return result;
  } catch (error: any) {
    console.error(`[ImageAnalyzer] Error analyzing ${url}:`, error.message);
    const result: ImageAnalysisResult = {
      isPlaceholder: true,
      confidence: 50,
      reasons: [`Analysis error: ${error.message}`]
    };
    cacheResult(url, result);
    return result;
  }
}

export async function batchAnalyzeImages(urls: string[]): Promise<Map<string, ImageAnalysisResult>> {
  const results = new Map<string, ImageAnalysisResult>();
  
  for (const url of urls) {
    const result = await analyzeImageContent(url);
    results.set(url, result);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
}

export function isLikelyPlaceholderByContent(result: ImageAnalysisResult): boolean {
  return result.isPlaceholder && result.confidence >= 50;
}
