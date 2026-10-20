/** Design recrop review: 128 approved 1986 cards, 84 blocked cards, QA manifest. */
import { createServer } from "http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isBlockedCard, leakBlocklistLogLines } from "../lib/cardBlocklist";
import {
  RECROP_APPROVED_1986_IDS,
  RECROP_BLOCKED_CARDS,
  TOPPS_1986_SET_ID,
  TOPPS_1988_SET_ID,
  recropBlockedForSet,
} from "../masking/toppsRecropReview";
import { registerHeldSetImportQaRoutes } from "../routes/heldSetImportQa";

const TOKEN = "recrop-review-test-token";
const previous = process.env.COVER_QA_TOKEN;
process.env.COVER_QA_TOKEN = TOKEN;

describe("Topps recrop review lists", () => {
  it("approves 128 unique 1986 cards and blocks 22 plus 62", () => {
    expect(new Set(RECROP_APPROVED_1986_IDS).size).toBe(128);
    expect(recropBlockedForSet(TOPPS_1986_SET_ID)).toHaveLength(22);
    expect(recropBlockedForSet(TOPPS_1988_SET_ID)).toHaveLength(62);
    expect(RECROP_BLOCKED_CARDS).toHaveLength(84);
    const blocked = new Set(RECROP_BLOCKED_CARDS.map((card) => card.id));
    for (const id of RECROP_APPROVED_1986_IDS) expect(blocked.has(id)).toBe(false);
  });

  it("keeps the 22 off deals and leaves the 128 unblocked", () => {
    for (const card of recropBlockedForSet(TOPPS_1986_SET_ID)) {
      expect(isBlockedCard("not-a-set", "Roster", { id: card.id, number: card.number, variant: "base" })).toBe(true);
    }
    for (const id of RECROP_APPROVED_1986_IDS) {
      expect(isBlockedCard("not-a-set", "Roster", { id, number: "1", variant: "base" })).toBe(false);
    }
    expect(leakBlocklistLogLines().find((line) => line.startsWith("[blocklist] set=2b77043a"))).toBe(
      "[blocklist] set=2b77043a blockedIds=36 blockedNumbers=0 blockedPatterns=0",
    );
  });

  it("flags the signature, the wrong photo, DISCOVER stamps, and margins", () => {
    const flagged = (flag: string) => RECROP_BLOCKED_CARDS.filter((card) => card.flags.includes(flag as "signature"));
    expect(flagged("signature").map((card) => card.id)).toEqual(["93a3e9e6-3b14-41f0-a31f-9b3c3d192b85"]);
    expect(flagged("wrong_photo").map((card) => card.id)).toEqual(["f48b9dc3-b4aa-4415-b006-f7b61f01ca24"]);
    expect(flagged("discover_stamp")).toHaveLength(9);
    expect(flagged("discover_stamp").every((card) => card.setId === TOPPS_1988_SET_ID)).toBe(true);
    expect(flagged("margin").filter((card) => card.setId === TOPPS_1986_SET_ID)).toHaveLength(5);
    expect(flagged("margin").filter((card) => card.setId === TOPPS_1988_SET_ID)).toHaveLength(52);
    for (const card of RECROP_BLOCKED_CARDS) {
      expect(card.reason).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("held-set QA serves the blocked recrop export", () => {
  const app = express();
  registerHeldSetImportQaRoutes(app);
  const server = createServer(app);
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    if (previous === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previous;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns the 1986 manifest with a masked path and no raw source", async () => {
    const denied = await fetch(`${base}/api/qa/sets/${TOPPS_1986_SET_ID}/cards`);
    expect(denied.status).toBe(404);
    const res = await fetch(`${base}/api/qa/sets/${TOPPS_1986_SET_ID}/cards`, { headers: { "X-QA-Token": TOKEN } });
    expect(res.status).toBe(200);
    const body = await res.json() as { recropReview: boolean; total: number; cards: Array<{ id: string; number: string; flags: string[]; maskedPath: string; refusalReason: string }> };
    expect(body.recropReview).toBe(true);
    expect(body.total).toBe(22);
    const obrien = body.cards.find((card) => card.id === "93a3e9e6-3b14-41f0-a31f-9b3c3d192b85");
    expect(obrien?.number).toBe("328");
    expect(obrien?.flags).toContain("signature");
    expect(obrien?.refusalReason).toMatch(/signature/);
    expect(obrien?.maskedPath).toBe(`/api/qa/sets/${TOPPS_1986_SET_ID}/recrop-review/${obrien?.id}`);
    expect(JSON.stringify(body)).not.toContain("sourcePath");
  });

  it("returns the 1988 manifest and refuses a raw or approved image", async () => {
    const res = await fetch(`${base}/api/qa/sets/${TOPPS_1988_SET_ID}/cards`, { headers: { "X-QA-Token": TOKEN } });
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; cards: Array<{ id: string; flags: string[] }> };
    expect(body.total).toBe(62);
    const wrong = body.cards.find((card) => card.id === "f48b9dc3-b4aa-4415-b006-f7b61f01ca24");
    expect(wrong?.flags).toContain("wrong_photo");
    const approved = RECROP_APPROVED_1986_IDS[0];
    const png = await fetch(`${base}/api/qa/sets/${TOPPS_1986_SET_ID}/recrop-review/${approved}`, { headers: { "X-QA-Token": TOKEN } });
    expect(png.status).toBe(404);
    const raw = await fetch(`${base}/api/qa/sets/${TOPPS_1986_SET_ID}/source/${body.cards[0].id}`, { headers: { "X-QA-Token": TOKEN } });
    expect(raw.status).toBe(404);
  });
});
