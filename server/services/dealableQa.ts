/**
 * Design sweep of every card a deal can draw.
 * The card WHERE clause is eligibleDealFilter. Blocklist, surname
 * exclusions, and current-mask fail sidecars stay in that filter.
 * This file does not restate them.
 */
import { existsSync } from "fs";
import path from "path";
import { and, asc, eq, sql } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { maskReadySidecarDir } from "../masking/maskReadySidecar";
import { getMaskedImagePath } from "../masking/maskingService";
import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";
import { resolveReadyWarmMaskedFile } from "../startup/warmMaskGate";
import { coverBandPlacement } from "./setCovers";
import { eligibleDealFilter } from "./playableSetEligibility";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export function dealablePageLimit(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

export function dealablePageOffset(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n;
}

function safeCardId(cardId: string): boolean {
  return Boolean(cardId)
    && cardId.length <= 100
    && !cardId.includes("/")
    && !cardId.includes("\\")
    && !cardId.includes("..")
    && !cardId.includes("\0");
}

function maskedJpegName(cardId: string, name: string): boolean {
  const id = cardId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const version = CURRENT_MASK_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${id}_${version}(?:_r(?:90|180|270))?\\.jpg$`).test(name);
}

function fileInside(dir: string, name: string): string | null {
  const root = path.resolve(dir);
  const full = path.resolve(dir, name);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!existsSync(full)) return null;
  return full;
}

export interface DealableCardRow {
  cardId: string;
  player: string | null;
  number: string | null;
  variant: string | null;
  bandPlacement: string | null;
  baked: boolean;
}

export interface DealableCardPage {
  setId: string;
  setName: string;
  maskVersion: string;
  total: number;
  offset: number;
  limit: number;
  cards: DealableCardRow[];
}

export interface ActiveDealableSet {
  setId: string;
  setName: string;
  total: number;
}

const activeIntegrated = and(eq(gameSets.isActive, true), eq(gameSets.isUserCreated, false));

/** Active integrated sets and how many cards eligibleDealFilter keeps in each. */
export async function listActiveDealableSets(): Promise<ActiveDealableSet[]> {
  const rows = await db
    .select({
      setId: gameSets.id,
      setName: gameSets.setName,
      total: sql<number>`count(playable_cards.id)::int`,
    })
    .from(gameSets)
    .leftJoin(
      playableCards,
      and(eq(playableCards.gameSetId, gameSets.id), eligibleDealFilter("playable_cards")),
    )
    .where(activeIntegrated)
    .groupBy(gameSets.id, gameSets.setName)
    .orderBy(asc(gameSets.setName), asc(gameSets.id));
  return rows.map((row) => ({
    setId: row.setId,
    setName: row.setName,
    total: Number(row.total) || 0,
  }));
}

/** One page of the deal pool for an active integrated set. Null when that set is not on the shelf. */
export async function listDealableCards(
  setId: string,
  offset: number,
  limit: number,
): Promise<DealableCardPage | null> {
  const [set] = await db
    .select({ id: gameSets.id, setName: gameSets.setName })
    .from(gameSets)
    .where(and(eq(gameSets.id, setId), activeIntegrated))
    .limit(1);
  if (!set) return null;

  const where = and(eq(playableCards.gameSetId, setId), eligibleDealFilter("playable_cards"));
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(playableCards)
    .where(where);
  const rows = await db
    .select({
      id: playableCards.id,
      player: playableCards.player,
      number: playableCards.number,
      variant: playableCards.variant,
    })
    .from(playableCards)
    .where(where)
    .orderBy(asc(playableCards.number), asc(playableCards.id))
    .limit(limit)
    .offset(offset);

  const dir = maskReadySidecarDir();
  return {
    setId: set.id,
    setName: set.setName,
    maskVersion: CURRENT_MASK_VERSION,
    total: Number(countRow?.total) || 0,
    offset,
    limit,
    cards: rows.map((row) => ({
      cardId: row.id,
      player: row.player,
      number: row.number,
      variant: row.variant,
      bandPlacement: coverBandPlacement(row.id),
      baked: resolveReadyWarmMaskedFile(dir, row.id) != null,
    })),
  };
}

/** True when this card id is in the deal pool. */
export async function isDealableCard(cardId: string): Promise<boolean> {
  if (!safeCardId(cardId)) return false;
  const [row] = await db
    .select({ id: playableCards.id })
    .from(playableCards)
    .where(and(eq(playableCards.id, cardId), eligibleDealFilter("playable_cards")))
    .limit(1);
  return Boolean(row);
}

/**
 * v4.6 masked JPEG for a dealable card.
 * A ready sidecar is served as-is. Otherwise the normal bake path runs
 * (getMaskedImagePath: shared queue, timeout, concurrency cap).
 * Null means there is no masked file to send. Callers must not fall back to the scan.
 */
export async function dealableMaskedFile(cardId: string): Promise<string | null> {
  if (!safeCardId(cardId)) return null;
  if (!(await isDealableCard(cardId))) return null;

  const ready = resolveReadyWarmMaskedFile(maskReadySidecarDir(), cardId);
  if (ready) return ready;

  const name = await getMaskedImagePath(cardId);
  const base = name ? path.basename(name) : "";
  if (!base || !maskedJpegName(cardId, base)) return null;
  return fileInside(maskReadySidecarDir(), base) ?? fileInside(MASKED_CARDS_DIR, base);
}
