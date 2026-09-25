import { readdirSync, unlinkSync } from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { playableCards } from "@shared/schema";
import { db } from "../db";
import { MASKED_CARDS_DIR } from "./maskPlanStore";

let dirOverride: string | null = null;

/** Tests point this at a temp directory. Production uses the masked-card volume. */
export function setMaskReadySidecarDirForTests(dir: string | null): void {
  dirOverride = dir;
}

export function maskReadySidecarDir(): string {
  return dirOverride ?? MASKED_CARDS_DIR;
}

/**
 * Delete every `{cardId}_*.ok` marker. The early `/api/play/m/` path serves a
 * cached JPEG with no database check once any of these files exists.
 * Returns the filenames removed.
 */
export function invalidateMaskReadySidecar(cardId: string, dir = maskReadySidecarDir()): string[] {
  if (!cardId || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..") || cardId.includes("\0")) {
    return [];
  }
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const prefix = `${cardId}_`;
  const removed: string[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".ok")) continue;
    try {
      unlinkSync(path.join(dir, name));
      removed.push(name);
    } catch {
      // already gone
    }
  }
  return removed;
}

export function invalidateMaskReadySidecars(cardIds: Iterable<string>, dir = maskReadySidecarDir()): string[] {
  const removed: string[] = [];
  for (const cardId of cardIds) {
    removed.push(...invalidateMaskReadySidecar(cardId, dir));
  }
  return removed;
}

/** Every playable card in the set, including ones that are already unplayable. */
export async function invalidateMaskSidecarsForGameSet(gameSetId: string, dir = maskReadySidecarDir()): Promise<string[]> {
  if (!gameSetId) return [];
  const rows = await db
    .select({ id: playableCards.id })
    .from(playableCards)
    .where(eq(playableCards.gameSetId, gameSetId));
  return invalidateMaskReadySidecars(rows.map((row) => row.id), dir);
}
