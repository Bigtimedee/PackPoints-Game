/**
 * Public set covers walk Design picks, then alternates, and keep the first valid cards.
 * Never bakes. The public list never returns a raw photo URL, a player name, or a card id.
 * A served JPEG sets X-Mask-Version only. Never a card id, plan or name in headers.
 * QA lists the pins and the old auto picker so Design can compare them.
 */
import { toPublicMaskPlan } from "@shared/maskPlan";
import { createHash, createHmac, randomBytes, randomInt } from "crypto";
import { getPackptsDayKey } from "@shared/packptsDay";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import type { Request, Response } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { CURRENT_MASK_VERSION, isMaskSetUuid } from "@shared/maskGeometry";
import { maskedSetCoverUrl, SET_COVER_SLOT_COUNT, SET_COVER_WIDTHS, setCoverVersionFromEtag } from "@shared/setCoverUrl";
import sharp from "sharp";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import {
  listedPinnedCoverEntries,
  listedPinnedCoverIds,
  MAX_PINNED_COVERS,
  PINNED_SET_COVERS,
  type CoverListRole,
  type ListedCover,
} from "../config/pinnedCovers";
import { ensureHeldSets, ensureHeldSetsFresh, isHeldSet } from "../config/heldSets";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { isBlockedCard } from "../lib/cardBlocklist";
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
  description: string | null;
};

export type PinDropReason = "blocked" | "band" | "ineligible" | "unbaked" | "duplicate" | "missing" | "over-cap";

export interface PinnedCoverDrop {
  cardId: string;
  reason: PinDropReason;
}

export interface PinnedCoverReport {
  setId: string;
  pickCount: number;
  alternateCount: number;
  entries: ListedCover[];
  pinnedIds: string[];
  validIds: string[];
  dropped: PinnedCoverDrop[];
}

export function formatPinnedCoverBootLine(report: PinnedCoverReport): string {
  const skipped = report.dropped.length
    ? report.dropped.map((drop) => `${drop.cardId}:${drop.reason}`).join(",")
    : "none";
  return `[PinnedCovers] set=${report.setId} picks=${report.pickCount} alternates=${report.alternateCount} valid=${report.validIds.length} skipped=${skipped}`;
}

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
      description: playableCards.description,
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

async function loadPinnedCoverRows(cardIds: string[]): Promise<Map<string, CoverRow>> {
  const out = new Map<string, CoverRow>();
  if (cardIds.length === 0) return out;
  const rows = await db
    .select({
      id: playableCards.id,
      gameSetId: playableCards.gameSetId,
      player: playableCards.player,
      number: playableCards.number,
      variant: playableCards.variant,
      description: playableCards.description,
    })
    .from(playableCards)
    .where(inArray(playableCards.id, cardIds));
  for (const row of rows) out.set(row.id, row);
  return out;
}

async function eligiblePinnedIds(setIds: string[], cardIds: string[]): Promise<Set<string>> {
  const eligible = new Set<string>();
  if (setIds.length === 0 || cardIds.length === 0) return eligible;
  const rows = await db
    .select({ id: playableCards.id })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(and(
      inArray(playableCards.gameSetId, setIds),
      inArray(playableCards.id, cardIds),
      eligibleDealFilter("playable_cards"),
      sql`LOWER(playable_cards.category) = LOWER(game_sets.sport)`,
    ));
  for (const row of rows) eligible.add(row.id);
  return eligible;
}

function classifyPinnedCover(
  setId: string,
  cardId: string,
  row: CoverRow | undefined,
  eligible: Set<string>,
  ready: Set<string>,
  seenPlayers: Set<string>,
): { ok: true } | { ok: false; reason: PinDropReason } {
  if (!row || row.gameSetId !== setId) return { ok: false, reason: "missing" };
  if (isBlockedCard(row.gameSetId, row.player, row)) return { ok: false, reason: "blocked" };
  if (isMaskBandExcluded(cardId)) return { ok: false, reason: "band" };
  if (!eligible.has(cardId)) return { ok: false, reason: "ineligible" };
  if (!ready.has(cardId)) return { ok: false, reason: "unbaked" };
  const identity = playerCoverIdentity(row.player);
  if (!identity || seenPlayers.has(identity)) return { ok: false, reason: "duplicate" };
  seenPlayers.add(identity);
  return { ok: true };
}

