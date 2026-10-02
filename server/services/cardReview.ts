/**
 * Per-card review records for integrated sets. See server/lib/cardReviewGuard.ts.
 *
 * Seed: once, at the first boot of the guard, every card that any deal path can
 * draw right now is approved with source 'seed'. Every deal path (solo, Daily 5,
 * matches, replacements, covers) requires is_playable, a clear mask name check
 * and the blocklist, so that predicate is a superset of every pool and no live
 * count changes. Held sets are not dealable now, so their cards are not seeded.
 *
 * After the seed, a card outside card_review_approvals is held with
 * awaiting_card_review. Design lists those cards and approves explicit ids
 * through the X-QA-Token routes. There is no approve-all.
 */
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { cardReviewApprovals, cardReviewSeed, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { ensureHeldSets } from "../config/heldSets";
import { cardNotBlockedSql } from "../lib/cardBlocklist";
import {
  CARD_REVIEW_REASON,
  cardReviewApprovedClause,
  cardReviewGuardEnabled,
  setCardReviewGuardEnabled,
} from "../lib/cardReviewGuard";
import { maskNameStillCovered } from "./playableSetEligibility";

export { CARD_REVIEW_REASON };

export const CARD_REVIEW_SEED_ID = "v1";
const SEED_LOCK_KEY = 7_204_311_902;
export const MAX_APPROVE_BATCH = 500;

/**
 * Cards a deal path could draw if review were not required, in integrated sets.
 * ignoreHeldSets lists a held set's cards for Design (QA only).
 */
function drawableIgnoringReview(opts: { ignoreHeldSets: boolean }): SQL {
  return sql`
    playable_cards.is_playable = true
    AND ${maskNameStillCovered("playable_cards")}
    AND ${cardNotBlockedSql("playable_cards", { ignoreHeldSets: opts.ignoreHeldSets, ignoreCardReview: true })}
    AND game_sets.is_user_created = false
  `;
}

function notApproved(): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM card_review_approvals cra WHERE cra.card_id = playable_cards.id)`;
}

export async function cardReviewSeedRow(): Promise<{ seededAt: Date; cardCount: number } | null> {
  const [row] = await db
    .select({ seededAt: cardReviewSeed.seededAt, cardCount: cardReviewSeed.cardCount })
    .from(cardReviewSeed)
    .where(eq(cardReviewSeed.id, CARD_REVIEW_SEED_ID))
    .limit(1);
  return row ?? null;
}

/**
 * Runs the seed once. A later call, on this boot or any other, sees the seed
 * row and inserts nothing. Two processes serialize on an advisory lock.
 */
export async function ensureCardReviewSeed(): Promise<{ seeded: boolean; cardCount: number }> {
  await ensureHeldSets();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`);
    const [existing] = await tx
      .select({ cardCount: cardReviewSeed.cardCount })
      .from(cardReviewSeed)
      .where(eq(cardReviewSeed.id, CARD_REVIEW_SEED_ID))
      .limit(1);
    if (existing) return { seeded: false, cardCount: existing.cardCount };
    const inserted = await tx.execute(sql`
      INSERT INTO card_review_approvals (card_id, game_set_id, source, approved_by, note)
      SELECT playable_cards.id, playable_cards.game_set_id, 'seed', 'boot-seed', 'dealable at first boot of the card review guard'
      FROM playable_cards
      INNER JOIN game_sets ON game_sets.id = playable_cards.game_set_id
      WHERE ${drawableIgnoringReview({ ignoreHeldSets: false })}
      ON CONFLICT (card_id) DO NOTHING
    `);
    const cardCount = Number(inserted.rowCount ?? 0);
    await tx.insert(cardReviewSeed).values({ id: CARD_REVIEW_SEED_ID, cardCount });
    return { seeded: true, cardCount };
  });
}

/**
 * Boot: seed if needed, then turn the guard on for this process. Routes are not
 * registered yet. A seed that keeps failing exits so no route serves unguarded.
 */
export async function cardReviewTablesExist(): Promise<boolean> {
  const result = await db.execute<{ approvals: string | null; seed: string | null }>(sql`
    SELECT to_regclass('public.card_review_approvals')::text AS approvals,
           to_regclass('public.card_review_seed')::text AS seed
  `);
  const row = result.rows?.[0];
  return Boolean(row?.approvals && row?.seed);
}

