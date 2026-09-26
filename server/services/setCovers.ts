/**
 * Public set covers walk Design picks, then alternates, and keep the first valid cards.
 * Never bakes. The public list never returns a raw photo URL, a player name, or a card id.
 * A served JPEG sets X-Card-Id and X-Mask-Version.
 * QA lists the pins and the old auto picker so Design can compare them.
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
import {
  listedPinnedCoverEntries,
  listedPinnedCoverIds,
  MAX_PINNED_COVERS,
  PINNED_SET_COVERS,
  type CoverListRole,
  type ListedCover,
} from "../config/pinnedCovers";
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
