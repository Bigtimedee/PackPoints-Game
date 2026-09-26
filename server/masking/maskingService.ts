import fs from "fs/promises";
import { existsSync, unlinkSync } from "fs";
import path from "path";
import { db } from "../db";
import { cardImageMaskCache, baseballCards, playableCards, gameSets } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { maskCardImage, CURRENT_MASK_VERSION } from "./maskCardImage";
import { applyServedRotation, orientationOcrBudgetMs, uprightCardImage } from "./cardOrientation";
import { getMaskProfile, logDealtDefaultMaskProfiles } from "./maskProfiles";
import { recognizeWords, resetOcrRuntimeForTests } from "./ocrRuntime";
import {
  clearOrientNote,
  isLandscapeJpegFile,
  normalizeQuarterTurn,
  readOrientNote,
  writeOrientNote,
  type OrientNote,
  type QuarterTurn,
} from "./orientNote";
import { buildSetMaskHint, maskedCardImageUrl } from "@shared/maskGeometry";
import { MASKED_CARDS_DIR, readWarmMaskPlan, writeWarmMaskPlan } from "./maskPlanStore";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";
import { clearMaskFailureSidecar, invalidateMaskReadySidecar, readMaskFailureReason, writeMaskFailureSidecar } from "./maskReadySidecar";
import { isMaskBandExcluded, maskBandFailure, maskBandGuardEnforces, rejectMaskBand } from "./maskBandLimit";
import { NAME_VISIBLE_OUTSIDE_MASK } from "./nameOutsideMask";
import { scheduleNameVisibilityCheck } from "./nameVisibilityBackfill";
import { isSourceFetchTimeout, withSourceFetchTimeout } from "../services/images/sourceFetch";

export { readWarmMaskPlan };

export function warmMaskedFilename(cardId: string, rotation: QuarterTurn = 0): string {
  if (rotation === 90 || rotation === 180 || rotation === 270) {
    return `${cardId}_${CURRENT_MASK_VERSION}_r${rotation}.jpg`;
  }
  return `${cardId}_${CURRENT_MASK_VERSION}.jpg`;
}

function filenameRotation(filename: string): QuarterTurn {
  const match = filename.match(/_r(90|180|270)\.jpg$/);
  return match ? normalizeQuarterTurn(Number(match[1])) : 0;
}

/**
 * Disk hit for the current bake. Upright files stay `{cardId}_${CURRENT_MASK_VERSION}.jpg`.
 * A card that was rotated upright uses a suffix so those warm files are not rebaked.
 */
export function peekWarmMaskedFilename(cardId: string): string | null {
  if (!cardId) return null;
  if (readMaskFailureReason(cardId) === NAME_VISIBLE_OUTSIDE_MASK) return null;
  const note = readOrientNote(cardId);
  if (note) {
    const named = warmMaskedFilename(cardId, note.rotation);
    return existsSync(path.join(MASKED_CARDS_DIR, named)) ? named : null;
  }
  for (const deg of [90, 180, 270] as const) {
    const named = warmMaskedFilename(cardId, deg);
    if (existsSync(path.join(MASKED_CARDS_DIR, named))) return named;
  }
  const plain = warmMaskedFilename(cardId, 0);
  return existsSync(path.join(MASKED_CARDS_DIR, plain)) ? plain : null;
}

const maskingQueue: Map<string, Promise<string | null>> = new Map();
const coverageRefusals = new Map<string, string>();
const OCR_FAILURE_MEMO_MS = 60 * 60 * 1000;
const ocrSkipUntil = new Map<string, number>();
let activeMaskingJobs = 0;
let liveMaskRequests = 0;
/** Warm bakes a live caller is already waiting on. Those skip the live gate. */
const livePromotedBakes = new Set<string>();
const MAX_CONCURRENT_OCR = 2;
const SLOT_POLL_MS = 50;

export const SOURCE_FETCH_TIMEOUT_MS = 9_000;
export const MASK_BAKE_DEADLINE_MS = 20_000;

export type MaskBakeStage = "fetch" | "ocr" | "bake";

export class MaskBakeTimeoutError extends Error {
  readonly stage: MaskBakeStage;
  readonly cardId: string;
  readonly ms: number;

