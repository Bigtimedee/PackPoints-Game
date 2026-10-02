/**
 * Drop masked-image files and card_image_mask_cache rows whose card or game
 * set is gone. Boot logs one line. hardDeleteGameSet calls the card purge
 * for the rows it just removed.
 */
import { readdirSync, unlinkSync } from "fs";
import path from "path";
import { eq, inArray, isNull } from "drizzle-orm";
import {
  baseballCards,
  cardImageMaskCache,
  gameSets,
  maskBakeRefusals,
  playableCards,
} from "@shared/schema";
import { db } from "../db";
import { MASKED_CARDS_DIR } from "./maskPlanStore";
import { maskReadySidecarDir } from "./maskReadySidecar";

const CHUNK = 400;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function cardIdFromMaskCacheFilename(name: string): string | null {
  if (!name || name.startsWith(".") || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null;
  }
  const cut = name.indexOf("_v");
  if (cut <= 0) return null;
  return name.slice(0, cut);
}

function listMaskFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function uniqueDirs(dirs: string[]): string[] {
  return [...new Set(dirs.map((dir) => path.resolve(dir)))];
}

/** Card delete removes files in the sidecar dir and the masked-card dir. */
function deleteDirs(): string[] {
  return uniqueDirs([maskReadySidecarDir(), MASKED_CARDS_DIR]);
}

function safeCardId(cardId: string): boolean {
  return Boolean(cardId)
    && cardId.length <= 100
    && !cardId.includes("/")
    && !cardId.includes("\\")
    && !cardId.includes("..")
    && !cardId.includes("\0");
}

/** Delete every cached file and cache row for these card ids. Returns how many ids had something removed. */
export async function purgeMaskCacheForCards(cardIds: Iterable<string>, dirs = deleteDirs()): Promise<number> {
  const ids = [...new Set([...cardIds].filter(safeCardId))];
  if (ids.length === 0) return 0;
  const removed = new Set<string>();
  for (const dir of dirs) {
    const names = listMaskFiles(dir);
    for (const cardId of ids) {
      const prefix = `${cardId}_`;
      for (const name of names) {
        if (!name.startsWith(prefix)) continue;
        try {
          unlinkSync(path.join(dir, name));
          removed.add(cardId);
        } catch {
          // already gone
        }
      }
    }
  }
  for (const slice of chunks(ids, CHUNK)) {
    const rows = await db
      .delete(cardImageMaskCache)
      .where(inArray(cardImageMaskCache.cardId, slice))
      .returning({ cardId: cardImageMaskCache.cardId });
    for (const row of rows) removed.add(row.cardId);
  }
  return removed.size;
}

async function liveCardIds(ids: string[]): Promise<Set<string>> {
  const live = new Set<string>();
  for (const slice of chunks(ids, CHUNK)) {
    const playable = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
      .where(inArray(playableCards.id, slice));
    for (const row of playable) live.add(row.id);
    const baseball = await db
      .select({ id: baseballCards.id })
      .from(baseballCards)
      .where(inArray(baseballCards.id, slice));
    for (const row of baseball) live.add(row.id);
  }
  return live;
}

async function missingSetIds(ids: string[]): Promise<Set<string>> {
  const missing = new Set(ids.filter(Boolean));
  for (const slice of chunks([...missing], CHUNK)) {
    if (slice.length === 0) continue;
    const rows = await db
      .select({ id: gameSets.id })
      .from(gameSets)
      .where(inArray(gameSets.id, slice));
    for (const row of rows) missing.delete(row.id);
  }
  return missing;
}

/**
 * Cards with no row, or a row whose game set is gone.
 * Sets are the missing game_set ids we could attribute, including from a
 * refusal row for a purged card.
 */
export async function purgeOrphanedMaskCache(): Promise<{ orphans: number; sets: string[] }> {
  const dirs = uniqueDirs([maskReadySidecarDir()]);
  const candidates = new Set<string>();
  for (const dir of dirs) {
    for (const name of listMaskFiles(dir)) {
      const cardId = cardIdFromMaskCacheFilename(name);
      if (cardId) candidates.add(cardId);
    }
  }
  const cacheRows = await db
    .select({ cardId: cardImageMaskCache.cardId })
    .from(cardImageMaskCache);
  for (const row of cacheRows) candidates.add(row.cardId);

  const sets = new Set<string>();
  const dangling = await db
    .select({ id: playableCards.id, gameSetId: playableCards.gameSetId })
    .from(playableCards)
    .leftJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(isNull(gameSets.id));
  for (const row of dangling) {
    candidates.add(row.id);
    if (row.gameSetId) sets.add(row.gameSetId);
  }

  const live = candidates.size === 0 ? new Set<string>() : await liveCardIds([...candidates]);
  const orphans = [...candidates].filter((id) => !live.has(id));

  if (orphans.length > 0) {
    const refusalSetIds: string[] = [];
    for (const slice of chunks(orphans, CHUNK)) {
      const rows = await db
        .select({ gameSetId: maskBakeRefusals.gameSetId })
        .from(maskBakeRefusals)
        .where(inArray(maskBakeRefusals.cardId, slice));
      for (const row of rows) {
        if (row.gameSetId) refusalSetIds.push(row.gameSetId);
      }
    }
    for (const id of await missingSetIds(refusalSetIds)) sets.add(id);
    await purgeMaskCacheForCards(orphans, dirs);
  }

  return { orphans: orphans.length, sets: [...sets].sort((a, b) => a.localeCompare(b)) };
}

/** One boot line. sets is the first 8 characters of each missing set id. */
export async function logMaskCachePurge(): Promise<{ orphans: number; sets: string[] }> {
  const result = await purgeOrphanedMaskCache();
  const list = result.sets.map((id) => id.slice(0, 8)).join(",");
  console.log(`[MaskCachePurge] orphans=${result.orphans} sets=${list}`);
  return result;
}
