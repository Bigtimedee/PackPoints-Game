/**
 * After a mask version change, or when an active set has fewer than eight
 * distinct baked players, bake covers first and then the rest.
 * Off the request path. Live mask bakes take the slots first.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { gameSets, playableCards } from "@shared/schema";
import { eligibleDealFilter } from "../services/playableSetEligibility";
import { readyMaskedCardIds } from "../services/setCovers";
import { readMaskFailureReason } from "../masking/maskReadySidecar";
import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";
import { enqueueJob, jobQueueTableExists, runNextPendingJob, registerJob } from "../jobs/pgJobQueue";
import { addShutdownHook } from "./shutdownHooks";
import {
  MASK_WARMUP_CONCURRENCY,
  distinctBakedPlayers,
  orderWarmupCards,
  setNeedsMaskWarmup,
} from "./maskWarmupPlan";

const JOB_TYPE = "mask_warmup";
const STATE_NAME = ".mask-warm-state.json";

export interface MaskWarmState {
  version: string;
  finished: string[];
}

export interface SetWarmupCounts {
  warmed: number;
  failed: number;
  skipped: number;
}

let warmupStarted = false;
let warmupStop = false;

export function resetMaskWarmupForTests(): void {
  warmupStarted = false;
  warmupStop = false;
}

export function stopMaskWarmup(): void {
  warmupStop = true;
}

export function readMaskWarmState(dir = MASKED_CARDS_DIR): MaskWarmState {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, STATE_NAME), "utf8")) as {
      version?: unknown;
      finished?: unknown;
    };
    const finished = Array.isArray(raw.finished)
      ? raw.finished.filter((id): id is string => typeof id === "string")
      : [];
    return {
      version: typeof raw.version === "string" ? raw.version : "",
      finished,
    };
  } catch {
    return { version: "", finished: [] };
  }
}

export function writeMaskWarmState(state: MaskWarmState, dir = MASKED_CARDS_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, STATE_NAME), `${JSON.stringify(state)}\n`);
}

export async function runSetWarmup(opts: {
  setId: string;
  setName: string;
  cards: Array<{ id: string; player: string | null }>;
  isBaked: (id: string) => boolean;
  isFailed: (id: string) => boolean;
  bake: (id: string) => Promise<boolean>;
  concurrency?: number;
  shouldStop?: () => boolean;
  log?: (message: string) => void;
}): Promise<SetWarmupCounts> {
  const log = opts.log ?? ((message) => console.log(message));
  const shouldStop = opts.shouldStop ?? (() => warmupStop);
  const concurrency = opts.concurrency ?? MASK_WARMUP_CONCURRENCY;
  const { covers, ordered } = orderWarmupCards(opts.cards, {
    isBaked: opts.isBaked,
    isFailed: opts.isFailed,
  });
  const counts: SetWarmupCounts = { warmed: 0, failed: 0, skipped: opts.cards.length - ordered.length };
  log(`[MaskWarmup] set=${opts.setName} id=${opts.setId} queued=${ordered.length} covers=${covers.length} skipped=${counts.skipped}`);
  if (ordered.length === 0) return counts;

  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, ordered.length) }, async () => {
    while (!shouldStop()) {
      const index = cursor;
      cursor += 1;
      if (index >= ordered.length) return;
      const card = ordered[index];
      const phase = index < covers.length ? "covers" : "rest";
      let ok = false;
      try {
        ok = await opts.bake(card.id);
      } catch (err) {
        ok = false;
        console.error(`[MaskWarmup] set=${opts.setName} card=${card.id} ${err instanceof Error ? err.message : err}`);
      }
      if (ok) counts.warmed += 1;
      else counts.failed += 1;
      done += 1;
      if (done === covers.length || done === ordered.length || done % 25 === 0) {
        log(`[MaskWarmup] set=${opts.setName} id=${opts.setId} phase=${phase} ${done}/${ordered.length} warmed=${counts.warmed} failed=${counts.failed}`);
      }
    }
  });
  await Promise.all(workers);
  log(`[MaskWarmup] set=${opts.setName} id=${opts.setId} done warmed=${counts.warmed} failed=${counts.failed} skipped=${counts.skipped}`);
  return counts;
}

async function loadActiveSetCards(): Promise<Map<string, { setName: string; cards: Array<{ id: string; player: string | null }> }>> {
  const { db } = await import("../db");
  const rows = await db
    .select({
      id: playableCards.id,
      player: playableCards.player,
      gameSetId: playableCards.gameSetId,
      setName: gameSets.setName,
    })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(and(
      eq(gameSets.isActive, true),
      eligibleDealFilter("playable_cards"),
    ));
  const sets = new Map<string, { setName: string; cards: Array<{ id: string; player: string | null }> }>();
  for (const row of rows) {
    const bucket = sets.get(row.gameSetId) ?? { setName: row.setName || row.gameSetId, cards: [] };
    bucket.cards.push({ id: row.id, player: row.player });
    sets.set(row.gameSetId, bucket);
  }
  const active = await db
    .select({ id: gameSets.id, setName: gameSets.setName })
    .from(gameSets)
    .where(eq(gameSets.isActive, true));
  for (const set of active) {
    if (!sets.has(set.id)) {
      sets.set(set.id, { setName: set.setName || set.id, cards: [] });
    }
  }
  return sets;
}

async function bakeWarmCard(cardId: string): Promise<boolean> {
  const { getMaskedImagePath } = await import("../masking/maskingService");
  const baked = await getMaskedImagePath(cardId, { priority: "warm" });
  return Boolean(baked) && readMaskFailureReason(cardId) == null;
}

async function warmOneSet(setId: string, setName: string, cards: Array<{ id: string; player: string | null }>): Promise<void> {
  const bakedIds = readyMaskedCardIds();
  await runSetWarmup({
    setId,
    setName,
    cards,
    isBaked: (id) => bakedIds.has(id),
    isFailed: (id) => readMaskFailureReason(id) != null,
    bake: bakeWarmCard,
    shouldStop: () => warmupStop,
  });
}

export async function enqueueMaskWarmupJobs(dir = MASKED_CARDS_DIR): Promise<string[]> {
  const state = readMaskWarmState(dir);
  const versionChanged = state.version !== CURRENT_MASK_VERSION;
  const finished = new Set(versionChanged ? [] : state.finished);
  const bakedIds = readyMaskedCardIds(dir);
  const sets = await loadActiveSetCards();
  const queued: string[] = [];
  const tableReady = await jobQueueTableExists().catch(() => false);
  if (tableReady) {
    const { pool } = await import("../db");
    await pool.query(
      `UPDATE job_queue
       SET status = 'pending', updated_at = NOW()
       WHERE job_type = $1 AND status = 'running'`,
      [JOB_TYPE],
    );
  }
  for (const [setId, set] of sets) {
    const distinct = distinctBakedPlayers(set.cards, bakedIds);
    const needs = setNeedsMaskWarmup({
      distinctBakedPlayers: distinct,
      versionChanged,
      alreadyFinished: finished.has(setId),
      cardCount: set.cards.length,
    });
    if (!needs) {
      console.log(`[MaskWarmup] set=${set.setName} id=${setId} bakedPlayers=${distinct} skip`);
      continue;
    }
    console.log(`[MaskWarmup] set=${set.setName} id=${setId} bakedPlayers=${distinct} versionChanged=${versionChanged} enqueue`);
    queued.push(setId);
    if (!tableReady) continue;
    const { pool } = await import("../db");
    const existing = await pool.query(
      `SELECT id FROM job_queue
       WHERE job_type = $1
         AND status = 'pending'
         AND payload->>'gameSetId' = $2
         AND payload->>'maskVersion' = $3
       LIMIT 1`,
      [JOB_TYPE, setId, CURRENT_MASK_VERSION],
    );
    if (existing.rows.length > 0) continue;
    await enqueueJob(JOB_TYPE, { gameSetId: setId, maskVersion: CURRENT_MASK_VERSION, setName: set.setName });
  }
  writeMaskWarmState({
    version: CURRENT_MASK_VERSION,
    finished: versionChanged ? [] : [...finished],
  }, dir);
  return queued;
}

async function markSetFinished(setId: string, dir = MASKED_CARDS_DIR): Promise<void> {
  const state = readMaskWarmState(dir);
  if (state.version !== CURRENT_MASK_VERSION) {
    writeMaskWarmState({ version: CURRENT_MASK_VERSION, finished: [setId] }, dir);
    return;
  }
  if (!state.finished.includes(setId)) {
    state.finished.push(setId);
    writeMaskWarmState(state, dir);
  }
}

export function startMaskWarmup(): void {
  if (warmupStarted) return;
  warmupStarted = true;
  warmupStop = false;
  addShutdownHook(() => {
    warmupStop = true;
  });
  void bootMaskWarmup().catch((err) => {
    console.error("[MaskWarmup] crashed:", err instanceof Error ? err.message : err);
  });
}

async function bootMaskWarmup(): Promise<void> {
  registerJob(JOB_TYPE, async (payload) => {
    if (warmupStop) return;
    const setId = typeof payload.gameSetId === "string" ? payload.gameSetId : "";
    if (!setId) return;
    const sets = await loadActiveSetCards();
    const set = sets.get(setId);
    await warmOneSet(setId, set?.setName || String(payload.setName || setId), set?.cards ?? []);
    await markSetFinished(setId);
  });

  const queued = await enqueueMaskWarmupJobs();
  const tableReady = await jobQueueTableExists().catch(() => false);
  if (!tableReady) {
    console.error("[MaskWarmup] job_queue missing, running in-process");
    const sets = await loadActiveSetCards();
    for (const setId of queued) {
      if (warmupStop) return;
      const set = sets.get(setId);
      await warmOneSet(setId, set?.setName || setId, set?.cards ?? []);
      await markSetFinished(setId);
    }
    return;
  }

  while (!warmupStop) {
    const ran = await runNextPendingJob(JOB_TYPE);
    if (!ran) break;
  }
}