export async function bootCardReviewGuard(opts?: { attempts?: number; exit?: (code: number) => never }): Promise<void> {
  const attempts = Math.max(1, opts?.attempts ?? 3);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // A skipped schema push (failed pg_dump) boots on the old schema by design.
      // Nothing can be approved without the tables, so keep today's behavior and
      // let the next boot with a successful push seed and enable the guard.
      if (!(await cardReviewTablesExist())) {
        setCardReviewGuardEnabled(false);
        console.error("[CardReview] ERROR: card_review tables missing (schema push skipped?). Guard stays off until a boot with the tables.");
        return;
      }
      const result = await ensureCardReviewSeed();
      setCardReviewGuardEnabled(true);
      const awaiting = await countAwaitingReview().catch(() => null);
      console.log(
        `[CardReview] guard=on seed=${result.seeded ? "created" : "existing"} seeded_cards=${result.cardCount}`
        + ` awaiting=${awaiting == null ? "unknown" : awaiting.total}`,
      );
      return;
    } catch (error) {
      lastError = error;
      console.error(`[CardReview] seed attempt ${attempt}/${attempts} failed:`, error instanceof Error ? error.message : error);
    }
  }
  console.error("[CardReview] FATAL: card review seed failed. Exiting so no route deals unreviewed cards.", lastError instanceof Error ? lastError.message : lastError);
  (opts?.exit ?? ((code: number) => process.exit(code)))(1);
}

export interface AwaitingReviewSet {
  setId: string;
  setName: string;
  isActive: boolean;
  awaiting: number;
}

export async function countAwaitingReview(): Promise<{ total: number; sets: AwaitingReviewSet[] }> {
  await ensureHeldSets();
  const rows = await db
    .select({
      setId: gameSets.id,
      setName: gameSets.setName,
      isActive: gameSets.isActive,
      awaiting: sql<number>`count(*)::int`,
    })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(and(drawableIgnoringReview({ ignoreHeldSets: true }), notApproved()))
    .groupBy(gameSets.id, gameSets.setName, gameSets.isActive)
    .orderBy(asc(gameSets.setName), asc(gameSets.id));
  const sets = rows.map((row) => ({
    setId: row.setId,
    setName: row.setName,
    isActive: Boolean(row.isActive),
    awaiting: Number(row.awaiting) || 0,
  }));
  return { total: sets.reduce((sum, row) => sum + row.awaiting, 0), sets };
}

export interface AwaitingReviewCard {
  cardId: string;
  player: string | null;
  number: string | null;
  variant: string | null;
  reason: typeof CARD_REVIEW_REASON;
  imagePath: string;
}

export async function listAwaitingReview(
  setId: string,
  offset: number,
  limit: number,
): Promise<{ setId: string; setName: string; total: number; offset: number; limit: number; cards: AwaitingReviewCard[] } | null> {
  await ensureHeldSets();
  const [set] = await db
    .select({ id: gameSets.id, setName: gameSets.setName })
    .from(gameSets)
    .where(and(eq(gameSets.id, setId), eq(gameSets.isUserCreated, false)))
    .limit(1);
  if (!set) return null;
  const where = and(eq(playableCards.gameSetId, setId), drawableIgnoringReview({ ignoreHeldSets: true }), notApproved());
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(where);
  const rows = await db
    .select({
      id: playableCards.id,
      player: playableCards.player,
      number: playableCards.number,
      variant: playableCards.variant,
    })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(where)
    .orderBy(asc(playableCards.number), asc(playableCards.id))
    .limit(limit)
    .offset(offset);
  return {
    setId: set.id,
    setName: set.setName,
    total: Number(countRow?.total) || 0,
    offset,
    limit,
    cards: rows.map((row) => ({
      cardId: row.id,
      player: row.player,
      number: row.number,
      variant: row.variant,
      reason: CARD_REVIEW_REASON,
      imagePath: `/api/qa/cover-image/${row.id}`,
    })),
  };
}

export interface ApproveResult {
  approved: string[];
  alreadyApproved: string[];
  refused: Array<{ cardId: string; reason: "not_found" | "not_awaiting_review" }>;
}

function cleanCardIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") return null;
    const id = value.trim();
    if (!id || id.length > 100) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (out.length === 0 || out.length > MAX_APPROVE_BATCH) return null;
  return out;
}

export function parseApproveBody(body: unknown): { cardIds: string[]; approvedBy: string | null; note: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  const cardIds = cleanCardIds(input.cardIds);
  if (!cardIds) return null;
  const text = (value: unknown, max: number): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };
  return { cardIds, approvedBy: text(input.approvedBy, 100), note: text(input.note, 500) };
}

/**
 * Approves explicit ids that are awaiting review now. A blocked, unplayable,
 * mask-refused, user-created or unknown card is refused and nothing is written
 * for it. An approval never overrides the blocklist at deal time either.
 */
export async function approveCards(input: { cardIds: string[]; approvedBy: string | null; note: string | null }): Promise<ApproveResult> {
  await ensureHeldSets();
  const ids = input.cardIds;
  const existing = await db
    .select({ id: playableCards.id })
    .from(playableCards)
    .where(inArray(playableCards.id, ids));
  const known = new Set(existing.map((row) => row.id));
  const approvedRows = await db
    .select({ id: cardReviewApprovals.cardId })
    .from(cardReviewApprovals)
    .where(inArray(cardReviewApprovals.cardId, ids));
  const already = new Set(approvedRows.map((row) => row.id));
  const awaitingRows = await db
    .select({ id: playableCards.id, gameSetId: playableCards.gameSetId })
    .from(playableCards)
    .innerJoin(gameSets, eq(gameSets.id, playableCards.gameSetId))
    .where(and(inArray(playableCards.id, ids), drawableIgnoringReview({ ignoreHeldSets: true }), notApproved()));
  const awaiting = new Map(awaitingRows.map((row) => [row.id, row.gameSetId]));

  const result: ApproveResult = { approved: [], alreadyApproved: [], refused: [] };
  const values: Array<typeof cardReviewApprovals.$inferInsert> = [];
  for (const id of ids) {
    if (already.has(id)) {
      result.alreadyApproved.push(id);
    } else if (!known.has(id)) {
      result.refused.push({ cardId: id, reason: "not_found" });
    } else if (!awaiting.has(id)) {
      result.refused.push({ cardId: id, reason: "not_awaiting_review" });
    } else {
      values.push({
        cardId: id,
        gameSetId: awaiting.get(id)!,
        source: "qa",
        approvedBy: input.approvedBy,
        note: input.note,
      });
    }
  }
  if (values.length > 0) {
    const inserted = await db
      .insert(cardReviewApprovals)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: cardReviewApprovals.cardId });
    const done = new Set(inserted.map((row) => row.id));
    for (const value of values) {
      if (done.has(value.cardId)) result.approved.push(value.cardId);
      else result.alreadyApproved.push(value.cardId);
    }
  }
  if (result.approved.length > 0) {
    console.log(`[CardReview] approved=${result.approved.length} by=${input.approvedBy ?? "unknown"} ids=${result.approved.map((id) => id.slice(0, 8)).join(",")}`);
    const { invalidatePublicMaskSetCache } = await import("./publicMaskGate");
    invalidatePublicMaskSetCache();
  }
  return result;
}

export async function cardReviewStatus(): Promise<{
  reason: string;
  guardEnabled: boolean;
  seededAt: string | null;
  seededCards: number | null;
  approvals: { seed: number; qa: number };
}> {
  const seed = await cardReviewSeedRow();
  const counts = await db
    .select({ source: cardReviewApprovals.source, n: sql<number>`count(*)::int` })
    .from(cardReviewApprovals)
    .groupBy(cardReviewApprovals.source);
  const by = new Map(counts.map((row) => [row.source, Number(row.n) || 0]));
  return {
    reason: CARD_REVIEW_REASON,
    guardEnabled: cardReviewGuardEnabled(),
    seededAt: seed ? seed.seededAt.toISOString() : null,
    seededCards: seed ? seed.cardCount : null,
    approvals: { seed: by.get("seed") ?? 0, qa: by.get("qa") ?? 0 },
  };
}

/** SQL text for callers that need the approved test in raw SQL. */
export { cardReviewApprovedClause };
