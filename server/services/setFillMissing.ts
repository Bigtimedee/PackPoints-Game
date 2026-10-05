/**
 * Additive "fill missing cards" import for one integrated set.
 *
 * The admin import upserts every Card Hedge row (it rewrites image_url on rows
 * that are already approved or pinned as covers), and purge-reimport deletes
 * the set's cards, which wipes card_review_approvals and the pinned cover ids.
 * This path only INSERTs Card Hedge cards that the set does not have yet.
 * Existing rows are never updated or deleted.
 *
 * Every inserted row is new, so the card review guard holds it as
 * awaiting_card_review until Design approves the id. Nothing here approves.
 *
 * Exclusions are applied before insert, so these rows never land:
 * PSA slab photos (hometown.jpg), checklists and other classifier rejects,
 * off-set rows, non-base variants, numbers outside the base run, a number the
 * set already has, and the per-set player denylist (1987 Donruss: Cal Ripken,
 * facsimile signature on the wristband; Roberto Clemente, not in the set).
 */
import { and, eq, sql } from "drizzle-orm";
import { cardhedgeImportRuns, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { DONRUSS_1987_HOLD_ID } from "../config/heldSets";
import { classifyCard } from "./cardClassifier";
import { cardDetails, cardSearch, normalizeImageUrl, type CardHedgeCard } from "./cardhedge/client";

export interface FillMissingSetConfig {
  /** Base-set card numbers run 1..baseCount. */
  baseCount: number;
  /** Player text that must never be imported into this set (lowercase regex). */
  playerDenylist: { pattern: RegExp; reason: string }[];
}

export const FILL_MISSING_SETS: Record<string, FillMissingSetConfig> = {
  [DONRUSS_1987_HOLD_ID]: {
    baseCount: 660,
    playerDenylist: [
      { pattern: /\bripken\b/i, reason: "denylist_ripken_wristband_signature" },
      { pattern: /\bclemente\b/i, reason: "denylist_off_set_clemente" },
    ],
  },
};

export type FillQuery = { set?: string; search?: string; player?: string };

export interface FillMissingOptions {
  dryRun: boolean;
  /** Look up card-details for a candidate with no image in search. */
  details: boolean;
  queries?: FillQuery[];
  /** Extra Card Hedge set names accepted as this set (besides the existing rows' set name). */
  acceptSets?: string[];
}

export interface FillCandidate {
  cardhedgeCardId: string;
  number: string | null;
  player: string | null;
  variant: string | null;
  set: string | null;
  imageUrl: string | null;
  imageFrom: "search" | "details" | null;
}

export interface FillMissingReport {
  setId: string;
  dryRun: boolean;
  canonicalSet: string | null;
  queries: FillQuery[];
  existing: { rows: number; baseNumbers: number };
  fetched: number;
  distinctFetched: number;
  setsSeen: Record<string, number>;
  variantsSeen: Record<string, number>;
  skipped: Record<string, number>;
  excluded: { cardhedgeCardId: string; number: string | null; player: string | null; reason: string }[];
  detailsLookups: number;
  detailsImagesFound: number;
  candidates: FillCandidate[];
  inserted: { id: string; cardhedgeCardId: string; number: string | null; player: string | null }[];
  insertConflicts: number;
  missingNumbers: number[];
  existingFlagged: { id: string; number: string | null; player: string | null; reason: string }[];
  totalRowsAfter: number | null;
  importRunId: string | null;
}

const MAX_QUERIES = 8;
const MAX_PAGES = 30;
const PAGE_SIZE = 100;
const MAX_DETAILS = 500;

export function normalizeBaseNumber(raw: string | null | undefined): number | null {
  const text = (raw || "").trim().replace(/^#/, "");
  if (!/^\d{1,4}$/.test(text)) return null;
  const n = Number(text);
  return Number.isInteger(n) ? n : null;
}

function isBaseVariant(variant: string | null | undefined): boolean {
  const v = (variant || "").trim().toLowerCase();
  return v === "" || v === "base";
}

function normSet(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** PSA slab photo: cert label prints the player name above the mask band. */
export function isSlabPhoto(imageUrl: string | null | undefined): boolean {
  return /hometown\.jpe?g(\?|$)/i.test(imageUrl || "");
}

/**
 * Why this Card Hedge row must not be imported, or null.
 * Pure; the caller supplies the set context.
 */
export function fillExclusionReason(
  card: { player?: string | null; description?: string | null; set?: string | null; variant?: string | null; number?: string | null; category?: string | null },
  ctx: { sport: string; canonicalSet: string | null; config: FillMissingSetConfig; acceptSets?: string[] },
): string | null {
  if ((card.category || "").trim().toLowerCase() !== ctx.sport.toLowerCase()) return "wrong_sport";
  if (ctx.canonicalSet && normSet(card.set) !== normSet(ctx.canonicalSet)
    && !(ctx.acceptSets ?? []).some((name) => normSet(name) === normSet(card.set))) return "off_set";
  if (!isBaseVariant(card.variant)) return "not_base";
  const n = normalizeBaseNumber(card.number);
  if (n == null || n < 1 || n > ctx.config.baseCount) return "bad_number";
  if (!card.player || !card.player.trim()) return "no_player";
  const cls = classifyCard({ player: card.player, description: card.description });
  if (!cls.isPlayable) return `classifier_${cls.blockedReason || "rejected"}`;
  for (const rule of ctx.config.playerDenylist) {
    if (rule.pattern.test(card.player)) return rule.reason;
  }
  return null;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

export function sanitizeQueries(raw: unknown): FillQuery[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_QUERIES) return null;
  const out: FillQuery[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const q: FillQuery = {};
    for (const key of ["set", "search", "player"] as const) {
      const v = (item as Record<string, unknown>)[key];
      if (v === undefined) continue;
      if (typeof v !== "string" || !v.trim() || v.length > 100) return null;
      q[key] = v.trim();
    }
    if (!q.set && !q.search && !q.player) return null;
    out.push(q);
  }
  return out;
}

export function sanitizeAcceptSets(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_QUERIES) return null;
  if (!raw.every((v) => typeof v === "string" && v.trim().length > 0 && v.length <= 100)) return null;
  return (raw as string[]).map((v) => v.trim());
}

export async function fillMissingCards(setId: string, opts: FillMissingOptions): Promise<FillMissingReport> {
  const config = FILL_MISSING_SETS[setId];
  if (!config) throw new Error("fill-missing not enabled for this set");
  const [gameSet] = await db.select().from(gameSets).where(eq(gameSets.id, setId)).limit(1);
  if (!gameSet || !gameSet.cardhedgeSetQuery) throw new Error("set not found or has no Card Hedge query");

  const existingRows = await db
    .select({ id: playableCards.id, cardhedgeCardId: playableCards.cardhedgeCardId, number: playableCards.number,
      variant: playableCards.variant, player: playableCards.player, set: playableCards.set, imageUrl: playableCards.imageUrl })
    .from(playableCards)
    .where(eq(playableCards.gameSetId, setId));
  const existingIds = new Set(existingRows.map((r) => r.cardhedgeCardId));
  const haveNumbers = new Set<number>();
  const setCounts: Record<string, number> = {};
  for (const row of existingRows) {
    if (row.set) bump(setCounts, row.set);
    const n = normalizeBaseNumber(row.number);
    if (n != null && isBaseVariant(row.variant)) haveNumbers.add(n);
  }
  const canonicalSet = Object.entries(setCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const existingFlagged: FillMissingReport["existingFlagged"] = [];
  for (const row of existingRows) {
    let reason: string | null = null;
    if (isSlabPhoto(row.imageUrl)) reason = "psa_slab_photo";
    else if (canonicalSet && normSet(row.set) !== normSet(canonicalSet)) reason = "off_set";
    else {
      const cls = classifyCard({ player: row.player, description: null });
      if (!cls.isPlayable) reason = `classifier_${cls.blockedReason || "rejected"}`;
      else reason = config.playerDenylist.find((rule) => rule.pattern.test(row.player || ""))?.reason ?? null;
    }
    if (reason) existingFlagged.push({ id: row.id, number: row.number, player: row.player, reason });
  }

  const queries: FillQuery[] = opts.queries ?? [{ set: gameSet.cardhedgeSetQuery }];
  const byId = new Map<string, CardHedgeCard>();
  let fetched = 0;
  for (const q of queries) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      // Same request shape as the admin import: only the keys that are set.
      const result = await cardSearch({
        ...(q.set ? { set: q.set } : {}),
        ...(q.search ? { search: q.search } : {}),
        ...(q.player ? { player: q.player } : {}),
        category: gameSet.cardhedgeCategory || undefined,
        page,
        page_size: PAGE_SIZE,
      });
      const cards = result.cards || [];
      fetched += cards.length;
      for (const card of cards) {
        if (!card.card_id) continue;
        const prior = byId.get(card.card_id);
        if (!prior || (!normalizeImageUrl(prior.image) && normalizeImageUrl(card.image))) byId.set(card.card_id, card);
      }
      const pages = result.pages ?? (cards.length === PAGE_SIZE ? page + 1 : page);
      if (cards.length === 0 || page >= pages) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const setsSeen: Record<string, number> = {};
  const variantsSeen: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const excluded: FillMissingReport["excluded"] = [];
  const pending: FillCandidate[] = [];
  const claimed = new Set<number>(haveNumbers);
  for (const card of byId.values()) {
    bump(setsSeen, card.set || "(none)");
    bump(variantsSeen, card.variant || "(none)");
    if (existingIds.has(card.card_id!)) { bump(skipped, "already_in_set"); continue; }
    const reason = fillExclusionReason(card, { sport: gameSet.sport, canonicalSet, config, acceptSets: opts.acceptSets });
    if (reason) {
      bump(skipped, reason);
      if (!["wrong_sport", "off_set", "not_base", "bad_number"].includes(reason)) {
        excluded.push({ cardhedgeCardId: card.card_id!, number: card.number ?? null, player: card.player ?? null, reason });
      }
      continue;
    }
    pending.push({ cardhedgeCardId: card.card_id!, number: card.number ?? null, player: card.player ?? null,
      variant: card.variant ?? null, set: card.set ?? null, imageUrl: normalizeImageUrl(card.image), imageFrom: normalizeImageUrl(card.image) ? "search" : null });
  }

  // Prefer a row that already has an image when two rows share a number.
  pending.sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)));
  let detailsLookups = 0;
  let detailsImagesFound = 0;
  const candidates: FillCandidate[] = [];
  for (const cand of pending) {
    const n = normalizeBaseNumber(cand.number)!;
    if (claimed.has(n)) { bump(skipped, "number_already_in_set"); continue; }
    if (!cand.imageUrl && opts.details && detailsLookups < MAX_DETAILS) {
      detailsLookups++;
      try {
        const res = await cardDetails({ card_id: cand.cardhedgeCardId });
        const img = normalizeImageUrl(res.cards?.[0]?.image);
        if (img) { cand.imageUrl = img; cand.imageFrom = "details"; detailsImagesFound++; }
      } catch { /* leave missing */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!cand.imageUrl) { bump(skipped, "missing_image"); continue; }
    if (!cand.imageUrl.startsWith("https://")) { bump(skipped, "bad_url"); continue; }
    if (isSlabPhoto(cand.imageUrl)) {
      bump(skipped, "psa_slab_photo");
      excluded.push({ cardhedgeCardId: cand.cardhedgeCardId, number: cand.number, player: cand.player, reason: "psa_slab_photo" });
      continue;
    }
    claimed.add(n);
    candidates.push(cand);
  }
  candidates.sort((a, b) => normalizeBaseNumber(a.number)! - normalizeBaseNumber(b.number)!);
  const missingNumbers: number[] = [];
  for (let i = 1; i <= config.baseCount; i++) if (!claimed.has(i)) missingNumbers.push(i);

  const report: FillMissingReport = {
    setId, dryRun: opts.dryRun, canonicalSet, queries,
    existing: { rows: existingRows.length, baseNumbers: haveNumbers.size },
    fetched, distinctFetched: byId.size, setsSeen, variantsSeen, skipped, excluded,
    detailsLookups, detailsImagesFound, candidates, inserted: [], insertConflicts: 0,
    missingNumbers, existingFlagged, totalRowsAfter: null, importRunId: null,
  };
  if (opts.dryRun || candidates.length === 0) return report;

  const [run] = await db.insert(cardhedgeImportRuns)
    .values({ gameSetId: setId, status: "RUNNING", pageSize: PAGE_SIZE })
    .returning({ id: cardhedgeImportRuns.id });
  report.importRunId = run.id;
  const byCh = new Map(candidates.map((c) => [c.cardhedgeCardId, c]));
  for (const cand of candidates) {
    const card = byId.get(cand.cardhedgeCardId)!;
    const rows = await db.insert(playableCards).values({
      gameSetId: setId,
      cardhedgeCardId: cand.cardhedgeCardId,
      description: card.description,
      player: card.player,
      set: card.set,
      number: card.number,
      variant: card.variant,
      imageUrl: cand.imageUrl,
      category: card.category,
      rookie: card.rookie,
      isPlayable: true,
      blockedReason: null,
    }).onConflictDoNothing({ target: playableCards.cardhedgeCardId })
      .returning({ id: playableCards.id, cardhedgeCardId: playableCards.cardhedgeCardId });
    if (rows[0]) {
      const c = byCh.get(rows[0].cardhedgeCardId)!;
      report.inserted.push({ id: rows[0].id, cardhedgeCardId: c.cardhedgeCardId, number: c.number, player: c.player });
    } else {
      report.insertConflicts++;
    }
  }
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(playableCards).where(eq(playableCards.gameSetId, setId));
  report.totalRowsAfter = Number(count?.n) || 0;
  await db.update(gameSets).set({ cardsImportedCount: report.totalRowsAfter, lastImportAt: new Date() }).where(eq(gameSets.id, setId));
  await db.update(cardhedgeImportRuns)
    .set({ status: "SUCCESS", finishedAt: new Date(), cardsImported: report.inserted.length })
    .where(and(eq(cardhedgeImportRuns.id, run.id)));
  return report;
}
