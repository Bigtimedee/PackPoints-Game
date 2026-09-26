/**
 * Public set covers from mask-ready sidecars only.
 * Never bakes. The public list never returns a raw photo URL, a player name, or a card id.
 * A served JPEG sets X-Card-Id and X-Mask-Version.
 * The QA candidate list uses this same picker and includes the card id and player.
 */
import { createHash } from "crypto";
import { createReadStream, existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import type { Request, Response } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { CURRENT_MASK_VERSION, isMaskSetUuid } from "@shared/maskGeometry";
import { maskedSetCoverUrl, SET_COVER_SLOT_COUNT } from "@shared/setCoverUrl";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { setsCoversDisabled } from "../lib/setsCoversDisabled";
import { maskReadySidecarDir } from "../masking/maskReadySidecar";
import { warmMaskPlanFilename } from "../masking/maskPlanStore";
import { eligibleDealFilter } from "./playableSetEligibility";
import { isMaskBandExcluded } from "../masking/maskBandLimit";
import { resolveReadyWarmMaskedFile } from "../startup/warmMaskGate";

const READY_INDEX_TTL_MS = 30_000;
const READY_SQL_CAP = 8000;

let readyIndex: { dir: string; at: number; ids: Set<string> } | null = null;

/** Same player, ignoring case, punctuation, and jr/sr suffixes. Not sent on the wire. */
export function playerCoverIdentity(player: string | null | undefined): string {
  return (player || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function pickCoverSlots<T extends { id: string; player: string | null }>(
  rows: T[],
  limit = SET_COVER_SLOT_COUNT,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const identity = playerCoverIdentity(row.player);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** Per-slot validator. The card id is an input to the hash and is not the ETag text. */
export function setCoverEtag(setId: string, slot: number, cardId: string): string {
  const hash = createHash("sha256")
    .update(`${CURRENT_MASK_VERSION}|${setId}|${slot}|${cardId}`)
    .digest("hex");
  return `"${hash}"`;
}

export function clearReadyCoverIndexForTests(): void {
  readyIndex = null;
}

export function readyMaskedCardIds(dir = maskReadySidecarDir()): Set<string> {
  const now = Date.now();
  if (readyIndex && readyIndex.dir === dir && now - readyIndex.at < READY_INDEX_TTL_MS) {
    return readyIndex.ids;
  }
  const ids = new Set<string>();
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    names = [];
  }
  const suffix = `_${CURRENT_MASK_VERSION}.ok`;
  for (const name of names) {
    if (!name.endsWith(suffix)) continue;
    const cardId = name.slice(0, -suffix.length);
    if (!cardId || cardId.includes("..") || cardId.includes("/") || cardId.includes("\\")) continue;
    if (!resolveReadyWarmMaskedFile(dir, cardId)) continue;
    ids.add(cardId);
  }
  readyIndex = { dir, at: now, ids };
  return ids;
}

type CoverRow = {
  id: string;
  gameSetId: string;
  player: string | null;
  number: string | null;
  variant: string | null;
};

/** Deal-eligible, blocklist-clear, band-allowed cards that already have a baked mask. Cover order. */
async function eligibleCoverRows(setIds: string[]): Promise<Map<string, CoverRow[]>> {
  const out = new Map<string, CoverRow[]>();
  for (const id of setIds) out.set(id, []);
  if (setIds.length === 0) return out;

  const ready = readyMaskedCardIds();
  if (ready.size === 0) return out;

  const filters = [
    inArray(playableCards.gameSetId, setIds),
    eligibleDealFilter("playable_cards"),
    sql`LOWER(playable_cards.category) = LOWER(game_sets.sport)`,
  ];
  if (ready.size <= READY_SQL_CAP) {
    filters.push(inArray(playableCards.id, [...ready]));
  }

  const rows = await db
    .select({
      id: playableCards.id,
      gameSetId: playableCards.gameSetId,
      player: playableCards.player,
      number: playableCards.number,
      variant: playableCards.variant,
    })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(and(...filters))
    .orderBy(asc(playableCards.createdAt), asc(playableCards.id));

  for (const row of rows) {
    const list = out.get(row.gameSetId);
    if (!list || !ready.has(row.id)) continue;
    if (isMaskBandExcluded(row.id)) continue;
    list.push(row);
  }
  return out;
}

async function readyCoverCardIds(setIds: string[]): Promise<Map<string, string[]>> {
  const rows = await eligibleCoverRows(setIds);
  const out = new Map<string, string[]>();
  for (const [setId, list] of rows) {
    out.set(setId, pickCoverSlots(list).map((row) => row.id));
  }
  return out;
}

export interface CoverCandidate {
  slot: number;
  cardId: string;
  gameSetId: string;
  player: string | null;
  number: string | null;
  variant: string | null;
  maskVersion: string;
  bandPlacement: string | null;
  baked: boolean;
  imagePath: string;
}

/** layoutClass from the bake plan in the mask sidecar dir. Null when that file is absent. */
export function coverBandPlacement(cardId: string, dir = maskReadySidecarDir()): string | null {
  if (!cardId || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..")) return null;
  const filePath = path.join(dir, warmMaskPlanFilename(cardId));
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as { layoutClass?: unknown };
    const layout = raw.layoutClass;
    if (layout === "TOP_PLATE" || layout === "BOTTOM_PLAQUE" || layout === "PSA_SLAB") return layout;
    return null;
  } catch {
    return null;
  }
}

export function qaCoverImagePath(cardId: string): string {
  return `/api/qa/cover-image/${cardId}`;
}

/** Same picker as public covers, with a higher cap so spares follow slots 0-7. Ignores SETS_COVERS_DISABLED. */
export async function listCoverCandidates(setId: string, limit: number): Promise<CoverCandidate[]> {
  const rows = (await eligibleCoverRows([setId])).get(setId) ?? [];
  return pickCoverSlots(rows, limit).map((row, slot) => ({
    slot,
    cardId: row.id,
    gameSetId: row.gameSetId,
    player: row.player,
    number: row.number,
    variant: row.variant,
    maskVersion: CURRENT_MASK_VERSION,
    bandPlacement: coverBandPlacement(row.id),
    baked: true,
    imagePath: qaCoverImagePath(row.id),
  }));
}

/** Masked file for one card that passes the cover filters. Null never falls back to a raw scan. */
export async function eligibleCoverFile(cardId: string): Promise<string | null> {
  if (!cardId || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..") || cardId.includes("\0")) {
    return null;
  }
  if (!readyMaskedCardIds().has(cardId)) return null;
  if (isMaskBandExcluded(cardId)) return null;
  const [row] = await db
    .select({ id: playableCards.id })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(and(
      eq(playableCards.id, cardId),
      eligibleDealFilter("playable_cards"),
      sql`LOWER(playable_cards.category) = LOWER(game_sets.sport)`,
    ))
    .limit(1);
  if (!row) return null;
  return resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId);
}

/** Masked cover paths for sets that already have baked sidecars. Empty means the cream placeholder. */
export async function readyMaskedCoverUrls(setIds: string[]): Promise<Map<string, string[]>> {
  if (setsCoversDisabled()) {
    const hidden = new Map<string, string[]>();
    for (const setId of setIds) hidden.set(setId, []);
    return hidden;
  }
  const cards = await readyCoverCardIds(setIds);
  const urls = new Map<string, string[]>();
  for (const setId of setIds) {
    const ids = cards.get(setId) ?? [];
    urls.set(setId, ids.map((_, slot) => maskedSetCoverUrl(setId, slot)));
  }
  return urls;
}

function setCoverHeaders(res: Response, etag: string, cardId: string): void {
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  res.setHeader("ETag", etag);
  res.setHeader("X-Mask-Version", CURRENT_MASK_VERSION);
  res.setHeader("X-Card-Id", cardId);
  res.setHeader("X-Mask-Cache", "hit");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function coverNotReady(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.removeHeader("X-Card-Id");
  res.status(404).json({ error: "Cover not ready" });
}

/** 404 that a CDN or browser must not store. res.json would attach an ETag. */
function coverHidden(req: Request, res: Response): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.removeHeader("X-Card-Id");
  const body = JSON.stringify({ error: "Cover not ready" });
  res.status(404);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

/** Serves a baked masked JPEG. Does not bake. Sets X-Card-Id when the file is sent. */
export async function handlePublicSetCover(req: Request, res: Response): Promise<void> {
  if (setsCoversDisabled()) {
    coverHidden(req, res);
    return;
  }
  const setId = req.params.setId;
  const slot = Number(req.params.slot);
  if (!isMaskSetUuid(setId) || !Number.isInteger(slot) || slot < 0 || slot >= SET_COVER_SLOT_COUNT) {
    coverNotReady(res);
    return;
  }

  try {
    const cardId = (await readyCoverCardIds([setId])).get(setId)?.[slot];
    const file = cardId ? resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId) : null;
    if (!file || !cardId) {
      coverNotReady(res);
      return;
    }

    const etag = setCoverEtag(setId, slot, cardId);
    if (req.headers["if-none-match"] === etag) {
      setCoverHeaders(res, etag, cardId);
      res.status(304).end();
      return;
    }

    setCoverHeaders(res, etag, cardId);
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }

    const stream = createReadStream(file);
    stream.on("error", () => {
      if (!res.headersSent) coverNotReady(res);
      else res.destroy();
    });
    stream.pipe(res);
  } catch {
    console.error("[Sets] GET set cover error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to load cover" });
    }
  }
}
