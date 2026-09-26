/**
 * A placement-contract fallback admission stays out of deals until its card id
 * is on the reviewed list. Both deal predicates enforce that.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { MASK_FALLBACK_REVIEWED_CARD_IDS } from "../config/maskFallbackReviewed";
import { cardNotBlockedSql } from "../lib/cardBlocklist";
import { FALLBACK_PENDING_REVIEW, recordMaskFallbackAdmission } from "../masking/maskFallbackReview";
import { registerMaskFallbackQaRoutes } from "../routes/maskFallbackQa";
import { eligibleDealFilter } from "../services/playableSetEligibility";

const setId = randomUUID();
const pendingId = randomUUID();
const openId = randomUUID();
const stamp = randomUUID().slice(0, 8);
const TOKEN = "fallback-qa-token";
const previousToken = process.env.COVER_QA_TOKEN;

function setToken(value: string | undefined) {
  if (value === undefined) delete process.env.COVER_QA_TOKEN;
  else process.env.COVER_QA_TOKEN = value;
}

async function dealtIds(filter: "eligible" | "blocklist"): Promise<string[]> {
  const where = filter === "eligible"
    ? eligibleDealFilter("playable_cards")
    : cardNotBlockedSql("playable_cards");
  const rows = await db
    .select({ id: playableCards.id })
    .from(playableCards)
    .where(and(inArray(playableCards.id, [pendingId, openId]), where));
  return rows.map((row) => row.id);
}

describe("fallback admission is not dealable until reviewed", () => {
  const app = express();
  registerMaskFallbackQaRoutes(app);
  const server = createServer(app);
  let base = "";

  afterAll(async () => {
    delete MASK_FALLBACK_REVIEWED_CARD_IDS[pendingId];
    setToken(previousToken);
    server.close();
    await db.delete(playableCards).where(inArray(playableCards.id, [pendingId, openId]));
    await db.delete(gameSets).where(eq(gameSets.id, setId));
  });

  it("stays out of both deal filters until the card id is listed, and shows on the QA route", async () => {
    await db.insert(gameSets).values({
      id: setId,
      sport: "football",
      brand: "Topps",
      year: 1987,
      setName: `Fallback review ${stamp}`,
      isUserCreated: false,
      isActive: true,
    });

    const card = (id: string, state: string | null, player: string) => ({
      id,
      gameSetId: setId,
      cardhedgeCardId: `fallback:${id}`,
      player,
      set: `Fallback review ${stamp}`,
      number: "57",
      description: player,
      imageUrl: `https://images.example.com/${id}.jpg`,
      category: "football",
      isPlayable: true,
      contentVerified: true as boolean | null,
      imageReviewStatus: "unreviewed",
      quarantineStatus: "OK",
      proposedUnplayable: false,
      blockedReason: null as string | null,
      nameLayoutVerified: true,
      maskFallbackState: state,
      lastImageCheck: new Date(),
    });

    await db.insert(playableCards).values([
      card(pendingId, FALLBACK_PENDING_REVIEW, "Jim Kelly"),
      card(openId, null, "Jerry Rice"),
    ]);

    expect(await dealtIds("eligible")).toEqual([openId]);
    expect(await dealtIds("blocklist")).toEqual([openId]);

    expect(await recordMaskFallbackAdmission(openId)).toBe(true);
    expect(await dealtIds("eligible")).toEqual([]);
    expect(await dealtIds("blocklist")).toEqual([]);
    await db.update(playableCards).set({ maskFallbackState: null }).where(eq(playableCards.id, openId));
    expect(await dealtIds("eligible")).toEqual([openId]);

    setToken(undefined);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const hidden = await fetch(`${base}/api/qa/mask-fallbacks`);
    expect(hidden.status).toBe(404);

    setToken(TOKEN);
    const wrong = await fetch(`${base}/api/qa/mask-fallbacks?token=${TOKEN}`);
    expect(wrong.status).toBe(404);

    const listed = await fetch(`${base}/api/qa/mask-fallbacks`, {
      headers: { "X-QA-Token": TOKEN },
    });
    expect(listed.status).toBe(200);
    const body = await listed.json() as {
      state: string;
      cards: Array<{ cardId: string; state: string; reviewed: boolean; gameSetId: string }>;
      countsBySet: Array<{ gameSetId: string; pending: number }>;
    };
    expect(body.state).toBe(FALLBACK_PENDING_REVIEW);
    const row = body.cards.find((card) => card.cardId === pendingId);
    expect(row?.reviewed).toBe(false);
    expect(row?.state).toBe(FALLBACK_PENDING_REVIEW);
    expect(row?.gameSetId).toBe(setId);
    expect(body.countsBySet.find((count) => count.gameSetId === setId)?.pending).toBeGreaterThanOrEqual(1);

    MASK_FALLBACK_REVIEWED_CARD_IDS[pendingId] = true;
    const eligible = await dealtIds("eligible");
    const blocked = await dealtIds("blocklist");
    expect(eligible.sort()).toEqual([openId, pendingId].sort());
    expect(blocked.sort()).toEqual([openId, pendingId].sort());

    const reviewed = await fetch(`${base}/api/qa/mask-fallbacks`, {
      headers: { "X-QA-Token": TOKEN },
    });
    const reviewedBody = await reviewed.json() as {
      cards: Array<{ cardId: string; reviewed: boolean }>;
      countsBySet: Array<{ gameSetId: string; pending: number }>;
    };
    expect(reviewedBody.cards.find((card) => card.cardId === pendingId)?.reviewed).toBe(true);
    expect(reviewedBody.countsBySet.find((count) => count.gameSetId === setId)).toBeUndefined();
  });
});