/** Picks, then alternates. A failed card is skipped. Nothing outside the list is used. */
export async function resolvePinnedCoverReports(setIds: string[]): Promise<Map<string, PinnedCoverReport>> {
  const listedBySet = new Map<string, ListedCover[]>();
  const lookupIds: string[] = [];
  for (const setId of setIds) {
    const listed = listedPinnedCoverEntries(setId);
    listedBySet.set(setId, listed);
    for (const entry of listed) lookupIds.push(entry.cardId);
  }

  const uniqueIds = [...new Set(lookupIds)];
  const needsRows = uniqueIds.length > 0;
  const [rows, eligible, ready] = needsRows
    ? await Promise.all([
      loadPinnedCoverRows(uniqueIds),
      eligiblePinnedIds(setIds, uniqueIds),
      Promise.resolve(readyMaskedCardIds()),
    ])
    : [new Map<string, CoverRow>(), new Set<string>(), new Set<string>()];

  const out = new Map<string, PinnedCoverReport>();
  for (const setId of setIds) {
    const entries = listedBySet.get(setId) ?? [];
    const dropped: PinnedCoverDrop[] = [];
    const validIds: string[] = [];
    const seenIds = new Set<string>();
    const seenPlayers = new Set<string>();
    for (const entry of entries) {
      if (seenIds.has(entry.cardId)) {
        dropped.push({ cardId: entry.cardId, reason: "duplicate" });
        continue;
      }
      seenIds.add(entry.cardId);
      const verdict = classifyPinnedCover(setId, entry.cardId, rows.get(entry.cardId), eligible, ready, seenPlayers);
      if (!verdict.ok) {
        dropped.push({ cardId: entry.cardId, reason: verdict.reason });
        continue;
      }
      if (validIds.length >= MAX_PINNED_COVERS) {
        dropped.push({ cardId: entry.cardId, reason: "over-cap" });
        continue;
      }
      validIds.push(entry.cardId);
    }
    out.set(setId, {
      setId,
      pickCount: entries.filter((entry) => entry.role === "pick").length,
      alternateCount: entries.filter((entry) => entry.role === "alternate").length,
      entries,
      pinnedIds: entries.map((entry) => entry.cardId),
      validIds,
      dropped,
    });
  }
  return out;
}

export async function logPinnedCoversAtBoot(): Promise<void> {
  const ids = new Set<string>(Object.keys(PINNED_SET_COVERS));
  try {
    const rows = await db
      .select({ id: gameSets.id })
      .from(gameSets)
      .where(and(eq(gameSets.isActive, true), eq(gameSets.isUserCreated, false)));
    for (const row of rows) ids.add(row.id);
  } catch {
    console.error("[PinnedCovers] set list failed");
  }
  const setIds = [...ids].sort();
  const reports = await resolvePinnedCoverReports(setIds);
  for (const setId of setIds) {
    const report = reports.get(setId) ?? {
      setId,
      pickCount: 0,
      alternateCount: 0,
      entries: [],
      pinnedIds: [],
      validIds: [],
      dropped: [],
    };
    console.log(formatPinnedCoverBootLine(report));
  }
}

async function readyCoverCardIds(setIds: string[]): Promise<Map<string, string[]>> {
  const reports = await resolvePinnedCoverReports(setIds);
  const out = new Map<string, string[]>();
  for (const setId of setIds) out.set(setId, reports.get(setId)?.validIds ?? []);
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
  source: CoverListRole | "picker";
  served: boolean;
}

