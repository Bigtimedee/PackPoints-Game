/**
 * Partner kit frames. Feed and story composite the day's masked card under the
 * Design frame. Shop names are painted on that approved base. Nothing is drawn
 * on top of the card slot.
 */
import { createRequire } from "module";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import {
  KIT_COLORS,
  KIT_FEED,
  KIT_QRSHEET,
  KIT_RESULTS,
  KIT_STORY,
  shopLockup,
  type KitAssetKind,
} from "@shared/partnerKit";
import { loadDejaVuFonts, measureText, textToPath } from "../contentFactory/fonts";

type QrCore = {
  create: (text: string, opts: { errorCorrectionLevel: "M" }) => {
    modules: { size: number; get: (row: number, col: number) => number };
  };
};

let qrCore: QrCore | null = null;

/**
 * The production server is an esbuild CJS bundle. In that bundle import.meta
 * is {} and createRequire(import.meta.url) throws at load time, which killed
 * the process on the #342 deploy. Node sets __filename for that CJS file.
 * Vitest keeps a real import.meta.url, so use that only when it is a file URL.
 */
function modulePathForRequire(): string {
  if (typeof __filename === "string" && __filename.length > 0) return __filename;
  const meta = import.meta.url;
  if (typeof meta === "string" && meta.startsWith("file:")) return meta;
  return path.join(process.cwd(), "package.json");
}

function loadQrCore(): QrCore {
  if (qrCore) return qrCore;
  const req = createRequire(modulePathForRequire());
  qrCore = req("qrcode/lib/core/qrcode.js") as QrCore;
  return qrCore;
}

const FRAME_FILES: Record<KitAssetKind, string> = {
  feed: "feed-1080x1350-frame-none.png",
  story: "story-1080x1920-frame-none.png",
  results: "results-1080x1080-none.png",
  qrsheet: "qrsheet-letter-none.png",
};

const clearedFrames = new Map<string, Buffer>();

