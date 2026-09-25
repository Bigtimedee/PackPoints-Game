/**
 * Client-only mini masked-card strip for the Game Complete share PNG.
 * Tiles use masked `/api/play/m/` URLs already on the client. The server
 * PNG keeps mode label, date, denominator, and footer. Strip, score, pts,
 * pips, and tagline share one centered block (`shared/scoreCardStack`).
 */

import { scoreCardFrame, SHARE_STRIP, type ShareStripBox } from "@shared/scoreCardStack";

const FIVE_CARD_FRAME = scoreCardFrame(5);

export const SCORE_SHARE_STRIP = {
  canvasSize: 1080,
  /** ~64px wide at 1080. Height keeps the 30×42 card ratio (64 × 42/30). */
  tileW: 64,
  tileH: 90,
  gap: 16,
  rowGap: 12,
  /** Top of a 5-card strip. Taller deals use `scoreCardFrame`. */
  y: FIVE_CARD_FRAME.stripY,
  sideInset: 80,
  /** One row stays this wide. Wider deals wrap instead of shrinking. */
  minTileW: 64,
  /** Narrower full-ratio card when 64px no longer fits on one row. */
  narrowTileW: 56,
  clearX: 60,
  /** Glow band for a 5-card strip: 4px pad around the thumbs, above the score. */
  clearY: FIVE_CARD_FRAME.stripY - 4,
  clearW: 960,
  clearH: FIVE_CARD_FRAME.stripHeight + 8,
  canvas: "#0b0f16",
  /** Same radial glow as `buildScoreCardSvg`: cx 85%, cy 12%, r 55%. */
  glowCx: 0.85,
  glowCy: 0.12,
  glowR: 0.55,
  glowInner: "rgba(30, 58, 95, 0.55)",
  glowOuter: "rgba(11, 15, 22, 0)",
  cream: "#F0F2F5",
  stroke: "#D6CBB6",
  plaqueFill: "#0A0E16",
  seam: "#977C17",
  bar: "#F5C518",
} as const;

const MASKED_PLAY_PATH = /^\/api\/play\/m\/(?:solo|d5|ad5|match)\/[^/?#]+\/\d{1,3}\/[^/?#]+$/;

export type StripTileBox = ShareStripBox;

export type StripTileImage = { width: number; height: number };

/** Same-origin masked play path, or null when the URL is not a masked tile. */
export function maskedTileSource(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/api/images/card")) return null;
  if (trimmed.includes("/api/play/r/")) return null;
  const start = trimmed.indexOf("/api/play/m/");
  if (start < 0) return null;
  const pathAndQuery = trimmed.slice(start).split("#")[0];
  const path = pathAndQuery.split("?")[0];
  if (!MASKED_PLAY_PATH.test(path)) return null;
  const query = pathAndQuery.includes("?") ? pathAndQuery.slice(pathAndQuery.indexOf("?")) : "";
  return `${path}${query}`;
}

/** Session order. Drops reveal, unmasked, and any other non-masked URL. */
export function sessionShareTileSources(urls: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const url of urls) {
    const src = maskedTileSource(url);
    if (src) out.push(src);
  }
  return out;
}

export { SCORE_CARD_STRIP_TO_DIGITS as SCORE_STRIP_CLEARANCE } from "@shared/scoreCardStack";

/** How many 64px tiles fit in one row at the current gap. */
export function scoreShareStripRowCapacity(): number {
  const maxW = SHARE_STRIP.canvas - SHARE_STRIP.sideInset * 2;
  const slot = SHARE_STRIP.tileW + SHARE_STRIP.gap;
  return Math.max(1, Math.floor((maxW + SHARE_STRIP.gap) / slot));
}

/**
 * One thumb per scored question, centered, equal gaps.
 * The row sits in the centered share block, 32px above the score digits.
 */
export function scoreShareStripLayout(count: number): StripTileBox[] {
  return scoreCardFrame(count).boxes;
}

/** Glow restore rect for this strip. It moves with the thumbs and stops above the score. */
export function scoreShareGlowBand(count: number): { x: number; y: number; w: number; h: number } {
  const frame = scoreCardFrame(Math.max(1, count));
  return {
    x: SCORE_SHARE_STRIP.clearX,
    y: frame.stripY - 4,
    w: SCORE_SHARE_STRIP.clearW,
    h: frame.stripHeight + 8,
  };
}