export interface PinnedCoverStatus {
  cardId: string;
  order: number;
  role: CoverListRole;
  status: "pick" | "alternate" | "skipped";
  reason: PinDropReason | null;
  slot: number | null;
  served: boolean;
  inPicker: boolean;
}

export interface CoverCandidateReport {
  pinnedCount: number;
  validCount: number;
  coversDisabled: boolean;
  pins: PinnedCoverStatus[];
  picker: CoverCandidate[];
  candidates: CoverCandidate[];
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

function toCoverCandidate(row: CoverRow, slot: number, source: CoverListRole | "picker", served: boolean): CoverCandidate {
  return {
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
    source,
    served,
  };
}

/**
 * Public covers are the valid pins. `picker` is the old auto order, for Design.
 * Ignores SETS_COVERS_DISABLED. `coversDisabled` reports that switch.
 */
export async function listCoverCandidates(setId: string, limit: number): Promise<CoverCandidateReport> {
  const [report, pickerRows, rawRows] = await Promise.all([
    resolvePinnedCoverReports([setId]).then((map) => map.get(setId)!),
    eligibleCoverRows([setId]).then((map) => map.get(setId) ?? []),
    loadPinnedCoverRows(listedPinnedCoverIds(setId)),
  ]);
  const served = new Set(report.validIds);
  const roleOf = new Map<string, CoverListRole>();
  for (const entry of report.entries) {
    if (!roleOf.has(entry.cardId)) roleOf.set(entry.cardId, entry.role);
  }
  const pickerIds = new Set(pickCoverSlots(pickerRows, limit).map((row) => row.id));
  const picker = pickCoverSlots(pickerRows, limit).map((row, slot) => (
    toCoverCandidate(row, slot, "picker", served.has(row.id))
  ));
  const validRows = report.validIds
    .map((id) => rawRows.get(id) ?? pickerRows.find((row) => row.id === id))
    .filter((row): row is CoverRow => !!row);
  const candidates = validRows.slice(0, limit).map((row, slot) => (
    toCoverCandidate(row, slot, roleOf.get(row.id) ?? "pick", true)
  ));
  const slotOf = new Map(report.validIds.map((id, slot) => [id, slot]));
  const pins: PinnedCoverStatus[] = [];
  const pendingDrops = report.dropped.slice();
  const takeReason = (cardId: string, fallback: PinDropReason): PinDropReason => {
    const index = pendingDrops.findIndex((drop) => drop.cardId === cardId);
    if (index < 0) return fallback;
    const reason = pendingDrops[index].reason;
    pendingDrops.splice(index, 1);
    return reason;
  };
  const seen = new Set<string>();
  report.entries.forEach((entry, order) => {
    const inPicker = pickerIds.has(entry.cardId);
    if (seen.has(entry.cardId)) {
      pins.push({
        cardId: entry.cardId,
        order,
        role: entry.role,
        status: "skipped",
        reason: takeReason(entry.cardId, "duplicate"),
        slot: null,
        served: false,
        inPicker,
      });
      return;
    }
    seen.add(entry.cardId);
    const slot = slotOf.get(entry.cardId);
    pins.push({
      cardId: entry.cardId,
      order,
      role: entry.role,
      status: slot == null ? "skipped" : entry.role,
      reason: slot == null ? takeReason(entry.cardId, "missing") : null,
      slot: slot == null ? null : slot,
      served: slot != null,
      inPicker,
    });
  });
  return {
    pinnedCount: report.pinnedIds.length,
    validCount: report.validIds.length,
    coversDisabled: setsCoversDisabled(),
    pins,
    picker,
    candidates,
  };
}

/** Masked file for one card that passes the cover filters. The set hold is ignored so QA can review it. Null never falls back to a raw scan. */
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
      eligibleDealFilter("playable_cards", { ignoreHeldSets: true }),
      sql`LOWER(playable_cards.category) = LOWER(game_sets.sport)`,
    ))
    .limit(1);
  if (!row) return null;
  return resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId);
}

