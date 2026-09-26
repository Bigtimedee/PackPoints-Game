/**
 * OCR already-baked masked JPEGs off the request path.
 * A pass writes `{cardId}_v4.6.n2`. A surname outside the mask quarantines the
 * card and does not paint a jersey mask. Mask version is v4.6.
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { and, eq, inArray } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { getPackptsDayKey } from "@shared/packptsDay";
import type { MaskRegion } from "@shared/schema";
import { dailyChallengeCards, dailyChallenges, playableCards } from "@shared/schema";
import { db } from "../db";
import { MASKED_CARDS_DIR, warmMaskPlanFilename } from "./maskPlanStore";
import { readMaskFailureReason } from "./maskReadySidecar";
import {
  NAME_VISIBLE_OUTSIDE_MASK,
  clearNameVisibilityPassed,
  readNameVisibilityPassed,
  verifyNameVisibleOutsideMask,
  writeNameVisibilityPassed,
} from "./nameOutsideMask";
import { recognizeNameWords, type OcrWordResult } from "./ocrRuntime";
import { markSubsetLayoutVerified } from "./subsetQuarantine";

export interface NameVisibilityCounts {
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface NameVisibilityJob {
  cardId: string;
  filename: string;
  playerName: string;
  regions: MaskRegion[];
}

const PAUSE_MS = 50;
let tail: Promise<void> = Promise.resolve();
const inFlight = new Set<string>();

function jpegForCard(cardId: string, names: Set<string>): string | null {
  const plain = `${cardId}_${CURRENT_MASK_VERSION}.jpg`;
  if (names.has(plain)) return plain;
  for (const deg of [90, 180, 270]) {
    const named = `${cardId}_${CURRENT_MASK_VERSION}_r${deg}.jpg`;
    if (names.has(named)) return named;
  }
  return null;
}

function cardIdsInDir(dir: string): Array<{ cardId: string; filename: string }> {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const set = new Set(names);
  const suffix = `_${CURRENT_MASK_VERSION}`;
  const ids = new Set<string>();
  for (const name of names) {
    const cut = name.indexOf(suffix);
    if (cut <= 0) continue;
    if (!name.endsWith(".jpg")) continue;
    ids.add(name.slice(0, cut));
  }
  const out: Array<{ cardId: string; filename: string }> = [];
  for (const cardId of ids) {
    const filename = jpegForCard(cardId, set);
    if (filename) out.push({ cardId, filename });
  }
  return out;
}

async function todayCardIds(): Promise<string[]> {
  const today = getPackptsDayKey();
  const rows = await db
    .select({ cardId: dailyChallengeCards.cardId })
    .from(dailyChallengeCards)
    .innerJoin(dailyChallenges, eq(dailyChallenges.id, dailyChallengeCards.dailyChallengeId))
    .where(and(
      eq(dailyChallenges.date, today),
      inArray(dailyChallenges.status, ["ACTIVE", "SCHEDULED"]),
    ));
  return rows.map((row) => row.cardId);
}

function regionsForCard(dir: string, cardId: string): MaskRegion[] {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, warmMaskPlanFilename(cardId)), "utf8")) as {
      regions?: MaskRegion[];
    };
    return Array.isArray(raw.regions) ? raw.regions : [];
  } catch {
    return [];
  }
}

async function defaultOnVisible(cardId: string): Promise<void> {
  const { quarantineUncoveredName } = await import("./maskingService");
  await quarantineUncoveredName(cardId, NAME_VISIBLE_OUTSIDE_MASK);
  const { swapFailedCardsOnTodayChallenge } = await import("../services/daily5FailedCardSwap");
  await swapFailedCardsOnTodayChallenge();
}

export async function inspectMaskedFile(input: {
  dir: string;
  cardId: string;
  filename: string;
  playerName: string;
  regions: MaskRegion[];
  recognize?: (buffer: Buffer, originalWidth: number) => Promise<OcrWordResult>;
  onVisible?: (cardId: string) => Promise<void>;
}): Promise<"passed" | "failed" | "skipped"> {
  if (!input.playerName.trim()) return "skipped";
  if (readMaskFailureReason(input.cardId, input.dir)) return "skipped";
  if (readNameVisibilityPassed(input.cardId, input.dir)) return "skipped";
  if (inFlight.has(input.cardId)) return "skipped";
  inFlight.add(input.cardId);
  try {
    const buffer = readFileSync(path.join(input.dir, input.filename));
    const verdict = await verifyNameVisibleOutsideMask({
      buffer,
      playerName: input.playerName,
      regions: input.regions,
      recognize: input.recognize,
    });
    if (verdict.skipped) {
      console.log(`[MaskCheck] skipped card=${input.cardId} reason=ocr_timeout`);
      return "skipped";
    }
    if (!verdict.ok) {
      clearNameVisibilityPassed(input.cardId, input.dir);
      console.log(`[MaskCheck] ${NAME_VISIBLE_OUTSIDE_MASK} card=${input.cardId}`);
      await (input.onVisible ?? defaultOnVisible)(input.cardId);
      return "failed";
    }
    writeNameVisibilityPassed(input.cardId, input.dir);
    await markSubsetLayoutVerified(input.cardId);
    return "passed";
  } catch (error) {
    console.error(
      `[MaskCheck] skipped card=${input.cardId} reason=read_failed`,
      error instanceof Error ? error.message : error,
    );
    return "skipped";
  } finally {
    inFlight.delete(input.cardId);
  }
}

/**
 * After a bake returns, OCR the file without holding the request.
 * Vitest skips this so a synthetic bake cannot quarantine itself after the assert.
 */