export type StripPainter = {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  closePath(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  stroke(): void;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
  fillStyle: string | CanvasGradient;
  strokeStyle: string;
  lineWidth: number;
};

type ScoreCardGlowContext = StripPainter & {
  rect(x: number, y: number, w: number, h: number): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient;
};

function asGlowContext(ctx: StripPainter): ScoreCardGlowContext | null {
  const candidate = ctx as StripPainter & {
    rect?: unknown;
    createRadialGradient?: unknown;
  };
  if (typeof candidate.rect !== "function" || typeof candidate.createRadialGradient !== "function") return null;
  return candidate as ScoreCardGlowContext;
}

/**
 * Repaints the strip band with the score-card canvas and radial glow so the
 * decorative Daily 5 tiles disappear without a flat dark bar.
 */
export function restoreScoreCardBand(
  ctx: ScoreCardGlowContext,
  band: { x: number; y: number; w: number; h: number } = {
    x: SCORE_SHARE_STRIP.clearX,
    y: SCORE_SHARE_STRIP.clearY,
    w: SCORE_SHARE_STRIP.clearW,
    h: SCORE_SHARE_STRIP.clearH,
  },
): void {
  const size = SCORE_SHARE_STRIP.canvasSize;
  ctx.save();
  ctx.beginPath();
  ctx.rect(band.x, band.y, band.w, band.h);
  ctx.clip();
  ctx.fillStyle = SCORE_SHARE_STRIP.canvas;
  ctx.fillRect(0, 0, size, size);
  const cx = size * SCORE_SHARE_STRIP.glowCx;
  const cy = size * SCORE_SHARE_STRIP.glowCy;
  const radius = size * SCORE_SHARE_STRIP.glowR;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  glow.addColorStop(0, SCORE_SHARE_STRIP.glowInner);
  glow.addColorStop(1, SCORE_SHARE_STRIP.glowOuter);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

function roundRect(ctx: StripPainter, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function imagePixelSize(image: StripTileImage): { width: number; height: number } {
  const sized = image as StripTileImage & { naturalWidth?: number; naturalHeight?: number };
  return {
    width: sized.naturalWidth || image.width,
    height: sized.naturalHeight || image.height,
  };
}

function drawCover(ctx: StripPainter, image: StripTileImage, x: number, y: number, w: number, h: number) {
  const { width: iw, height: ih } = imagePixelSize(image);
  if (!iw || !ih) {
    ctx.drawImage(image, x, y, w, h);
    return;
  }
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const sx = (dw - w) / 2 / scale;
  const sy = (dh - h) / 2 / scale;
  // Cover crop via a clipped full draw. Callers clip to the tile.
  ctx.drawImage(image, x - sx * scale, y - sy * scale, dw, dh);
}

function drawPlaqueTile(ctx: StripPainter, image: StripTileImage, box: StripTileBox) {
  const { x, y, w, h } = box;
  const radius = Math.max(2, Math.round(w / 8));
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.fillStyle = SCORE_SHARE_STRIP.cream;
  ctx.fillRect(x, y, w, h);
  drawCover(ctx, image, x, y, w, h);
  const plaqueH = Math.max(4, Math.round(h * (16 / 42)));
  const plaqueY = y + h - plaqueH;
  ctx.fillStyle = SCORE_SHARE_STRIP.plaqueFill;
  ctx.fillRect(x, plaqueY, w, plaqueH);
  ctx.fillStyle = SCORE_SHARE_STRIP.seam;
  ctx.fillRect(x, plaqueY, w, Math.max(1, h * (1.5 / 42)));
  const barW = Math.max(4, Math.round(w * (12 / 30)));
  const barH = Math.max(1, Math.round(h * (2 / 42)));
  const barX = x + Math.round((w - barW) / 2);
  const barY = plaqueY + Math.round(plaqueH * 0.42);
  ctx.fillStyle = SCORE_SHARE_STRIP.bar;
  ctx.fillRect(barX, barY, barW, barH);
  ctx.restore();
  ctx.strokeStyle = SCORE_SHARE_STRIP.stroke;
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
  ctx.stroke();
}

/** Plaque tiles only. Does not paint a background. */
export function drawScoreShareTiles(ctx: StripPainter, images: readonly StripTileImage[]): StripTileBox[] {
  const boxes = scoreShareStripLayout(images.length);
  images.forEach((image, i) => drawPlaqueTile(ctx, image, boxes[i]));
  return boxes;
}

/** Paints plaque tiles on the existing score card. Restores the glow under them when the context can. */
export function paintScoreShareStrip(ctx: StripPainter, images: readonly StripTileImage[]): StripTileBox[] {
  const glow = asGlowContext(ctx);
  if (glow && images.length > 0) restoreScoreCardBand(glow, scoreShareGlowBand(images.length));
  return drawScoreShareTiles(ctx, images);
}

/**
 * A 5-card game was painting 4 thumbs. `sessionShareTileSources` keeps every
 * valid `/api/play/m/` URL (including `?v=`). The missing thumb was a load
 * that returned null or threw — a cold mask 503, or `Image()` decoding a
 * non-bitmap — and this loop skipped it. One retry covers the bake race.
 * A second failure still omits that tile. A tainted bitmap still omits it
 * so `toBlob` can read the canvas.
 */
export async function tilesForScoreShare(
  urls: readonly (string | null | undefined)[],
  loadTile: (src: string) => Promise<StripTileImage | null>,
  taints: (image: StripTileImage) => boolean = () => false,
): Promise<StripTileImage[]> {
  const images: StripTileImage[] = [];
  for (const src of sessionShareTileSources(urls)) {
    let image: StripTileImage | null = null;
    for (let attempt = 0; attempt < 2 && !image; attempt++) {
      try {
        image = await loadTile(src);
      } catch {
        image = null;
      }
    }
    if (!image || taints(image)) continue;
    images.push(image);
  }
  return images;
}

type ShareCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): StripPainter | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string): void;
};