/** Masked cover paths plus per-slot cache versions (hash prefixes, never card ids). */
export async function readyMaskedCovers(setIds: string[]): Promise<Map<string, { urls: string[]; versions: string[] }>> {
  const out = new Map<string, { urls: string[]; versions: string[] }>();
  if (setsCoversDisabled()) {
    for (const setId of setIds) out.set(setId, { urls: [], versions: [] });
    return out;
  }
  // Boot: the mask-readiness pass has not finished, so an empty list here is
  // "not known yet", not "no covers" (1990 Hoops listed 0 covers for a minute
  // after deploys). Wait for the first warm pass, bounded.
  if (coverCacheEnabled() && !coverWarmReady) {
    await Promise.race([coverWarmReadyPromise, new Promise((r) => setTimeout(r, LIST_WARM_WAIT_MS).unref?.())]);
  }
  const cards = await readyCoverCardIds(setIds);
  for (const setId of setIds) {
    let ids = cards.get(setId) ?? [];
    if (ids.length >= SET_COVER_SLOT_COUNT) lastGoodCovers.set(setId, ids);
    else if (lastGoodCovers.has(setId) && !isHeldSet(setId) && (ids.length === 0 || !coverWarmReady)) ids = lastGoodCovers.get(setId)!;
    out.set(setId, {
      urls: ids.map((_, slot) => maskedSetCoverUrl(setId, slot)),
      versions: ids.map((cardId, slot) => setCoverVersionFromEtag(setCoverEtag(setId, slot, cardId))),
    });
  }
  return out;
}

/** Masked cover paths for sets that already have baked sidecars. Empty means the cream placeholder. */
export async function readyMaskedCoverUrls(setIds: string[]): Promise<Map<string, string[]>> {
  const covers = await readyMaskedCovers(setIds);
  const urls = new Map<string, string[]>();
  for (const [setId, c] of covers) urls.set(setId, c.urls);
  return urls;
}

const COVER_LONG_CACHE = "public, max-age=31536000, immutable";
const COVER_SHORT_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