  constructor(stage: MaskBakeStage, cardId: string, ms: number) {
    super("mask bake timed out");
    this.name = "MaskBakeTimeoutError";
    this.stage = stage;
    this.cardId = cardId;
    this.ms = Math.max(0, Math.round(ms));
  }
}

export function isMaskBakeTimeout(error: unknown): error is MaskBakeTimeoutError {
  return error instanceof MaskBakeTimeoutError || (error instanceof Error && error.name === "MaskBakeTimeoutError");
}

let bakeTimings = { fetchMs: SOURCE_FETCH_TIMEOUT_MS, deadlineMs: MASK_BAKE_DEADLINE_MS };
let pathLoaderOverride: ((cardId: string) => Promise<string | null>) | null = null;

export function setMaskBakeTimingsForTests(next: { fetchMs: number; deadlineMs: number } | null): void {
  bakeTimings = next ?? { fetchMs: SOURCE_FETCH_TIMEOUT_MS, deadlineMs: MASK_BAKE_DEADLINE_MS };
}

export function setMaskPathLoaderForTests(loader: ((cardId: string) => Promise<string | null>) | null): void {
  pathLoaderOverride = loader;
}

export function maskBakeSlotsInUse(): number {
  return activeMaskingJobs;
}

export function ocrSkipped(cardId: string, now = Date.now()): boolean {
  const until = ocrSkipUntil.get(cardId);
  if (until == null) return false;
  if (now >= until) {
    ocrSkipUntil.delete(cardId);
    return false;
  }
  return true;
}

/** Remember a hung or failed OCR so the next bake skips it. Does not quarantine. */
export function recordOcrTimeout(cardId: string, ms: number): void {
  ocrSkipUntil.set(cardId, Date.now() + OCR_FAILURE_MEMO_MS);
  console.log(`[MaskBake] ocr-timeout fallback=profile card=${cardId} ms=${Math.max(0, Math.round(ms))}`);
}

export function resetMaskBakeForTests(): void {
  activeMaskingJobs = 0;
  liveMaskRequests = 0;
  livePromotedBakes.clear();
  maskingQueue.clear();
  coverageRefusals.clear();
  ocrSkipUntil.clear();
  pathLoaderOverride = null;
  bakeTimings = { fetchMs: SOURCE_FETCH_TIMEOUT_MS, deadlineMs: MASK_BAKE_DEADLINE_MS };
  resetOcrRuntimeForTests();
}

export interface PreMaskBatch {
  paths: Map<string, string | null>;
  timedOut: number;
}

export interface MaskBakeSource {
  cardId: string;
  imageUrl: string;
  playerName: string;
  setHint: string | null;
  gameSetId: string | null;
  imageRotation?: number | null;
}

async function ensureDirectory(): Promise<void> {
  try {
    await fs.mkdir(MASKED_CARDS_DIR, { recursive: true });
  } catch (error) {
    console.error("[MaskingService] Failed to create directory:", error);
  }
}