export function kitFrameFile(kind: KitAssetKind): string {
  return path.join(process.cwd(), "server", "assets", "share", "frames", FRAME_FILES[kind]);
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function renderQrPng(url: string, size: number): Promise<Buffer> {
  const raw = qrRaw(url);
  return sharp(raw.data, { raw: { width: raw.dim, height: raw.dim, channels: 3 } })
    .resize(size, size, { kernel: "nearest" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export function renderQrSvg(url: string): string {
  const qr = loadQrCore().create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = KIT_QRSHEET.quietModules;
  const dim = n + quiet * 2;
  const rects: string[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (qr.modules.get(y, x)) rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#ffffff"/><g fill="#000000">${rects.join("")}</g></svg>`;
}

export function qrModuleCount(url: string): { modules: number; withQuiet: number } {
  const n = loadQrCore().create(url, { errorCorrectionLevel: "M" }).modules.size;
  return { modules: n, withQuiet: n + KIT_QRSHEET.quietModules * 2 };
}

export async function renderPartnerKitAsset(input: {
  kind: KitAssetKind;
  slug: string;
  shopName: string | null;
  card: Buffer | null;
  qrUrl: string;
}): Promise<{ base: Buffer; bytes: Buffer }> {
  if (input.kind === "results") return renderResults(input.shopName);
  if (input.kind === "qrsheet") return renderQrSheet(input.qrUrl, input.shopName);
  if (!input.card) throw new Error("masked card required");
  const spec = input.kind === "feed" ? KIT_FEED : KIT_STORY;
  const base = await compositeCard(input.kind, input.card, spec);
  const bytes = input.shopName ? await paintBarLockup(base, spec.width, spec.height, spec.lockup, input.shopName) : base;
  return { base, bytes };
}

async function renderResults(shopName: string | null): Promise<{ base: Buffer; bytes: Buffer }> {
  const base = readFileSync(kitFrameFile("results"));
  const bytes = shopName ? await paintBarLockup(base, KIT_RESULTS.width, KIT_RESULTS.height, KIT_RESULTS.lockup, shopName) : base;
  return { base, bytes };
}

async function renderQrSheet(qrUrl: string, shopName: string | null): Promise<{ base: Buffer; bytes: Buffer }> {
  const frame = readFileSync(kitFrameFile("qrsheet"));
  const qr = await renderQrPng(qrUrl, KIT_QRSHEET.qr.size);
  const withQr = await sharp(frame)
    .composite([{ input: qr, left: KIT_QRSHEET.qr.x, top: KIT_QRSHEET.qr.y }])
    .withMetadata({ density: 300 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const bytes = shopName ? await paintQrHeadline(withQr, shopName) : withQr;
  return { base: withQr, bytes };
}

async function compositeCard(
  kind: "feed" | "story",
  card: Buffer,
  spec: { width: number; height: number; slot: { x: number; y: number; w: number; h: number } },
): Promise<Buffer> {
  const frame = await frameWithOpenSlot(kind, spec.slot);
  const fitted = await sharp(card)
    .rotate()
    .resize(spec.slot.w, spec.slot.h, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  return sharp({
    create: { width: spec.width, height: spec.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: fitted, left: spec.slot.x, top: spec.slot.y },
      { input: frame, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function frameWithOpenSlot(kind: "feed" | "story", slot: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  const file = kitFrameFile(kind);
  const cached = clearedFrames.get(file);
  if (cached) return cached;
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(data);
  const x1 = Math.max(0, slot.x);
  const y1 = Math.max(0, slot.y);
  const x2 = Math.min(info.width, slot.x + slot.w);
  const y2 = Math.min(info.height, slot.y + slot.h);
  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) {
      pixels[(y * info.width + x) * 4 + 3] = 0;
    }
  }
  const png = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  clearedFrames.set(file, png);
  return png;
}

async function paintBarLockup(
  base: Buffer,
  width: number,
  height: number,
  lockup: { y: number; h: number },
  shop: string,
): Promise<Buffer> {
  const font = loadDejaVuFonts().bold;
  const layout = shopLockup(shop, (text, size) => measureText(font, text, size), {
    startSize: Math.floor(lockup.h * 0.62),
    limit: width - 80,
  });
  const svg = lockupSvg(width, height, lockup.y, lockup.h, layout, KIT_COLORS.bar);
  return sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png({ compressionLevel: 9 }).toBuffer();
}

async function paintQrHeadline(base: Buffer, shop: string): Promise<Buffer> {
  const font = loadDejaVuFonts().bold;
  const layout = shopLockup(shop, (text, size) => measureText(font, text, size), {
    startSize: 170,
    wrap: true,
    wrapSize: 200,
    limit: KIT_QRSHEET.width - 160,
  });
  const band = layout.wrapped ? { y: 180, h: 480 } : { y: 300, h: 180 };
  const svg = lockupSvg(KIT_QRSHEET.width, KIT_QRSHEET.height, band.y, band.h, layout, KIT_COLORS.bg);
  return sharp(base)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .withMetadata({ density: 300 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function lockupSvg(
  width: number,
  height: number,
  y: number,
  h: number,
  layout: { wrapped: boolean; size: number; parts: Array<{ text: string; fill: "ink" | "gold" }> },
  plate: string,
): string {
  const font = loadDejaVuFonts().bold;
  const plateRect = `<rect x="0" y="${y}" width="${width}" height="${h}" fill="${plate}"/>`;
  if (!layout.wrapped) {
    const line = layout.parts.map((part) => part.text).join("");
    const total = measureText(font, line, layout.size);
    let x = (width - total) / 2;
    const baseline = y + h / 2 + layout.size * 0.35;
    const paths = layout.parts.map((part) => {
      const drawn = textToPath(font, part.text, x, baseline, layout.size, KIT_COLORS[part.fill]);
      x += measureText(font, part.text, layout.size);
      return drawn;
    });
    return svgDoc(width, height, plateRect + paths.join(""));
  }
  const gap = 30;
  const block = layout.size * 2 + gap;
  const firstBaseline = y + (h - block) / 2 + layout.size * 0.8;
  const paths = layout.parts.map((part, index) => {
    const baseline = firstBaseline + index * (layout.size + gap);
    const textWidth = measureText(font, part.text, layout.size);
    return textToPath(font, part.text, (width - textWidth) / 2, baseline, layout.size, KIT_COLORS[part.fill]);
  });
  return svgDoc(width, height, plateRect + paths.join(""));
}

function svgDoc(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function qrRaw(url: string): { data: Buffer; dim: number } {
  const qr = loadQrCore().create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = KIT_QRSHEET.quietModules;
  const dim = n + quiet * 2;
  const data = Buffer.alloc(dim * dim * 3, 255);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (!qr.modules.get(y, x)) continue;
      const pixel = ((y + quiet) * dim + (x + quiet)) * 3;
      data[pixel] = 0;
      data[pixel + 1] = 0;
      data[pixel + 2] = 0;
    }
  }
  return { data, dim };
}
