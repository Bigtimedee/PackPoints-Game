/**
 * Public set covers from mask-ready sidecars only.
 * Never bakes, and never returns a raw photo URL, a player name, or a card id.
 */
import { createReadStream, readdirSync } from "fs";
import type { Request, Response } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { CURRENT_MASK_VERSION, isMaskSetUuid } from "@shared/maskGeometry";
import { maskedSetCoverUrl, SET_COVER_SLOT_COUNT } from "@shared/setCoverUrl";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { maskReadySidecarDir } from "../masking/maskReadySidecar";
import { eligibleDealFilter } from "./playableSetEligibility";
import { resolveReadyWarmMaskedFile } from "../startup/warmMaskGate";

const READY_INDEX_TTL_MS = 30_000;
const READY_SQL_CAP = 8000;

let readyIndex: { dir: string; at: number; ids: Set<string> } | null = null;

export function clearReadyCoverIndexForTests(): void {
  readyIndex = null;
}

function readyCardIds(dir = maskReadySidecarDir()): Set<string> {
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

async function readyCoverCardIds(setIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const id of setIds) out.set(id, []);
  if (setIds.length === 0) return out;

  const ready = readyCardIds();
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
    })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(and(...filters))
    .orderBy(asc(playableCards.createdAt), asc(playableCards.id));

  for (const row of rows) {
    const list = out.get(row.gameSetId);
    if (!list || list.length >= SET_COVER_SLOT_COUNT) continue;
    if (!ready.has(row.id)) continue;
    list.push(row.id);
  }
  return out;
}

/** Masked cover paths for sets that already have baked sidecars. Empty means the cream placeholder. */
export async function readyMaskedCoverUrls(setIds: string[]): Promise<Map<string, string[]>> {
  const cards = await readyCoverCardIds(setIds);
  const urls = new Map<string, string[]>();
  for (const setId of setIds) {
    const ids = cards.get(setId) ?? [];
    urls.set(setId, ids.map((_, slot) => maskedSetCoverUrl(setId, slot)));
  }
  return urls;
}

function setCoverHeaders(res: Response): void {
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  res.setHeader("ETag", `"${CURRENT_MASK_VERSION}"`);
  res.setHeader("X-Mask-Version", CURRENT_MASK_VERSION);
  res.setHeader("X-Mask-Cache", "hit");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.removeHeader("X-Card-Id");
}

function coverNotReady(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.removeHeader("X-Card-Id");
  res.status(404).json({ error: "Cover not ready" });
}

/** Serves a baked masked JPEG. Does not bake and does not echo a card id. */
export async function handlePublicSetCover(req: Request, res: Response): Promise<void> {
  const setId = req.params.setId;
  const slot = Number(req.params.slot);
  if (!isMaskSetUuid(setId) || !Number.isInteger(slot) || slot < 0 || slot >= SET_COVER_SLOT_COUNT) {
    coverNotReady(res);
    return;
  }

  try {
    const cardId = (await readyCoverCardIds([setId])).get(setId)?.[slot];
    const file = cardId ? resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId) : null;
    if (!file) {
      coverNotReady(res);
      return;
    }

    const etag = `"${CURRENT_MASK_VERSION}"`;
    if (req.headers["if-none-match"] === etag) {
      setCoverHeaders(res);
      res.status(304).end();
      return;
    }

    setCoverHeaders(res);
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