async function downloadImage(url: string, cardId: string): Promise<Buffer | null> {
  const started = Date.now();
  try {
    return await withSourceFetchTimeout(async (signal) => {
      const response = await fetch(url, {
        signal,
        headers: {
          "User-Agent": "PackPTS-ImageMasker/1.0",
        },
      });

      if (!response.ok) {
        console.error(`[MaskingService] Failed to download image: ${response.status}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }, bakeTimings.fetchMs);
  } catch (error) {
    if (isSourceFetchTimeout(error)) {
      throw new MaskBakeTimeoutError("fetch", cardId, Date.now() - started);
    }
    console.error("[MaskingService] Error downloading image:", error);
    return null;
  }
}

function releaseBakeSlot(guard: { released: boolean }): void {
  if (guard.released) return;
  guard.released = true;
  activeMaskingJobs--;
}

function warmBakePromoted(cardId: string | undefined): boolean {
  return cardId != null && livePromotedBakes.has(cardId);
}

async function acquireBakeSlot(priority: "live" | "warm" = "live", cardId?: string): Promise<void> {
  // Re-check promotion inside the wait. A live caller can join after this warm
  // bake is already parked, and that caller is awaiting this same promise.
  // The deadline does not start until a slot is held.
  while (
    activeMaskingJobs >= MAX_CONCURRENT_OCR
    || (priority === "warm" && liveMaskRequests > 0 && !warmBakePromoted(cardId))
  ) {
    await new Promise((resolve) => setTimeout(resolve, SLOT_POLL_MS));
  }
  activeMaskingJobs++;
}

/**
 * Holds one bake slot. The deadline rejects even when `work` never settles,
 * and the slot is released once (timeout callback and `finally` share a guard).
 */
async function runInBakeSlot<T>(
  cardId: string,
  work: (setStage: (stage: MaskBakeStage) => void, isCancelled: () => boolean) => Promise<T>,
  priority: "live" | "warm" = "live",
): Promise<T> {
  await acquireBakeSlot(priority, cardId);
  const guard = { released: false };
  const started = Date.now();
  let stage: MaskBakeStage = "fetch";
  const gate = { cancelled: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      gate.cancelled = true;
      releaseBakeSlot(guard);
      reject(new MaskBakeTimeoutError(stage, cardId, Date.now() - started));
    }, bakeTimings.deadlineMs);
  });
  const job = work((next) => {
    stage = next;
  }, () => gate.cancelled);
  job.catch(() => {});
  deadline.catch(() => {});
  try {
    return await Promise.race([job, deadline]);
  } catch (error) {
    if (isMaskBakeTimeout(error)) {
      console.log(`[MaskBake] timeout stage=${error.stage} card=${error.cardId} ms=${error.ms}`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    releaseBakeSlot(guard);
  }
}

/** Share one in-flight bake per card. The entry is dropped when that promise settles, including timeout. */
export function enqueueMaskBake(
  cardId: string,
  start: () => Promise<string | null>,
  opts?: { promote?: boolean },
): Promise<string | null> {
  const existing = maskingQueue.get(cardId);
  if (existing) {
    if (opts?.promote) livePromotedBakes.add(cardId);
    return existing;
  }
  const promise = start();
  maskingQueue.set(cardId, promise);
  const drop = () => {
    if (maskingQueue.get(cardId) === promise) {
      maskingQueue.delete(cardId);
      livePromotedBakes.delete(cardId);
    }
  };
  promise.then(drop, drop);
  return promise;
}

/** Set when a bake is refused. The masked-image route reads this once. */
export function takeCoverageRefusal(cardId: string): string | null {
  const reason = coverageRefusals.get(cardId) ?? null;
  if (reason) coverageRefusals.delete(cardId);
  return reason;
}

async function readImageRotation(cardId: string): Promise<QuarterTurn | null> {
  try {
    const [row] = await db
      .select({ imageRotation: playableCards.imageRotation })
      .from(playableCards)
      .where(eq(playableCards.id, cardId))
      .limit(1);
    if (!row) return 0;
    return normalizeQuarterTurn(row.imageRotation);
  } catch {
    return null;
  }
}

/** Same orientation rule as the masked route. A note wins. Null rotation is a failed DB read. */
export function warmMaskedFileAllowed(args: {
  cardId: string;
  filename: string;
  imageRotation: number | null;
  note: OrientNote | null;
  landscape: boolean;
}): boolean {
  if (args.note) return args.filename === warmMaskedFilename(args.cardId, args.note.rotation);
  const field = args.imageRotation == null ? null : normalizeQuarterTurn(args.imageRotation);
  if (field == null) {
    if (filenameRotation(args.filename) !== 0) return true;
    return !args.landscape;
  }
  if (field !== 0) return args.filename === warmMaskedFilename(args.cardId, field);
  if (filenameRotation(args.filename) !== 0) return true;
  return !args.landscape;
}

/** Reject a warm file whose pixels are still in the raw sideways orientation. */
export async function acceptWarmMaskedFile(cardId: string, filename: string): Promise<boolean> {
  const note = readOrientNote(cardId);
  if (note) return filename === warmMaskedFilename(cardId, note.rotation);

  const field = await readImageRotation(cardId);
  const landscape = isLandscapeJpegFile(path.join(MASKED_CARDS_DIR, filename));
  const allowed = warmMaskedFileAllowed({
    cardId,
    filename,
    imageRotation: field,
    note: null,
    landscape,
  });
  if (!allowed || field == null) return allowed;
  if (field !== 0) {
    if (filename === warmMaskedFilename(cardId, field)) {
      writeOrientNote(cardId, { rotation: field, landscapeDesign: false, coverBoth: false });
    }
    return allowed;
  }
  const turned = filenameRotation(filename);
  if (turned !== 0) {
    writeOrientNote(cardId, { rotation: turned, landscapeDesign: false, coverBoth: false });
    return true;
  }
  if (landscape) return false;
  writeOrientNote(cardId, { rotation: 0, landscapeDesign: false, coverBoth: false });
  return true;
}

export async function getMaskedImagePath(
  cardId: string,
  opts?: { priority?: "live" | "warm" },
): Promise<string | null> {
  const failReason = readMaskFailureReason(cardId);
  if (failReason) {
    coverageRefusals.set(cardId, failReason);
    return null;
  }
  if (pathLoaderOverride) return pathLoaderOverride(cardId);
  if (isMaskBandExcluded(cardId)) return null;

  const warm = peekWarmMaskedFilename(cardId);
  if (warm && await acceptWarmMaskedFile(cardId, warm)) {
    return warm;
  }

  const priority = opts?.priority ?? "live";
  if (priority === "live") liveMaskRequests++;
  try {
    return await enqueueMaskBake(cardId, () => generateMaskedImage(cardId, priority), {
      promote: priority === "live",
    });
  } finally {
    if (priority === "live") liveMaskRequests--;
  }
}

async function generateMaskedImage(cardId: string, priority: "live" | "warm" = "live"): Promise<string | null> {
  await ensureDirectory();

  let imageUrl: string | null = null;
  let playerName: string | null = null;
  let setHint: string | null = null;
  let gameSetId: string | null = null;
  let imageRotation = 0;

  const [baseballCard] = await db
    .select()
    .from(baseballCards)
    .where(eq(baseballCards.id, cardId))
    .limit(1);

  if (baseballCard?.imageUrl) {
    imageUrl = baseballCard.imageUrl;
    playerName = baseballCard.playerName;
    setHint = buildSetMaskHint({
      setName: baseballCard.setName,
      year: baseballCard.year,
      sport: "baseball",
    });
  } else {
    const [playableCard] = await db
      .select()
      .from(playableCards)
      .where(eq(playableCards.id, cardId))
      .limit(1);

    if (playableCard?.imageUrl) {
      imageUrl = playableCard.imageUrl;
      playerName = playableCard.player;
      imageRotation = playableCard.imageRotation ?? 0;
      let year: number | null = null;
      let brand: string | null = null;
      let sport: string | null = null;
      if (playableCard.gameSetId) {
        gameSetId = playableCard.gameSetId;
        const [gameSet] = await db
          .select({
            year: gameSets.year,
            brand: gameSets.brand,
            sport: gameSets.sport,
            setName: gameSets.setName,
          })
          .from(gameSets)
          .where(eq(gameSets.id, playableCard.gameSetId))
          .limit(1);
        if (gameSet) {
          year = gameSet.year;
          brand = gameSet.brand;
          sport = gameSet.sport;
          setHint = buildSetMaskHint({
            year,
            brand,
            sport,
            setName: playableCard.set || gameSet.setName,
            category: playableCard.category,
          });
        }
      }
      if (!setHint) {
        setHint = buildSetMaskHint({
          setName: playableCard.set,
          category: playableCard.category,
        });
      }
    }
  }

  if (!imageUrl) {
    console.error(`[MaskingService] Card not found or no image: ${cardId}`);
    return null;
  }

  const [cached] = await db
    .select()
    .from(cardImageMaskCache)
    .where(eq(cardImageMaskCache.cardId, cardId))
    .limit(1);

  if (
    cached &&
    cached.rawImageUrl === imageUrl &&
    cached.maskVersion === CURRENT_MASK_VERSION
  ) {
    const cachedName = cached.maskedImagePath;
    const cachedPath = path.join(MASKED_CARDS_DIR, cachedName);
    try {
      await fs.access(cachedPath);
      const note = readOrientNote(cardId);
      const field = normalizeQuarterTurn(imageRotation);
      const cachedTurn = filenameRotation(cachedName);
      const landscape = isLandscapeJpegFile(cachedPath);
      const staleField = field !== 0 && cachedTurn !== field;
      const staleNote = note != null && cachedTurn !== note.rotation;
      const staleSideways = field === 0 && cachedTurn === 0 && landscape && !note?.landscapeDesign && !note?.coverBoth;
      if (!staleField && !staleNote && !staleSideways) return cachedName;
    } catch {
      // file missing
    }
  }

  return bakeMaskedCardFromUrl({
    cardId,
    imageUrl,
    playerName: playerName || "",
    setHint,
    gameSetId,
    imageRotation,
  }, priority);
}

export async function bakeMaskedCardFromUrl(
  input: MaskBakeSource,
  priority: "live" | "warm" = "live",
): Promise<string | null> {
  const { cardId, imageUrl } = input;
  const alreadyRefused = readMaskFailureReason(cardId);
  if (alreadyRefused) {
    coverageRefusals.set(cardId, alreadyRefused);
    return null;
  }
  try {
    return await runInBakeSlot(cardId, async (setStage, isCancelled) => {
      setStage("fetch");
      const fetchStarted = Date.now();
      const imageBuffer = await downloadImage(imageUrl, cardId);
      if (!imageBuffer || isCancelled()) return null;

      setStage("ocr");
      logDealtDefaultMaskProfiles([{ setHint: input.setHint, gameSetId: input.gameSetId }]);
      const result = await maskCardImage(
        imageBuffer,
        input.playerName,
        input.setHint,
        {
          gameSetId: input.gameSetId,
          imageRotation: input.imageRotation,
          cardId,
          skipOcr: ocrSkipped(cardId),
          onStage: (stage) => setStage(stage),
          orientationBudgetMs: orientationOcrBudgetMs({
            deadlineMs: bakeTimings.deadlineMs,
            elapsedMs: Date.now() - fetchStarted,
          }),
        },
      );
      if (isCancelled()) return null;
      if (result.ocrTimedOut) recordOcrTimeout(cardId, result.ocrMs);
      if (result.orientationAmbiguous) {
        console.log(`[MaskBake] orientation ambiguous cover=both card=${cardId}`);
      }

      if (!result.coverageOk) {
        const reason = result.coverageReason || "mask_name_uncovered";
        coverageRefusals.set(cardId, reason);
        console.error(`[MaskingService] Refusing playable mask for ${cardId}: ${reason}`, {
          source: result.source,
          layoutClass: result.layoutClass,
          maskVersion: CURRENT_MASK_VERSION,
        });
        await quarantineUncoveredName(cardId, reason);
        return null;
      }

      const bandIssue = maskBandFailure(result.regions);
      if (bandIssue && maskBandGuardEnforces()) {
        console.error(`[MaskingService] Refusing mask band for ${cardId}`, {
          reason: bandIssue,
          maskVersion: CURRENT_MASK_VERSION,
        });
        await rejectMaskBand(cardId, bandIssue);
        return null;
      }

      setStage("bake");
      const rotation = result.servedRotation ?? 0;
      const filename = warmMaskedFilename(cardId, rotation);
      const filePath = path.join(MASKED_CARDS_DIR, filename);

      await fs.writeFile(filePath, result.maskedBuffer);
      await fs.writeFile(path.join(MASKED_CARDS_DIR, warmOkMarkerFilename(cardId)), "ok\n");
      const priorFail = readMaskFailureReason(cardId);
      if (priorFail && priorFail !== NAME_VISIBLE_OUTSIDE_MASK) {
        clearMaskFailureSidecar(cardId);
        await db
          .update(playableCards)
          .set({
            isPlayable: true,
            blockedReason: null,
            quarantineStatus: "OK",
            imageReviewStatus: "unreviewed",
            lastValidationReason: null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(playableCards.id, cardId),
            eq(playableCards.blockedReason, "mask_name_uncovered"),
          ));
      }
      for (const deg of [0, 90, 180, 270] as const) {
        if (deg === rotation) continue;
        try {
          await fs.unlink(path.join(MASKED_CARDS_DIR, warmMaskedFilename(cardId, deg)));
        } catch {
          // sibling cache already gone
        }
      }
      await writeWarmMaskPlan(cardId, {
        layoutClass: result.layoutClass,
        regions: result.regions,
        maskVersion: CURRENT_MASK_VERSION,
      });

      await db
        .insert(cardImageMaskCache)
        .values({
          cardId,
          rawImageUrl: imageUrl,
          maskedImagePath: filename,
          maskVersion: CURRENT_MASK_VERSION,
          layoutClass: result.layoutClass,
          regions: result.regions,
        })
        .onConflictDoUpdate({
          target: cardImageMaskCache.cardId,
          set: {
            rawImageUrl: imageUrl,
            maskedImagePath: filename,
            maskVersion: CURRENT_MASK_VERSION,
            layoutClass: result.layoutClass,
            regions: result.regions,
            updatedAt: new Date(),
          },
        });

      console.log(`[MaskingService] Generated masked image for card ${cardId}`, {
        ocrApplied: result.ocrApplied,
        ocrMatches: result.ocrMatches,
        source: result.source,
        maskVersion: CURRENT_MASK_VERSION,
      });

      scheduleNameVisibilityCheck({
        cardId,
        playerName: input.playerName,
        regions: result.regions,
        filename,
      });

      return filename;
    }, priority);
  } catch (error) {
    if (isMaskBakeTimeout(error)) throw error;
    console.error(`[MaskingService] Failed to mask card ${cardId}:`, error);
    return null;
  }
}

export async function preMaskCards(cardIds: string[]): Promise<PreMaskBatch> {
  const paths = new Map<string, string | null>();
  let timedOut = 0;

  const batchSize = MAX_CONCURRENT_OCR;
  for (let i = 0; i < cardIds.length; i += batchSize) {
    const batch = cardIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (cardId) => {
        try {
          const imagePath = await getMaskedImagePath(cardId);
          return { cardId, path: imagePath, timedOut: false };
        } catch (error) {
          if (isMaskBakeTimeout(error)) return { cardId, path: null, timedOut: true };
          return { cardId, path: null, timedOut: false };
        }
      })
    );

    for (const row of batchResults) {
      paths.set(row.cardId, row.path);
      if (row.timedOut) timedOut++;
    }
  }

  return { paths, timedOut };
}

export function getMaskedImageUrl(cardId: string, _maskedPath?: string): string {
  return maskedCardImageUrl(cardId);
}

async function loadOrientMeta(cardId: string): Promise<{
  imageRotation: number;
  playerName: string;
  setHint: string | null;
  gameSetId: string | null;
}> {
  const empty = { imageRotation: 0, playerName: "", setHint: null, gameSetId: null };
  try {
    const [playableCard] = await db
      .select()
      .from(playableCards)
      .where(eq(playableCards.id, cardId))
      .limit(1);
    if (playableCard?.imageUrl) {
      let setHint: string | null = null;
      if (playableCard.gameSetId) {
        const [gameSet] = await db
          .select({
            year: gameSets.year,
            brand: gameSets.brand,
            sport: gameSets.sport,
            setName: gameSets.setName,
          })
          .from(gameSets)
          .where(eq(gameSets.id, playableCard.gameSetId))
          .limit(1);
        if (gameSet) {
          setHint = buildSetMaskHint({
            year: gameSet.year,
            brand: gameSet.brand,
            sport: gameSet.sport,
            setName: playableCard.set || gameSet.setName,
            category: playableCard.category,
          });
        }
      }
      if (!setHint) {
        setHint = buildSetMaskHint({ setName: playableCard.set, category: playableCard.category });
      }
      return {
        imageRotation: playableCard.imageRotation ?? 0,
        playerName: playableCard.player || "",
        setHint,
        gameSetId: playableCard.gameSetId,
      };
    }
    const [baseballCard] = await db
      .select()
      .from(baseballCards)
      .where(eq(baseballCards.id, cardId))
      .limit(1);
    if (baseballCard?.imageUrl) {
      return {
        imageRotation: 0,
        playerName: baseballCard.playerName || "",
        setHint: buildSetMaskHint({
          setName: baseballCard.setName,
          year: baseballCard.year,
          sport: "baseball",
        }),
        gameSetId: null,
      };
    }
  } catch {
    return empty;
  }
  return empty;
}

/** Same upright turn as the bake, so the reveal frame lines up with the masked JPEG. */
export async function orientUnmaskedScan(cardId: string, buffer: Buffer): Promise<Buffer> {
  const note = readOrientNote(cardId);
  if (note) return applyServedRotation(buffer, note.rotation);

  const meta = await loadOrientMeta(cardId);
  const upright = await uprightCardImage(buffer, {
    imageRotation: meta.imageRotation,
    playerName: meta.playerName,
    profile: getMaskProfile(meta.setHint, meta.gameSetId),
    skipOcr: ocrSkipped(cardId),
    recognize: recognizeWords,
  });
  writeOrientNote(cardId, {
    rotation: upright.rotation,
    landscapeDesign: upright.landscapeDesign,
    coverBoth: upright.orientationAmbiguous,
  });
  if (upright.ocrTimedOut) recordOcrTimeout(cardId, upright.ocrMs);
  return upright.buffer;
}

/** Drop a locked orientation so the next bake honors a new imageRotation. */
export function clearServedOrientation(cardId: string): void {
  clearOrientNote(cardId);
  for (const deg of [0, 90, 180, 270] as const) {
    try {
      unlinkSync(path.join(MASKED_CARDS_DIR, warmMaskedFilename(cardId, deg)));
    } catch {
      // already gone
    }
  }
}

export async function quarantineUncoveredName(cardId: string, reason: string): Promise<void> {
  invalidateMaskReadySidecar(cardId);
  try {
    writeMaskFailureSidecar(cardId, reason);
  } catch (error) {
    console.error(`[MaskingService] Failed to record mask failure sidecar for ${cardId}:`, error);
  }
  try {
    await db
      .update(playableCards)
      .set({
        isPlayable: false,
        blockedReason: reason === NAME_VISIBLE_OUTSIDE_MASK ? NAME_VISIBLE_OUTSIDE_MASK : "mask_name_uncovered",
        imageReviewStatus: "flagged",
        quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
        lastValidationReason: reason.slice(0, 240),
        updatedAt: new Date(),
      })
      .where(eq(playableCards.id, cardId));
  } catch (error) {
    console.error(`[MaskingService] Failed to quarantine uncovered name for ${cardId}:`, error);
  }
}

export function getMaskedCardsDir(): string {
  return MASKED_CARDS_DIR;
}

export async function invalidateMaskedImageCache(opts: {
  setId?: string;
  cardIds?: string[];
  all?: boolean;
} = {}): Promise<{ deletedRows: number; deletedFiles: number; cardIds: string[] }> {
  await ensureDirectory();

  let cardIds = opts.cardIds ? [...opts.cardIds] : [];
  if (opts.setId) {
    const rows = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, opts.setId));
    cardIds.push(...rows.map((row) => row.id));
  }

  cardIds = [...new Set(cardIds.filter(Boolean))];

  let cacheRows: { cardId: string; maskedImagePath: string }[] = [];
  if (opts.all) {
    cacheRows = await db.select({
      cardId: cardImageMaskCache.cardId,
      maskedImagePath: cardImageMaskCache.maskedImagePath,
    }).from(cardImageMaskCache);
  } else if (cardIds.length > 0) {
    cacheRows = await db
      .select({
        cardId: cardImageMaskCache.cardId,
        maskedImagePath: cardImageMaskCache.maskedImagePath,
      })
      .from(cardImageMaskCache)
      .where(inArray(cardImageMaskCache.cardId, cardIds));
  }

  let deletedFiles = 0;
  for (const row of cacheRows) {
    try {
      await fs.unlink(path.join(MASKED_CARDS_DIR, row.maskedImagePath));
      deletedFiles++;
    } catch {
      // already gone
    }
    try {
      await fs.unlink(path.join(MASKED_CARDS_DIR, row.maskedImagePath.replace(/\.jpe?g$/i, ".json")));
    } catch {
      // plan sidecar already gone
    }
  }

  if (opts.all) {
    await db.delete(cardImageMaskCache);
  } else if (cacheRows.length > 0) {
    await db.delete(cardImageMaskCache).where(
      inArray(cardImageMaskCache.cardId, cacheRows.map((row) => row.cardId)),
    );
  }

  return {
    deletedRows: cacheRows.length,
    deletedFiles,
    cardIds: cacheRows.map((row) => row.cardId),
  };
}
