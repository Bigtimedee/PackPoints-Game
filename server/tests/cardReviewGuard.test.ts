/**
 * Per-card review guard. The first-boot seed approves every card dealable now,
 * so live counts do not move. A card that becomes playable afterwards in a
 * cleared set (refresh, re-import, new import) is not dealt until Design
 * approves it through the X-QA-Token route. Blocked cards stay blocked.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { cardReviewApprovals, cardReviewSeed, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { releaseSetsForTests } from "../config/heldSets";
import { cardNotBlockedSql } from "../lib/cardBlocklist";
import { cardReviewGuardEnabled, setCardReviewGuardEnabled } from "../lib/cardReviewGuard";
import { registerDealableQaRoutes } from "../routes/dealableQa";
import { restorePlayableIfMaskAllows } from "../services/cardPoolRefresh";
import {
  bootCardReviewGuard,
  CARD_REVIEW_REASON,
  CARD_REVIEW_SEED_ID,
  ensureCardReviewSeed,
} from "../services/cardReview";
import { loadDaily5Pool } from "../services/daily5Pool";
import { isDealableCard, listActiveDealableSets } from "../services/dealableQa";
import {
  eligibleCountsByActiveSet,
  eligibleCountsForSetIds,
  eligiblePlayableCardCountSql,
  maskNameStillCovered,
} from "../services/playableSetEligibility";
import { storage } from "../storage";

const TOKEN = `card-review-${randomUUID().slice(0, 8)}`;
const stamp = randomUUID().slice(0, 8);
// 1989 Fleer prefix: registered mask profile, and the Kevin Johnson blocklist rule.
const setId = `aea515e2-${randomUUID().slice(9)}`;
const userSetId = randomUUID();
const previousToken = process.env.COVER_QA_TOKEN;

const ids = {
  a: randomUUID(),
  b: randomUUID(),
  c: randomUUID(),
  d: randomUUID(),
  e: randomUUID(),
  f: randomUUID(),
  g: randomUUID(),
  refreshed: randomUUID(),
  blocked: randomUUID(),
  refused: randomUUID(),
  user: randomUUID(),
  fresh: randomUUID(),
  reimport: randomUUID(),
};
const allIds = Object.values(ids);

let restoreRelease: (() => Promise<void>) | null = null;
let base = "";

function card(id: string, gameSetId: string, player: string, number: string, extra?: Partial<typeof playableCards.$inferInsert>) {
  return {
    id,
    gameSetId,
    cardhedgeCardId: `card-review:${stamp}:${id}`,
    player,
    set: `Card Review ${stamp}`,
    description: player,
    number,
    variant: "base",
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: "basketball",
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "unreviewed",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    blockedReason: null as string | null,
    lastImageCheck: new Date(),
    ...extra,
  };
}

async function matchPoolIds(gameSetId: string): Promise<string[]> {
  const rows = await db
    .select({ id: playableCards.id })
    .from(playableCards)
    .where(and(
      eq(playableCards.gameSetId, gameSetId),
      eq(playableCards.isPlayable, true),
      maskNameStillCovered("playable_cards"),
      cardNotBlockedSql("playable_cards"),
    ));
  return rows.map((row) => row.id).sort();
}

async function soloIds(gameSetId: string): Promise<string[]> {
  const cards = await storage.getRandomCardsFromSet(gameSetId, 100);
  return cards.map((row) => row.id).sort();
}

async function daily5Ids(gameSetId: string): Promise<string[]> {
  const pool = await loadDaily5Pool(gameSetId);
  return pool.filtered.map((row) => row.id).sort();
}

/** Shelf lists use one grouped count. It must match the per-set count /api/sets/:id uses. */
async function shelfCount(gameSetId: string): Promise<number | undefined> {
  const rows = await eligibleCountsByActiveSet();
  const shelf = rows.find((row) => row.setId === gameSetId)?.count;
  const [detail] = await db
    .select({ count: eligiblePlayableCardCountSql() })
    .from(gameSets)
    .where(eq(gameSets.id, gameSetId));
  expect(shelf).toBe(Number(detail?.count));
  expect((await eligibleCountsForSetIds([gameSetId])).get(gameSetId)).toBe(shelf);
  return shelf;
}

async function snapshot(gameSetId: string) {
  return {
    shelf: await shelfCount(gameSetId),
    solo: await soloIds(gameSetId),
    daily5: await daily5Ids(gameSetId),
    match: await matchPoolIds(gameSetId),
  };
}

function qa(pathname: string, init?: RequestInit & { token?: string | null }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = init?.token === undefined ? TOKEN : init.token;
  if (token) headers["x-qa-token"] = token;
  return fetch(`${base}${pathname}`, { ...init, headers });
}