/**
 * Fetch the masked JPEG as a blob, then decode it. Same-origin `Image()`
 * drops the thumb when the response is a 503 JSON bake miss or the canvas
 * read throws. A blob bitmap is not cross-origin, so the taint check passes
 * for a real masked card.
 */
async function loadMaskedTile(src: string): Promise<StripTileImage | null> {
  if (typeof fetch !== "function") return loadHtmlImage(src);
  try {
    const res = await fetch(src, { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const type = (res.headers.get("content-type") || blob.type || "").toLowerCase();
    if (type && !type.startsWith("image/")) return null;
    if (blob.size === 0) return null;
    const image = await blobToImage(blob);
    if (!image) return null;
    const { width, height } = imagePixelSize(image);
    return width > 0 && height > 0 ? image : null;
  } catch {
    return null;
  }
}

function loadHtmlImage(src: string): Promise<StripTileImage | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function imageTaintsCanvas(image: StripTileImage): boolean {
  if (typeof document === "undefined") return false;
  try {
    const scratch = document.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    const ctx = scratch.getContext("2d");
    if (!ctx) return true;
    ctx.drawImage(image as CanvasImageSource, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return false;
  } catch {
    return true;
  }
}

async function blobToImage(blob: Blob): Promise<StripTileImage | null> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await loadHtmlImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: ShareCanvas): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}

/**
 * Draws masked thumbs onto a copy of the score PNG. Returns the original
 * blob when there is nothing to paint or the canvas cannot be read.
 */
export async function composeScoreSharePng(
  base: Blob,
  urls: readonly (string | null | undefined)[],
  deps?: {
    loadTile?: (src: string) => Promise<StripTileImage | null>;
    loadBase?: (blob: Blob) => Promise<StripTileImage | null>;
    createCanvas?: (w: number, h: number) => ShareCanvas;
    taints?: (image: StripTileImage) => boolean;
  },
): Promise<Blob> {
  const sources = sessionShareTileSources(urls);
  if (sources.length === 0) return base;
  const createCanvas = deps?.createCanvas
    ?? (typeof document !== "undefined"
      ? (w: number, h: number) => {
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          return canvas as unknown as ShareCanvas;
        }
      : null);
  if (!createCanvas) return base;

  const images = await tilesForScoreShare(
    sources,
    deps?.loadTile ?? loadMaskedTile,
    deps?.taints ?? imageTaintsCanvas,
  );
  if (images.length === 0) return base;

  const baseImage = await (deps?.loadBase ?? blobToImage)(base);
  if (!baseImage) return base;

  const canvas = createCanvas(SCORE_SHARE_STRIP.canvasSize, SCORE_SHARE_STRIP.canvasSize);
  const ctx = canvas.getContext("2d");
  if (!ctx) return base;
  ctx.drawImage(baseImage, 0, 0, SCORE_SHARE_STRIP.canvasSize, SCORE_SHARE_STRIP.canvasSize);
  paintScoreShareStrip(ctx, images);
  const blob = await canvasToBlob(canvas);
  return blob ?? base;
}