export function scheduleNameVisibilityCheck(input: {
  cardId: string;
  playerName: string;
  regions: MaskRegion[];
  filename: string;
  dir?: string;
}): void {
  if (process.env.VITEST === "true") return;
  const dir = input.dir ?? MASKED_CARDS_DIR;
  tail = tail.then(async () => {
    await inspectMaskedFile({
      dir,
      cardId: input.cardId,
      filename: input.filename,
      playerName: input.playerName,
      regions: input.regions,
    });
  }).catch((error) => {
    console.error("[MaskCheck] background check failed", error instanceof Error ? error.message : error);
  });
}

export async function runNameVisibilityBackfill(opts?: {
  dir?: string;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  shouldStop?: () => boolean;
  recognize?: (buffer: Buffer, originalWidth: number) => Promise<OcrWordResult>;
  loadPlayers?: (cardIds: string[]) => Promise<Map<string, string>>;
  priorityIds?: string[];
  onVisible?: (cardId: string) => Promise<void>;
  files?: Array<{ cardId: string; filename: string }>;
}): Promise<NameVisibilityCounts> {
  const dir = opts?.dir ?? MASKED_CARDS_DIR;
  const pauseMs = opts?.pauseMs ?? PAUSE_MS;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const shouldStop = opts?.shouldStop ?? (() => false);
  const counts: NameVisibilityCounts = { checked: 0, passed: 0, failed: 0, skipped: 0 };
  const files = opts?.files ?? cardIdsInDir(dir);
  let priority: string[] = opts?.priorityIds ?? [];
  if (!opts?.priorityIds && !opts?.files) {
    try {
      priority = await todayCardIds();
    } catch (error) {
      console.error("[MaskCheck] today card lookup failed", error instanceof Error ? error.message : error);
    }
  }
  const rank = new Map(priority.map((id, index) => [id, index]));
  files.sort((a, b) => {
    const ar = rank.has(a.cardId) ? rank.get(a.cardId)! : Number.MAX_SAFE_INTEGER;
    const br = rank.has(b.cardId) ? rank.get(b.cardId)! : Number.MAX_SAFE_INTEGER;
    return ar - br;
  });
  const loadPlayers = opts?.loadPlayers ?? (async (cardIds: string[]) => {
    const map = new Map<string, string>();
    if (cardIds.length === 0) return map;
    const rows = await db
      .select({ id: playableCards.id, player: playableCards.player })
      .from(playableCards)
      .where(inArray(playableCards.id, cardIds));
    for (const row of rows) map.set(row.id, row.player || "");
    return map;
  });

  for (let i = 0; i < files.length; i += 20) {
    if (shouldStop()) break;
    const batch = files.slice(i, i + 20);
    let players = new Map<string, string>();
    try {
      players = await loadPlayers(batch.map((file) => file.cardId));
    } catch (error) {
      console.error("[MaskCheck] player lookup failed", error instanceof Error ? error.message : error);
      counts.skipped += batch.length;
      continue;
    }
    for (const file of batch) {
      if (shouldStop()) break;
      counts.checked += 1;
      const outcome = await inspectMaskedFile({
        dir,
        cardId: file.cardId,
        filename: file.filename,
        playerName: players.get(file.cardId) || "",
        regions: regionsForCard(dir, file.cardId),
        recognize: opts?.recognize ?? recognizeNameWords,
        onVisible: opts?.onVisible,
      });
      counts[outcome] += 1;
      if (pauseMs > 0) await sleep(pauseMs);
    }
  }
  console.log(`[MaskCheck] backfill checked=${counts.checked} passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped}`);
  return counts;
}