function setCoverHeaders(res: Response, etag: string, cardId: string, opts: { webp?: boolean; versioned?: boolean } = {}): void {
  res.setHeader("Content-Type", opts.webp ? "image/webp" : "image/jpeg");
  // A ?v= that matches the slot's current card makes the URL content-addressed, so it can be cached for a year.
  res.setHeader("Cache-Control", opts.versioned ? COVER_LONG_CACHE : COVER_SHORT_CACHE);
  res.setHeader("ETag", etag);
  res.setHeader("X-Mask-Version", CURRENT_MASK_VERSION);
  res.setHeader("X-Mask-Cache", "hit");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function coverNotReady(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
  if (coverCacheEnabled() && !coverWarmReady) {
    res.setHeader("Retry-After", "2");
    res.status(503).json({ error: "Starting up" });
    return;
  }
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

/** Serves a baked masked JPEG. Does not bake. Never sets a card id header. */
// ---------------------------------------------------------------------------
// Hot-path caches for GET /api/sets/:setId/covers/:slot.
// Masks are baked ahead of time into the warm sidecar dir (never rendered on
// the request path). These caches remove the per-request DB work and disk
// reads that made a cold /sets load (about 80 parallel covers) take 9s and
// fail with 500/502.
// ---------------------------------------------------------------------------
const COVER_IDS_TTL_MS = 60_000;
const COVER_IDS_SHORT_TTL_MS = 5_000;
/** Until the first full warm pass finishes, a not-ready cover is 503 + Retry-After, never 404. */
let coverWarmReady = false;
let resolveWarmReady: () => void = () => {};
const coverWarmReadyPromise = new Promise<void>((r) => { resolveWarmReady = r; });
export function setCoverWarmReadyForTests(v: boolean): void { coverWarmReady = v; if (v) resolveWarmReady(); }
/** Max time the set list waits at boot for the first warm pass. */
const LIST_WARM_WAIT_MS = 20_000;
/** Last non-empty cover list per set. The set list never drops to empty while one exists. */
const lastGoodCovers = new Map<string, string[]>();
export function clearLastGoodCoversForTests(): void { lastGoodCovers.clear(); }
const COVER_BYTES_MAX = 600;
const COVER_RESOLVE_CONCURRENCY = 4;
const coverIdsCache = new Map<string, { at: number; ids: Promise<string[]> }>();
const coverBytes = new Map<string, { mtimeMs: number; buf: Buffer }>();
let resolveActive = 0;
const resolveQueue: Array<() => void> = [];

async function withResolveSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (resolveActive >= COVER_RESOLVE_CONCURRENCY) {
    await new Promise<void>((resolve) => resolveQueue.push(resolve));
  }
  resolveActive++;
  try {
    return await fn();
  } finally {
    resolveActive--;
    resolveQueue.shift()?.();
  }
}

function coverCacheEnabled(): boolean {
  if (process.env.SET_COVER_CACHE === "1") return true;
  if (process.env.SET_COVER_CACHE === "0") return false;
  return process.env.NODE_ENV !== "test";
}

/** Cached, de-duplicated, concurrency-capped cover id lookup for one set. */
export function cachedCoverCardIds(setId: string): Promise<string[]> {
  if (!coverCacheEnabled()) return readyCoverCardIds([setId]).then((m) => m.get(setId) ?? []);
  if (!coverWarmReady) readyIndex = null; // startup: never trust a ready index built before the backfill
  const hit = coverIdsCache.get(setId);
  if (hit && Date.now() - hit.at < COVER_IDS_TTL_MS) return hit.ids;
  const ids = withResolveSlot(async () => (await readyCoverCardIds([setId])).get(setId) ?? []);
  coverIdsCache.set(setId, { at: Date.now(), ids });
  ids.then((list) => {
    // Never pin an empty or partial list: at boot the mask sidecar can still be
    // warming, and a cached empty list 404'd 1990 Hoops covers for a minute.
    if (list.length < SET_COVER_SLOT_COUNT && coverIdsCache.get(setId)?.ids === ids) {
      coverIdsCache.set(setId, { at: Date.now() - COVER_IDS_TTL_MS + COVER_IDS_SHORT_TTL_MS, ids });
    }
    if (list.length === 0 && coverIdsCache.get(setId)?.ids === ids) coverIdsCache.delete(setId);
  }, () => { if (coverIdsCache.get(setId)?.ids === ids) coverIdsCache.delete(setId); });
  return ids;
}

/** In-memory cover bytes keyed by file path, revalidated by mtime. LRU by insertion. */
async function coverFileBytes(file: string): Promise<Buffer> {
  if (!coverCacheEnabled()) return readFile(file);
  const mtimeMs = statSync(file).mtimeMs;
  const hit = coverBytes.get(file);
  if (hit && hit.mtimeMs === mtimeMs) {
    coverBytes.delete(file);
    coverBytes.set(file, hit);
    return hit.buf;
  }
  const buf = await readFile(file);
  coverBytes.set(file, { mtimeMs, buf });
  while (coverBytes.size > COVER_BYTES_MAX) {
    const oldest = coverBytes.keys().next().value;
    if (oldest === undefined) break;
    coverBytes.delete(oldest);
  }
  return buf;
}

// Resized webp variants of the baked masked JPEG. Downscale only, never a crop,
// so the mask band stays exactly where the bake put it.
const COVER_VARIANT_MAX = 2000;
const coverVariants = new Map<string, Promise<Buffer>>();
export function coverVariantBytes(file: string, mtimeMs: number, width: number, source: () => Promise<Buffer>): Promise<Buffer> {
  const key = `${file}|${mtimeMs}|${width}`;
  const hit = coverVariants.get(key);
  if (hit) {
    coverVariants.delete(key);
    coverVariants.set(key, hit);
    return hit;
  }
  const made = source().then((buf) =>
    sharp(buf).resize({ width, withoutEnlargement: true }).webp({ quality: 74, effort: 4 }).toBuffer(),
  );
  coverVariants.set(key, made);
  made.catch(() => coverVariants.delete(key));
  while (coverVariants.size > COVER_VARIANT_MAX) {
    const oldest = coverVariants.keys().next().value;
    if (oldest === undefined) break;
    coverVariants.delete(oldest);
  }
  return made;
}

export function clearSetCoverCaches(): void {
  coverVariants.clear();
  coverIdsCache.clear();
  coverBytes.clear();
}

/** Boot + periodic warm: resolve every public set's covers in one batch and preload bytes. */
export async function warmSetCoverCache(): Promise<{ sets: number; files: number }> {
  const rows = await db
    .select({ id: gameSets.id })
    .from(gameSets)
    .where(and(eq(gameSets.isActive, true), eq(gameSets.isUserCreated, false)));
  const setIds = rows.map((row) => row.id).filter((id) => isMaskSetUuid(id));
  readyIndex = null; // re-read the sidecar dir each pass
  const resolved = await readyCoverCardIds(setIds);
  let files = 0;
  const now = Date.now();
  for (const setId of setIds) {
    const ids = resolved.get(setId) ?? [];
    if (ids.length >= SET_COVER_SLOT_COUNT) coverIdsCache.set(setId, { at: now, ids: Promise.resolve(ids) });
    else coverIdsCache.delete(setId);
    for (const cardId of ids) {
      const file = resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId);
      if (!file) continue;
      try { await coverFileBytes(file); files++; } catch { /* served from disk on demand */ }
    }
  }
  coverWarmReady = true;
  resolveWarmReady();
  return { sets: setIds.length, files };
}

