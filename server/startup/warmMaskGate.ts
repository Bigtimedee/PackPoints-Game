import { createReadStream, existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import type { Request, Response } from "express";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { isPlayScope, maskTokenMatches } from "../services/playImageToken";
import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";
import { isMaskBandOversized } from "../masking/maskBandLimit";

const VERSION = CURRENT_MASK_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WARM_JPEG = new RegExp(`^(.+)_${VERSION}(?:_r(?:90|180|270))?\\.jpg$`);

let dirOverride: string | null = null;
const cardIdsByDir = new Map<string, string[]>();

export function setWarmMaskDirForTests(dir: string | null): void {
  dirOverride = dir;
  cardIdsByDir.clear();
}

export function cardIdFromWarmJpeg(filename: string): string | null {
  const id = filename.match(WARM_JPEG)?.[1];
  if (!id || id.includes("/") || id.includes("..")) return null;
  return id;
}

/** Written by a successful bake. Warm serve during the schema window requires it. */
export function warmOkMarkerFilename(cardId: string): string {
  return `${cardId}_${CURRENT_MASK_VERSION}.ok`;
}

function warmFilename(cardId: string, rotation: number): string {
  if (rotation === 90 || rotation === 180 || rotation === 270) {
    return `${cardId}_${CURRENT_MASK_VERSION}_r${rotation}.jpg`;
  }
  return `${cardId}_${CURRENT_MASK_VERSION}.jpg`;
}

function noteRotation(dir: string, cardId: string): number | null {
  const file = path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.orient.json`);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { rotation?: unknown };
    const n = Number(raw.rotation);
    return n === 90 || n === 180 || n === 270 ? n : 0;
  } catch {
    return null;
  }
}

function warmFile(dir: string, cardId: string): string | null {
  const note = noteRotation(dir, cardId);
  const order = note == null ? [90, 180, 270, 0] : [note];
  for (const rotation of order) {
    const full = path.join(dir, warmFilename(cardId, rotation));
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * Cached masked JPEG for a card that already has a mask-ready sidecar.
 * Missing marker or missing JPEG returns null. This does not bake.
 */
export function resolveReadyWarmMaskedFile(dir: string, cardId: string): string | null {
  if (!cardId || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..") || cardId.includes("\0")) {
    return null;
  }
  if (isMaskBandOversized(cardId, dir)) return null;
  if (!existsSync(path.join(dir, warmOkMarkerFilename(cardId)))) return null;
  return warmFile(dir, cardId);
}

function cardIds(dir: string): string[] {
  const cached = cardIdsByDir.get(dir);
  if (cached) return cached;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    cardIdsByDir.set(dir, []);
    return [];
  }
  const ids = [...new Set(names.map(cardIdFromWarmJpeg).filter((id): id is string => id != null))];
  cardIdsByDir.set(dir, ids);
  return ids;
}

export function parseMaskedPlayPath(urlPath: string): {
  scope: string;
  sessionId: string;
  index: number;
  token: string;
} | null {
  const match = urlPath.match(/^\/api\/play\/m\/([^/]+)\/([^/]+)\/(\d{1,3})\/([^/]+)$/);
  if (!match) return null;
  const index = Number(match[3]);
  if (!Number.isInteger(index) || index < 0 || index > 200) return null;
  return {
    scope: decodeURIComponent(match[1]),
    sessionId: decodeURIComponent(match[2]),
    index,
    token: decodeURIComponent(match[4]),
  };
}

/**
 * HMAC match against a warm JPEG that a successful bake marked ok.
 * Landscape and quarantine live in Postgres, so a file with no sidecar stays closed.
 */
export function findWarmMaskedPath(args: {
  dir: string;
  scope: string;
  sessionId: string;
  index: number;
  token: string;
}): string | null {
  if (!isPlayScope(args.scope)) return null;
  for (const cardId of cardIds(args.dir)) {
    if (!maskTokenMatches(args.scope, args.sessionId, args.index, cardId, args.token)) continue;
    if (isMaskBandOversized(cardId, args.dir)) return null;
    if (!existsSync(path.join(args.dir, warmOkMarkerFilename(cardId)))) return null;
    return warmFile(args.dir, cardId);
  }
  return null;
}

export function tryServeWarmMasked(req: Request, res: Response): boolean {
  const parsed = parseMaskedPlayPath(req.path);
  if (!parsed) return false;
  const file = findWarmMaskedPath({ dir: dirOverride ?? MASKED_CARDS_DIR, ...parsed });
  if (!file) return false;
  const etag = `"${CURRENT_MASK_VERSION}"`;
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  res.setHeader("ETag", etag);
  res.setHeader("X-Mask-Version", CURRENT_MASK_VERSION);
  res.setHeader("X-Mask-Cache", "hit");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "HEAD" || req.headers["if-none-match"] === etag) {
    res.status(req.headers["if-none-match"] === etag ? 304 : 200).end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}
