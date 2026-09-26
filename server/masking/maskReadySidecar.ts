import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
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

/** Written when post-bake verification still sees the name. Not a ready marker. */
export function maskFailureSidecarFilename(cardId: string): string {
  return `${cardId}_${CURRENT_MASK_VERSION}.fail`;
}

export function writeMaskFailureSidecar(cardId: string, reason: string, dir = maskReadySidecarDir()): void {
  if (!cardId || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..") || cardId.includes("\0")) {
    return;
  }
  const text = (reason || "name_text_visible").replace(/[\r\n]+/g, " ").slice(0, 240);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, maskFailureSidecarFilename(cardId)), `${text}\n`);
}

export function readMaskFailureReason(cardId: string, dir = maskReadySidecarDir()): string | null {
  if (!cardId || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..")) return null;
  try {
    const text = readFileSync(path.join(dir, maskFailureSidecarFilename(cardId)), "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

export function clearMaskFailureSidecar(cardId: string, dir = maskReadySidecarDir()): void {
  if (!cardId || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..")) return;
  try {
    unlinkSync(path.join(dir, maskFailureSidecarFilename(cardId)));
  } catch {
    // already gone
  }
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

function sidecarCardId(name: string): string | null {
  if (!name.endsWith(".ok")) return null;
  const cut = name.indexOf("_");
  if (cut <= 0) return null;
  return name.slice(0, cut);
}

/** One directory scan for a set. Card ids are uuids, so the id is the filename prefix before `_`. */
export function invalidateMaskReadySidecars(cardIds: Iterable<string>, dir = maskReadySidecarDir()): string[] {
  const ids = new Set<string>();
  for (const cardId of cardIds) {
    if (!cardId || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..") || cardId.includes("\0")) {
      continue;
    }
    ids.add(cardId);
  }
  if (ids.size === 0) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    const cardId = sidecarCardId(name);
    if (!cardId || !ids.has(cardId)) continue;
    try {
      unlinkSync(path.join(dir, name));
      removed.push(name);
    } catch {
      // already gone
    }
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