export function startSetCoverWarmer(intervalMs = 50_000): void {
  void (async () => {
    // Wait for the boot sidecar backfill so the first pass sees every ready mask.
    const { warmSidecarReady } = await import("../startup/warmSidecarBackfill");
    if (warmSidecarReady) {
      await Promise.race([warmSidecarReady, new Promise((r) => setTimeout(r, 180_000).unref())]);
    }
    startSetCoverWarmLoop(intervalMs);
  })();
}

function startSetCoverWarmLoop(intervalMs: number): void {
  const run = () => {
    void warmSetCoverCache()
      .then(({ sets, files }) => console.log(`[SetCovers] warm cache sets=${sets} files=${files}`))
      .catch(() => console.error("[SetCovers] warm cache failed"));
  };
  run();
  setInterval(run, intervalMs).unref();
}

const PLAQUE_FALLBACK_SECRET = randomBytes(32).toString("hex");
function plaqueSecret(): string {
  return process.env.SESSION_SECRET || process.env.JWT_SECRET || PLAQUE_FALLBACK_SECRET;
}
const plaqueCache = new Map<string, string[]>();

/** Rank key: HMAC of the day seed and a label. Same inputs, same order, every call. */
function plaqueRank(seed: string, label: string): string {
  return createHmac("sha256", seed).update(label).digest("hex");
}

/**
 * Four names for a cover slot, fixed per set, slot, card and CT day. The wrong
 * names never re-roll between calls (Design QA RED Oct 14: the name that
 * repeated across calls was the answer). Seeded by an HMAC with a server
 * secret so the order cannot be precomputed.
 */
export async function plaqueOptions(setId: string, slot: number, cardId: string, day = getPackptsDayKey()): Promise<string[]> {
  const key = `${setId}|${slot}|${day}|${cardId}`;
  const hit = plaqueCache.get(key);
  if (hit) return hit;
  const [card] = await db.select({ player: playableCards.player }).from(playableCards).where(eq(playableCards.id, cardId)).limit(1);
  const rows = await db.select({ player: playableCards.player }).from(playableCards).where(eq(playableCards.gameSetId, setId)).orderBy(asc(playableCards.id)).limit(2000);
  const answer = card?.player?.trim();
  if (!answer) return [];
  const seed = createHmac("sha256", plaqueSecret()).update(key).digest("hex");
  const names = [...new Set(rows.map((row) => row.player?.trim()).filter((name): name is string => !!name && name !== answer))]
    .sort((a, b) => plaqueRank(seed, `w|${a}`).localeCompare(plaqueRank(seed, `w|${b}`)));
  if (names.length < 3) return [];
  const options = [answer, ...names.slice(0, 3)]
    .sort((a, b) => plaqueRank(seed, `o|${a}`).localeCompare(plaqueRank(seed, `o|${b}`)));
  if (plaqueCache.size > 500) plaqueCache.clear();
  plaqueCache.set(key, options);
  return options;
}