describe("card review guard", () => {
  const app = express();
  app.use(express.json());
  registerDealableQaRoutes(app);
  const server = createServer(app);

  beforeAll(async () => {
    process.env.COVER_QA_TOKEN = TOKEN;
    setCardReviewGuardEnabled(false);
    await db.delete(cardReviewSeed).where(eq(cardReviewSeed.id, CARD_REVIEW_SEED_ID));
    await db.delete(cardReviewApprovals).where(eq(cardReviewApprovals.source, "seed"));

    await db.insert(gameSets).values([
      {
        id: setId,
        sport: "basketball",
        brand: "Fleer",
        year: 1989,
        setName: `Card Review ${stamp}`,
        isUserCreated: false,
        isActive: true,
      },
      {
        id: userSetId,
        sport: "basketball",
        brand: "Snap",
        year: 2026,
        setName: `Card Review User ${stamp}`,
        isUserCreated: true,
        isActive: true,
      },
    ]);
    await db.insert(playableCards).values([
      card(ids.a, setId, "Review Alpha", "101"),
      card(ids.b, setId, "Review Bravo", "102"),
      card(ids.c, setId, "Review Charlie", "103"),
      card(ids.d, setId, "Review Delta", "104"),
      card(ids.e, setId, "Review Echo", "105"),
      card(ids.f, setId, "Review Foxtrot", "106"),
      card(ids.g, setId, "Review Golf", "107"),
      card(ids.refreshed, setId, "Review Hotel", "108", { isPlayable: false, imageFailureCount: 1, imageLastError: "HTTP 503" }),
      card(ids.blocked, setId, "Kevin Johnson", "50"),
      card(ids.refused, setId, "Review India", "109", { blockedReason: "mask_name_uncovered" }),
      card(ids.user, userSetId, "Review User Card", "1"),
    ]);
    restoreRelease = await releaseSetsForTests([setId]);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setCardReviewGuardEnabled(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (restoreRelease) await restoreRelease();
    await db.delete(cardReviewApprovals).where(inArray(cardReviewApprovals.cardId, allIds));
    await db.delete(cardReviewApprovals).where(eq(cardReviewApprovals.source, "seed"));
    await db.delete(cardReviewSeed).where(eq(cardReviewSeed.id, CARD_REVIEW_SEED_ID));
    await db.delete(playableCards).where(inArray(playableCards.id, allIds));
    await db.delete(gameSets).where(inArray(gameSets.id, [setId, userSetId]));
    if (previousToken === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previousToken;
  });

  it("seeds every dealable card so shelf, solo, Daily 5 and match pools are unchanged", async () => {
    const before = await snapshot(setId);
    expect(before.shelf).toBe(7);
    expect(before.solo).toEqual([ids.a, ids.b, ids.c, ids.d, ids.e, ids.f, ids.g].sort());
    const userBefore = await soloIds(userSetId);
    expect(userBefore).toEqual([ids.user]);

    let exited = false;
    await bootCardReviewGuard({ attempts: 1, exit: (() => { exited = true; throw new Error("exit"); }) as (code: number) => never });
    expect(exited).toBe(false);
    expect(cardReviewGuardEnabled()).toBe(true);

    const after = await snapshot(setId);
    expect(after).toEqual(before);
    expect(await soloIds(userSetId)).toEqual(userBefore);

    const seeded = await db
      .select({ id: cardReviewApprovals.cardId, source: cardReviewApprovals.source })
      .from(cardReviewApprovals)
      .where(inArray(cardReviewApprovals.cardId, allIds));
    const seededIds = seeded.map((row) => row.id).sort();
    expect(seededIds).toEqual([ids.a, ids.b, ids.c, ids.d, ids.e, ids.f, ids.g].sort());
    expect(seeded.every((row) => row.source === "seed")).toBe(true);
    // Not dealable at seed time, so not approved: unplayable, blocked, mask refusal, user set.
    expect(seededIds).not.toContain(ids.refreshed);
    expect(seededIds).not.toContain(ids.blocked);
    expect(seededIds).not.toContain(ids.refused);
    expect(seededIds).not.toContain(ids.user);

    // Seed runs once. A second boot inserts nothing.
    const again = await ensureCardReviewSeed();
    expect(again.seeded).toBe(false);
  });

  it("holds a new, refreshed, or re-imported card in a cleared set until it is approved", async () => {
    expect(cardReviewGuardEnabled()).toBe(true);
    const before = await snapshot(setId);

    // New import into the live set.
    await db.insert(playableCards).values(card(ids.fresh, setId, "Review Juliet", "110"));
    // Card-pool refresh restores a card that was unplayable at seed time.
    expect(await restorePlayableIfMaskAllows(
      { id: ids.refreshed, blockedReason: null, gameSetId: setId, player: "Review Hotel", number: "108", variant: "base" },
      `https://packpts.com/cards/${ids.refreshed}.jpg`,
    )).toBe(true);
    // Purge and re-import: same card, new id.
    await db.delete(playableCards).where(eq(playableCards.id, ids.g));
    await db.insert(playableCards).values(card(ids.reimport, setId, "Review Golf", "107"));

    const held = [ids.fresh, ids.refreshed, ids.reimport];
    const during = await snapshot(setId);
    expect(during.shelf).toBe((before.shelf ?? 0) - 1);
    for (const pool of [during.solo, during.daily5, during.match]) {
      for (const id of held) expect(pool).not.toContain(id);
    }
    for (const id of held) expect(await isDealableCard(id)).toBe(false);
    expect(await isDealableCard(ids.a)).toBe(true);

    // QA lists them with the reason, and only behind the token.
    expect((await qa(`/api/qa/card-review/${setId}`, { token: null })).status).toBe(404);
    expect((await qa(`/api/qa/card-review/${setId}`, { token: "wrong" })).status).toBe(404);
    const listRes = await qa(`/api/qa/card-review/${setId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as { total: number; cards: Array<{ cardId: string; reason: string; imagePath: string }> };
    expect(list.cards.map((row) => row.cardId).sort()).toEqual([...held].sort());
    expect(list.total).toBe(3);
    expect(list.cards.every((row) => row.reason === CARD_REVIEW_REASON)).toBe(true);
    expect(list.cards[0].imagePath).toBe(`/api/qa/cover-image/${list.cards[0].cardId}`);

    const summary = await (await qa("/api/qa/card-review")).json() as {
      guardEnabled: boolean; reason: string; seededAt: string | null; sets: Array<{ setId: string; awaiting: number }>;
    };
    expect(summary.guardEnabled).toBe(true);
    expect(summary.reason).toBe(CARD_REVIEW_REASON);
    expect(summary.seededAt).not.toBeNull();
    expect(summary.sets.find((row) => row.setId === setId)?.awaiting).toBe(3);
    expect(summary.sets.find((row) => row.setId === userSetId)).toBeUndefined();

    const qaSets = await listActiveDealableSets();
    expect(qaSets.find((row) => row.setId === setId)).toMatchObject({ awaitingCardReview: 3 });

    // Approve: token required, explicit ids only, blocked and unknown ids refused.
    const unknown = randomUUID();
    const body = JSON.stringify({ cardIds: [...held, ids.blocked, ids.refused, unknown, ids.a], approvedBy: "Design", note: "test" });
    expect((await qa("/api/qa/card-review/approve", { method: "POST", body, token: null })).status).toBe(404);
    expect((await qa("/api/qa/card-review/approve", { method: "POST", body: JSON.stringify({ cardIds: [] }) })).status).toBe(400);
    expect((await qa("/api/qa/card-review/approve", { method: "POST", body: JSON.stringify({ all: true }) })).status).toBe(400);
    for (const id of held) expect(await isDealableCard(id)).toBe(false);

    const approveRes = await qa("/api/qa/card-review/approve", { method: "POST", body });
    expect(approveRes.status).toBe(200);
    const result = await approveRes.json() as {
      approved: string[]; alreadyApproved: string[]; refused: Array<{ cardId: string; reason: string }>;
    };
    expect(result.approved.sort()).toEqual([...held].sort());
    expect(result.alreadyApproved).toEqual([ids.a]);
    expect(result.refused).toEqual([
      { cardId: ids.blocked, reason: "not_awaiting_review" },
      { cardId: ids.refused, reason: "not_awaiting_review" },
      { cardId: unknown, reason: "not_found" },
    ]);
    const [row] = await db.select().from(cardReviewApprovals).where(eq(cardReviewApprovals.cardId, ids.fresh));
    expect(row).toMatchObject({ source: "qa", approvedBy: "Design", note: "test", gameSetId: setId });

    const approved = await snapshot(setId);
    expect(approved.shelf).toBe((during.shelf ?? 0) + 3);
    for (const pool of [approved.solo, approved.daily5, approved.match]) {
      for (const id of held) expect(pool).toContain(id);
    }
    expect((await (await qa(`/api/qa/card-review/${setId}`)).json() as { total: number }).total).toBe(0);

    const repeat = await (await qa("/api/qa/card-review/approve", { method: "POST", body: JSON.stringify({ cardIds: [ids.fresh] }) })).json() as { alreadyApproved: string[] };
    expect(repeat.alreadyApproved).toEqual([ids.fresh]);
  });

  it("never deals a blocked card, even with an approval row", async () => {
    await db.insert(cardReviewApprovals).values([
      { cardId: ids.blocked, gameSetId: setId, source: "qa", approvedBy: "test" },
      { cardId: ids.refused, gameSetId: setId, source: "qa", approvedBy: "test" },
    ]);
    const pools = await snapshot(setId);
    for (const pool of [pools.solo, pools.daily5, pools.match]) {
      expect(pool).not.toContain(ids.blocked);
      expect(pool).not.toContain(ids.refused);
    }
    expect(await isDealableCard(ids.blocked)).toBe(false);
    expect(await isDealableCard(ids.refused)).toBe(false);
  });

  it("leaves user-created sets alone", async () => {
    expect(cardReviewGuardEnabled()).toBe(true);
    expect(await soloIds(userSetId)).toEqual([ids.user]);
    expect((await eligibleCountsForSetIds([userSetId])).get(userSetId)).toBe(1);
    const [row] = await db.select().from(cardReviewApprovals).where(eq(cardReviewApprovals.cardId, ids.user));
    expect(row).toBeUndefined();
  });
});
