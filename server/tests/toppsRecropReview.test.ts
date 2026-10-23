/** Design recrop review: 148 approved 1986 cards, 52 approved 1988 cards, 12 blocked cards. */
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createServer } from "http";
import express from "express";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { isBlockedCard, leakBlocklistLogLines } from "../lib/cardBlocklist";
import { TOPPS_1988_REVIEWED_SOURCES } from "../masking/topps1988Geometry";
import {
  RECROP_APPROVED_1986_IDS,
  RECROP_APPROVED_1988_IDS,
  RECROP_BLOCKED_CARDS,
  TOPPS_1986_SET_ID,
  TOPPS_1988_SET_ID,
  recropBlockedForSet,
  recropPermanentlyExcluded,
} from "../masking/toppsRecropReview";
import { registerHeldSetImportQaRoutes } from "../routes/heldSetImportQa";

const TOKEN = "recrop-review-test-token";
const previous = process.env.COVER_QA_TOKEN;
process.env.COVER_QA_TOKEN = TOKEN;

describe("Topps recrop review lists", () => {
  it("approves 148 unique 1986 cards, 52 unique 1988 cards, and blocks 2 plus 10", () => {
    expect(new Set(RECROP_APPROVED_1986_IDS).size).toBe(148);
    expect(new Set(RECROP_APPROVED_1988_IDS).size).toBe(52);
    expect(recropBlockedForSet(TOPPS_1986_SET_ID)).toHaveLength(2);
    expect(recropBlockedForSet(TOPPS_1988_SET_ID)).toHaveLength(10);
    expect(RECROP_BLOCKED_CARDS).toHaveLength(12);
    const blocked = new Set(RECROP_BLOCKED_CARDS.map((card) => card.id));
    for (const id of RECROP_APPROVED_1986_IDS) expect(blocked.has(id)).toBe(false);
    for (const id of RECROP_APPROVED_1988_IDS) expect(blocked.has(id)).toBe(false);
    const reviewed = new Set(TOPPS_1988_REVIEWED_SOURCES.map((source) => source.cardId));
    for (const id of RECROP_APPROVED_1988_IDS) expect(reviewed.has(id)).toBe(true);
  });

  it("keeps the held cards off deals and leaves the approved recrops unblocked", () => {
    for (const card of RECROP_BLOCKED_CARDS) {
      expect(isBlockedCard("not-a-set", "Roster", { id: card.id, number: card.number, variant: "base" })).toBe(true);
    }
    for (const id of [...RECROP_APPROVED_1986_IDS, ...RECROP_APPROVED_1988_IDS]) {
      expect(isBlockedCard("not-a-set", "Roster", { id, number: "1", variant: "base" })).toBe(false);
    }
    expect(leakBlocklistLogLines().find((line) => line.startsWith("[blocklist] set=2b77043a"))).toBe(
      "[blocklist] set=2b77043a blockedIds=16 blockedNumbers=0 blockedPatterns=0",
    );
    expect(leakBlocklistLogLines().find((line) => line.startsWith("[blocklist] set=affd57b8"))).toBe(
      "[blocklist] set=affd57b8 blockedIds=13 blockedNumbers=0 blockedPatterns=0",
    );
  });

  it("flags the signature, DISCOVER stamps, and the two remaining margins", () => {
    const flagged = (flag: string) => RECROP_BLOCKED_CARDS.filter((card) => card.flags.includes(flag as "signature"));
    expect(flagged("signature").map((card) => card.id)).toEqual(["93a3e9e6-3b14-41f0-a31f-9b3c3d192b85"]);
    expect(flagged("wrong_photo")).toHaveLength(0);
    expect(RECROP_BLOCKED_CARDS.find((card) => card.id === "f48b9dc3-b4aa-4415-b006-f7b61f01ca24")).toBeUndefined();
    expect(flagged("discover_stamp")).toHaveLength(8);
    expect(flagged("discover_stamp").every((card) => card.setId === TOPPS_1988_SET_ID)).toBe(true);
    expect(flagged("margin").filter((card) => card.setId === TOPPS_1986_SET_ID)).toHaveLength(0);
    expect(flagged("margin").filter((card) => card.setId === TOPPS_1988_SET_ID)).toHaveLength(2);
    const excluded = RECROP_BLOCKED_CARDS.filter((card) => recropPermanentlyExcluded(card.id));
    expect(excluded).toHaveLength(9);
    expect(excluded.every((card) => card.flags.includes("signature") || card.flags.includes("discover_stamp"))).toBe(true);
    expect(recropPermanentlyExcluded("8d0fc5e2-41ea-4428-a662-e9a059350599")).toBe(false);
    expect(recropPermanentlyExcluded("a5106b0b-151c-496b-91bc-815174d48bb3")).toBe(false);
    expect(recropPermanentlyExcluded("1cf53402-61f8-4fac-9aae-4fb7b9cf112e")).toBe(false);
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
    expect(body.total).toBe(2);
    const obrien = body.cards.find((card) => card.id === "93a3e9e6-3b14-41f0-a31f-9b3c3d192b85");
    expect(obrien?.number).toBe("328");
    expect(obrien?.flags).toContain("signature");
    expect(obrien?.refusalReason).toMatch(/autograph/);
    expect(obrien?.maskedPath).toBe(`/api/qa/sets/${TOPPS_1986_SET_ID}/recrop-review/${obrien?.id}`);
    expect(JSON.stringify(body)).not.toContain("sourcePath");
  });

  it("returns the 1988 manifest and refuses a raw or approved image", async () => {
    const res = await fetch(`${base}/api/qa/sets/${TOPPS_1988_SET_ID}/cards`, { headers: { "X-QA-Token": TOKEN } });
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; cards: Array<{ id: string; flags: string[] }> };
    expect(body.total).toBe(10);
    const pena = body.cards.find((card) => card.id === "63c44120-3b19-4d97-b1e0-63b372fcfafd");
    expect(pena?.flags).toContain("discover_stamp");
    const approved = RECROP_APPROVED_1986_IDS[0];
    const png = await fetch(`${base}/api/qa/sets/${TOPPS_1986_SET_ID}/recrop-review/${approved}`, { headers: { "X-QA-Token": TOKEN } });
    expect(png.status).toBe(404);
    const raw = await fetch(`${base}/api/qa/sets/${TOPPS_1986_SET_ID}/source/${body.cards[0].id}`, { headers: { "X-QA-Token": TOKEN } });
    expect(raw.status).toBe(404);
  });

  it("does not serve an excluded stamp even when a masked file is on disk", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "recrop-exclude-"));
    mkdirSync(dir, { recursive: true });
    setMaskReadySidecarDirForTests(dir);
    const jpeg = await sharp({ create: { width: 20, height: 28, channels: 3, background: { r: 20, g: 140, b: 40 } } }).jpeg().toBuffer();
    const stamp = "63c44120-3b19-4d97-b1e0-63b372fcfafd";
    const murray = "8d0fc5e2-41ea-4428-a662-e9a059350599";
    for (const id of [stamp, murray]) {
      writeFileSync(path.join(dir, `${id}_${CURRENT_MASK_VERSION}.jpg`), jpeg);
      writeFileSync(path.join(dir, `${id}_${CURRENT_MASK_VERSION}.ok`), "ok\n");
    }
    try {
      const hidden = await fetch(`${base}/api/qa/sets/${TOPPS_1988_SET_ID}/recrop-review/${stamp}`, { headers: { "X-QA-Token": TOKEN } });
      expect(hidden.status).toBe(404);
      const shown = await fetch(`${base}/api/qa/sets/${TOPPS_1988_SET_ID}/recrop-review/${murray}`, { headers: { "X-QA-Token": TOKEN } });
      expect(shown.status).toBe(200);
      expect(shown.headers.get("content-type")).toBe("image/png");
    } finally {
      setMaskReadySidecarDirForTests(null);
    }
  });
});
