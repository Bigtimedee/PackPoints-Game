/**
 * Client-only mini masked-card strip for the Game Complete share PNG.
 * Tiles use masked `/api/play/m/` URLs already on the client. The server
 * PNG keeps mode label, date, denominator, and footer.
 */

export const SCORE_SHARE_STRIP = {
  canvasSize: 1080,
  tileW: 30,
  tileH: 42,
  gap: 8,
  y: 136,
  sideInset: 80,
  clearX: 60,
  clearY: 124,
  clearW: 960,
  clearH: 62,
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

export type StripTileBox = { x: number; y: number; w: number; h: number };

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

export function scoreShareStripLayout(count: number): StripTileBox[] {
  if (count <= 0) return [];
  const maxW = SCORE_SHARE_STRIP.canvasSize - SCORE_SHARE_STRIP.sideInset * 2;
  let tileW: number = SCORE_SHARE_STRIP.tileW;
  let tileH: number = SCORE_SHARE_STRIP.tileH;
  let gap: number = SCORE_SHARE_STRIP.gap;
  let rowW = count * tileW + (count - 1) * gap;
  if (rowW > maxW) {
    const scale = maxW / rowW;
    tileW = Math.max(8, Math.floor(tileW * scale));
    tileH = Math.max(12, Math.floor(tileH * scale));
    gap = Math.max(2, Math.floor(gap * scale));
    rowW = count * tileW + (count - 1) * gap;
  }
  const x0 = Math.round((SCORE_SHARE_STRIP.canvasSize - rowW) / 2);
  return Array.from({ length: count }, (_, i) => ({
    x: x0 + i * (tileW + gap),
    y: SCORE_SHARE_STRIP.y,
    w: tileW,
    h: tileH,
  }));
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
export function restoreScoreCardBand(ctx: ScoreCardGlowContext): void {
  const size = SCORE_SHARE_STRIP.canvasSize;
  ctx.save();
  ctx.beginPath();
  ctx.rect(SCORE_SHARE_STRIP.clearX, SCORE_SHARE_STRIP.clearY, SCORE_SHARE_STRIP.clearW, SCORE_SHARE_STRIP.clearH);
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
  if (glow) restoreScoreCardBand(glow);
  return drawScoreShareTiles(ctx, images);
}

export async function tilesForScoreShare(
  urls: readonly (string | null | undefined)[],
  loadTile: (src: string) => Promise<StripTileImage | null>,
  taints: (image: StripTileImage) => boolean = () => false,
): Promise<StripTileImage[]> {
  const images: StripTileImage[] = [];
  for (const src of sessionShareTileSources(urls)) {
    try {
      const image = await loadTile(src);
      if (!image || taints(image)) continue;
      images.push(image);
    } catch {
      // Omit a tile that fails to load.
    }
  }
  return images;
}

type ShareCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): StripPainter | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string): void;
};

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
    deps?.loadTile ?? loadHtmlImage,
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