/**
 * JSON for the home hero: the scan-specific public mask plan and four names,
 * exactly like pre-answer gameplay. No card id, no answer index. Moved out of
 * image response headers (Design QA cheat-leak RED, Oct 14).
 */
export async function handlePublicSetCoverPlaque(req: Request, res: Response): Promise<void> {
  applyNoStoreHeaders(res);
  await (coverCacheEnabled() ? ensureHeldSetsFresh() : ensureHeldSets());
  const setId = req.params.setId;
  const slot = Number(req.params.slot);
  if (isHeldSet(setId) || setsCoversDisabled() || !isMaskSetUuid(setId) || !Number.isInteger(slot) || slot < 0 || slot >= SET_COVER_SLOT_COUNT) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    const cardId = (await cachedCoverCardIds(setId))[slot];
    if (!cardId) { res.status(404).json({ error: "Not found" }); return; }
    const planFile = path.join(maskReadySidecarDir(), warmMaskPlanFilename(cardId));
    let maskPlan = null;
    try { maskPlan = toPublicMaskPlan(JSON.parse(readFileSync(planFile, "utf8"))); } catch { /* fails closed below */ }
    if (!maskPlan) { res.status(404).json({ error: "Not found" }); return; }
    const options = await plaqueOptions(setId, slot, cardId);
    if (options.length !== 4) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ maskPlan, options });
  } catch {
    console.error(`[Sets] plaque error set=${setId} slot=${slot}`);
    if (!res.headersSent) res.status(500).json({ error: "Failed to load" });
  }
}

export async function handlePublicSetCover(req: Request, res: Response): Promise<void> {
  if (coverCacheEnabled()) await ensureHeldSetsFresh();
  else await ensureHeldSets();
  if (isHeldSet(req.params.setId)) {
    coverHidden(req, res);
    return;
  }
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
    const cardId = (await cachedCoverCardIds(setId))[slot];
    const file = cardId ? resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId) : null;
    if (!file || !cardId) {
      coverNotReady(res);
      return;
    }


    const baseEtag = setCoverEtag(setId, slot, cardId);
    const wRaw = Number(req.query.w);
    const width = (SET_COVER_WIDTHS as readonly number[]).includes(wRaw) ? wRaw : null;
    const webp = width !== null;
    const versioned = typeof req.query.v === "string" && req.query.v === setCoverVersionFromEtag(baseEtag);
    const etag = webp ? `"${baseEtag.replace(/"/g, "")}-w${width}"` : baseEtag;
    if (req.headers["if-none-match"] === etag) {
      setCoverHeaders(res, etag, cardId, { webp, versioned });
      res.status(304).end();
      return;
    }

    setCoverHeaders(res, etag, cardId, { webp, versioned });
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }

    if (webp) {
      let out: Buffer | null = null;
      try {
        out = await coverVariantBytes(file, statSync(file).mtimeMs, width!, () => coverFileBytes(file));
      } catch { out = null; }
      if (out) {
        res.setHeader("Content-Length", String(out.length));
        res.end(out);
        return;
      }
      // Resize failed: fall back to the full masked JPEG.
      setCoverHeaders(res, baseEtag, cardId, { versioned: false });
    }

    let buf: Buffer | null = null;
    try { buf = await coverFileBytes(file); } catch { buf = null; }
    if (buf) {
      res.setHeader("Content-Length", String(buf.length));
      res.end(buf);
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
